#!/usr/bin/env node
/**
 * simulator.js — 无硬件协议模拟器（假 ESP32-S3 智能风扇控制器）
 *
 * 目的：在没有 ESP32-S3 真机的情况下，让 Web 后端/前端、Home Assistant、
 *       冒烟与联调链路可以跑通全链路（docs/protocol.md v1.0.1）。
 *
 * 协议真源与行为对齐：
 *   - docs/protocol.md v1.0.1            —— topic 树 / payload 契约 / QoS / retain
 *   - firmware/main/main.c               —— 上报周期、命令路由、FW-15 Unix 秒
 *   - firmware/components/mqtt_client    —— status online（QoS1 retain）+ LWT offline
 *   - firmware/components/alert_manager  —— 双阈值模型 / 三源最大温度 / 2min dedup
 *   - firmware/components/fan_curve      —— LUT 线性插值 / PID / MANUAL / >80°C 紧急全速
 *   - firmware/components/ota_handler    —— ota/status 状态机（QoS1）
 *
 * 用法：见同目录 README.md（node simulator.js --help）
 */
import mqtt from 'mqtt'

/* ========================================================================
 * 1. 常量（与固件同源，改动需同步固件）
 * ====================================================================== */
const TOPIC_PREFIX   = 'fan-controller'
const FAN_COUNT      = 8                 /* ADJ-13: 8 路风扇 */
const MAX_LUT_POINTS = 10                /* FAN_CURVE_MAX_POINTS */
const EMERGENCY_C    = 80.0              /* fan_curve.h: 温度源 >80°C → 全风扇 100% */
const STALL_DUTY_PCT = 5                 /* alert_manager.c: 停转判定要求 duty > 5% */
const STALL_RPM      = 200
const DEDUP_MS       = 2 * 60 * 1000     /* alert_manager.c: 告警 2 分钟去重 */
const V5_NOMINAL = 5.0,  V5_TOL  = 0.25
const V33_NOMINAL = 3.3, V33_TOL = 0.165
const TEMP_SOURCES   = ['bme280', 'ds18b20_0', 'ds18b20_1', 'internal']
const ALERT_SENSOR   = {
  temperature_high: 'bme280',
  fan_stall:        'fan',
  voltage_abnormal: 'power',
  wifi_disconnected: 'wifi',
}
/* fan_curve.c DEFAULT_LUT（协议 §4.2 示例同值） */
const DEFAULT_LUT = [
  { temp_c: 30, duty_pct: 20 },
  { temp_c: 40, duty_pct: 40 },
  { temp_c: 50, duty_pct: 60 },
  { temp_c: 60, duty_pct: 80 },
  { temp_c: 70, duty_pct: 100 },
]
/* 协议 §2.2 示例地址（HA ha/sensors.yaml 按 address 匹配，见 README 替换说明） */
const DS_ADDRESSES = ['28-00000a1b2c3d', '28-00000e4f5g6h']

/* ========================================================================
 * 2. 配置（CLI 参数 > 环境变量 > 默认值）
 * ====================================================================== */
const argv = process.argv.slice(2)
const argVal = (flag) => {
  const i = argv.indexOf(flag)
  return (i >= 0 && i + 1 < argv.length) ? argv[i + 1] : undefined
}
const envNum = (name, def) => {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return def
  const n = Number(raw)
  return Number.isFinite(n) ? n : def
}
const envStr = (name, def) => {
  const raw = process.env[name]
  return (raw === undefined || raw === '') ? def : raw
}

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(`无硬件协议模拟器 — 假 ESP32-S3 智能风扇控制器（协议 v1.0.1）

用法: node simulator.js [选项]

选项:
  -b, --broker <url>   MQTT broker（默认 mqtt://localhost:1883，或环境变量 MQTT_URL）
  -d, --device <id>    设备 ID（默认 esp32-sim0001，或 SIM_DEVICE_ID）
      --log <level>    quiet | info | debug（默认 info）
      --quiet          等价 --log quiet
      --verbose        等价 --log debug
  -h, --help           显示本帮助

环境变量:
  MQTT_URL               broker 地址          (默认 mqtt://localhost:1883)
  SIM_DEVICE_ID          设备 ID              (默认 esp32-sim0001)
  SIM_FW_VERSION         固件版本             (默认 v1.0.1)
  SIM_IP_ADDRESS         status 报文 ip        (默认 192.168.1.100)
  SIM_TICK_MS            采样/上报周期 ms      (默认 1000)
  SIM_STATUS_INTERVAL_S  status 心跳秒数       (默认 30，0=仅上线时发)
  SIM_ALERT_DEMO         告警演示注入开关      (默认 1，0=关闭)
  SIM_ALERT_INTERVAL_S   告警演示重复周期秒数  (默认 120，0=只注入首次事件)
  SIM_FIRST_ALERT_S      首次告警演示延迟秒数  (默认 20)
  SIM_EXCURSION_S        温升事件持续秒数      (默认 45)
  SIM_ALERT_KIND         注入的告警场景        (alternate|warning|critical)
  SIM_STALL_FAN          强制停转的风扇路号    (默认 -1=关闭，0-7)
  SIM_OTA_STEP_MS        OTA 每步耗时 ms       (默认 700)
  SIM_REBOOT_MS          重启掉线时长 ms       (默认 2000)
  SIM_LOG                日志级别             (默认 info)

示例:
  node simulator.js -b mqtt://192.168.3.131:1883
  SIM_ALERT_INTERVAL_S=60 SIM_STALL_FAN=3 npm start
`)
  process.exit(0)
}

const cfg = {
  brokerUrl:  argVal('--broker') ?? argVal('-b') ?? envStr('MQTT_URL', 'mqtt://localhost:1883'),
  deviceId:   argVal('--device') ?? argVal('-d') ?? envStr('SIM_DEVICE_ID', 'esp32-sim0001'),
  fwVersion:  envStr('SIM_FW_VERSION', 'v1.0.1'),
  ipAddress:  envStr('SIM_IP_ADDRESS', '192.168.1.100'),
  tickMs:     Math.max(100, envNum('SIM_TICK_MS', 1000)),
  statusIntervalS: envNum('SIM_STATUS_INTERVAL_S', 30),
  alertIntervalS:  envNum('SIM_ALERT_INTERVAL_S', 120),
  firstAlertS:     envNum('SIM_FIRST_ALERT_S', 20),
  excursionS:      envNum('SIM_EXCURSION_S', 45),
  alertKind:       envStr('SIM_ALERT_KIND', 'alternate'),  /* alternate | warning | critical */
  alertDemo:       envNum('SIM_ALERT_DEMO', 1) !== 0,      /* 0 = 关闭告警演示注入 */
  stallFan:        envNum('SIM_STALL_FAN', -1),
  otaStepMs:  Math.max(50, envNum('SIM_OTA_STEP_MS', 700)),
  rebootMs:   Math.max(200, envNum('SIM_REBOOT_MS', 2000)),
  logLevel:   argVal('--log') ?? envStr('SIM_LOG',
                argv.includes('--quiet') ? 'quiet' : argv.includes('--verbose') ? 'debug' : 'info'),
}

/* ========================================================================
 * 3. 日志
 * ====================================================================== */
const LEVELS = { quiet: 0, info: 1, debug: 2 }
const logLevel = LEVELS[cfg.logLevel] ?? 1
const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19)
const log = (...a) => { if (logLevel >= 1) console.log(`[${stamp()}] ${a.join(' ')}`) }
const dbg = (...a) => { if (logLevel >= 2) console.log(`[${stamp()}] [debug] ${a.join(' ')}`)
}
const warn = (...a) => console.warn(`[${stamp()}] [warn] ${a.join(' ')}`)

/* ========================================================================
 * 4. 工具
 * ====================================================================== */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const r1 = (v) => Math.round(v * 10) / 10
const r2 = (v) => Math.round(v * 100) / 100
const nowSec = () => Math.floor(Date.now() / 1000)
const sleep = (ms) => new Promise((res) => setTimeout(res, ms))
/* 一阶趋近 + 噪声（均值回归，保证 History 有缓慢漂移曲线） */
const approach = (cur, target, k, s, noise, lo, hi) =>
  clamp(cur + (target - cur) * Math.min(1, k * s) + (Math.random() * 2 - 1) * noise, lo, hi)

/* ========================================================================
 * 5. 设备状态（内存态；重启后阈值/曲线回到默认，与 NVS 持久化行为差异见 README）
 * ====================================================================== */
function makeFan(index) {
  return {
    index,
    mode:   'auto',                       /* auto = LUT/PID；manual 见 command/fan */
    curve:  'lut',                        /* lut | pid（mode!=='manual' 时生效） */
    source: 'bme280',
    lut:    DEFAULT_LUT.map((p) => ({ ...p })),
    pid:    { kp: 2.0, ki: 0.1, kd: 0.5, setpoint_c: 50 },
    integral: 0,
    lastErr:  0,
    duty:   0,
    rpm:    0,
    rpmMax: 2400 + (index % 4) * 150,     /* 2400 / 2550 / 2700 / 2850 */
    rpmMin: 480 + (index % 3) * 40,
    stalled: false,
  }
}

const st = {
  bootedAt: Date.now(),
  ticks: 0,
  env:   { temp: 26.0, hum: 45.2, press: 1013.25 },
  mcu:   45.0,
  ds:    DS_ADDRESSES.map((addr, i) => ({ addr, temp: 35.5 + i * 6.6, valid: true })),
  volts: { v12: 12.05, v5: 5.02, v33: 3.31 },
  fans:  Array.from({ length: FAN_COUNT }, (_, i) => makeFan(i)),
  thresholds: {
    temp_warn_c: 75.0, temp_crit_c: 80.0,
    v12_min: 10.8, v12_max: 13.2,
    stall_rpm: STALL_RPM, wifi_timeout_s: 60,
  },
  rules: {
    temperature_high:  { active: false, lastFired: 0 },
    fan_stall:         { active: false, lastFired: 0 },
    voltage_abnormal:  { active: false, lastFired: 0 },
    wifi_disconnected: { active: false, lastFired: 0 },
  },
  severity: 'normal',
  emergency: false,
  otaRunning: false,
  lastStatusAt: 0,
  demo: {
    /* alternate: kind 在注入时翻转，故初值取 'critical' → 首次注入 warning（缓升，曲线友好） */
    kind: cfg.alertKind === 'warning' ? 'warning' : 'critical',
    nextAt: Date.now() + cfg.firstAlertS * 1000,
    excursionUntil: 0,
    dipAt: 0,
    dipUntil: 0,
  },
}

/* ========================================================================
 * 6. MQTT 发布（QoS/retain 严格按协议 §1/§2/§5/§7）
 * ====================================================================== */
let client = null
let connected = false

const topicOf = (...suffix) => [TOPIC_PREFIX, cfg.deviceId, ...suffix].join('/')

function publish(topic, payload, opts = {}) {
  if (!client || !connected) { dbg('skip publish (offline):', topic); return false }
  client.publish(topic, JSON.stringify(payload), { qos: opts.qos ?? 0, retain: opts.retain ?? false })
  dbg('PUB', topic, JSON.stringify(payload))
  return true
}

const basePayload = () => ({ timestamp: nowSec(), device_id: cfg.deviceId })

/** 协议 §1.1/§1.2：status（QoS1 + retain；offline 同时是 LWT 遗嘱） */
function publishStatus(status) {
  if (status === 'online') {
    publish(topicOf('status'), {
      ...basePayload(),
      status: 'online',
      firmware_version: cfg.fwVersion,
      ip_address: cfg.ipAddress,
      uptime_seconds: Math.floor((Date.now() - st.bootedAt) / 1000),
    }, { qos: 1, retain: true })
  } else {
    publish(topicOf('status'), { ...basePayload(), status: 'offline' }, { qos: 1, retain: true })
  }
}

/* ========================================================================
 * 7. 物理量演化（缓慢随机漂移，供 Dashboard/History 出曲线）
 * ====================================================================== */
function stepDemo(now) {
  const d = st.demo
  if (cfg.alertDemo && now >= d.nextAt && d.excursionUntil === 0) {
    if (cfg.alertKind === 'alternate') d.kind = d.kind === 'warning' ? 'critical' : 'warning'
    const durMs = Math.max(5, cfg.excursionS) * 1000
    d.excursionUntil = now + durMs
    d.dipAt    = now + durMs * 0.6
    d.dipUntil = d.dipAt + 8000
    /* SIM_ALERT_INTERVAL_S=0 → 只注入首次事件，不重复 */
    d.nextAt   = cfg.alertIntervalS > 0 ? now + cfg.alertIntervalS * 1000 : Number.POSITIVE_INFINITY
    log(`demo: ${d.kind} 温升事件注入（持续 ${cfg.excursionS}s）`)
  }
  if (d.excursionUntil !== 0 && now >= d.excursionUntil) {
    d.excursionUntil = 0
    log('demo: 温升事件结束，环境温度回落')
  }
}

function stepPhysics(now, s) {
  const d = st.demo
  const hot = now < d.excursionUntil
  /* 温升斜率：critical 为突发故障（一步越过 80°C，触发 emergency 全速） */
  const peak  = d.kind === 'critical' ? 84.5 : 78.0
  const ramp  = d.kind === 'critical' ? 0.95 : 0.10

  st.env.temp  = approach(st.env.temp, hot ? peak : 26.0, hot ? ramp : 0.06, s, 0.10, 0, 120)
  st.mcu       = approach(st.mcu, 42.0 + st.env.temp * 0.06 + (hot ? 8 : 0), 0.05, s, 0.15, 0, 120)
  st.env.hum   = approach(st.env.hum, 45.0 - (st.env.temp - 26.0) * 0.35, 0.10, s, 0.25, 20, 95)
  st.env.press = clamp(st.env.press + (Math.random() * 2 - 1) * 0.03, 1005, 1020)
  for (let i = 0; i < st.ds.length; i++) {
    st.ds[i].temp = approach(st.ds[i].temp, 35.5 + i * 6.6 + (hot ? 12 : 0), 0.08, s, 0.08, -55, 125)
  }
  const dip = now >= d.dipAt && now < d.dipUntil
  st.volts.v12 = approach(st.volts.v12, dip ? 10.2 : 12.05, dip ? 0.5 : 0.25, s, 0.012, 0, 20)
  st.volts.v5  = approach(st.volts.v5,  5.02, 0.20, s, 0.008, 0, 10)
  st.volts.v33 = approach(st.volts.v33, 3.31, 0.20, s, 0.004, 0, 6)
}

/* ========================================================================
 * 8. 风扇曲线 / PID / RPM 随动（对齐 fan_curve.c）
 * ====================================================================== */
function lutInterpolate(pts, temp) {
  if (!pts.length) return 0
  if (temp <= pts[0].temp_c) return pts[0].duty_pct
  if (temp >= pts[pts.length - 1].temp_c) return pts[pts.length - 1].duty_pct
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1]
    if (temp >= a.temp_c && temp <= b.temp_c) {
      const t = (temp - a.temp_c) / (b.temp_c - a.temp_c)
      return Math.round(a.duty_pct + t * (b.duty_pct - a.duty_pct))
    }
  }
  return pts[pts.length - 1].duty_pct
}

/* 简化 PID（真机 pid_compute 为增量式，见 README「与固件的差异」） */
function pidCompute(f, temp, s) {
  const err = temp - f.pid.setpoint_c
  f.integral = clamp(f.integral + err * s, -200, 200)
  const deriv = (err - f.lastErr) / Math.max(s, 1e-3)
  f.lastErr = err
  return clamp(Math.round(f.pid.kp * err + f.pid.ki * f.integral + f.pid.kd * deriv), 0, 100)
}

function tempSources() {
  return {
    bme280:    st.env.temp,
    ds18b20_0: st.ds[0].temp,
    ds18b20_1: st.ds[1].temp,
    internal:  st.mcu,
  }
}

function updateFans(s) {
  const temps = tempSources()
  const emergency = TEMP_SOURCES.some((k) => temps[k] > EMERGENCY_C)
  if (emergency && !st.emergency) log(`EMERGENCY: 温度源 >${EMERGENCY_C}°C，全部风扇 100%`)
  st.emergency = emergency

  for (const f of st.fans) {
    if (emergency) {
      f.duty = 100                                         /* fan_curve.c: 紧急全速 */
    } else if (f.mode === 'auto') {
      f.duty = f.curve === 'pid' ? pidCompute(f, temps[f.source], s)
                                 : lutInterpolate(f.lut, temps[f.source])
    }
    /* manual: duty 保持（固件 CURVE_MODE_MANUAL: continue） */

    const target = f.duty === 0 ? 0
      : Math.round(f.rpmMin + (f.duty / 100) * (f.rpmMax - f.rpmMin))
    f.rpm = Math.max(0, Math.round(
      f.rpm + (target - f.rpm) * Math.min(1, 0.45 * s) + (Math.random() * 2 - 1) * 6))
    if (cfg.stallFan === f.index) f.rpm = 0                /* 故障注入：停转 */
    f.stalled = f.duty > STALL_DUTY_PCT && f.rpm < st.thresholds.stall_rpm
  }
}

/* ========================================================================
 * 9. 周期上报（周期对齐 main.c：传感器/风扇 1s，电压/内部温度 5s）
 * ====================================================================== */
function publishTelemetry(now) {
  publish(topicOf('sensor', 'bme280'), {
    ...basePayload(),
    temperature_c: r1(st.env.temp),
    humidity_pct:  r1(st.env.hum),
    pressure_hpa:  r2(st.env.press),
  }, { qos: 0 })

  publish(topicOf('sensor', 'ds18b20'), {
    ...basePayload(),
    sensors: st.ds.map((d) => ({
      address:       d.addr,
      valid:         d.valid,
      temperature_c: r1(d.temp),
    })),
  }, { qos: 0 })

  for (const f of st.fans) {
    publish(topicOf('fan', String(f.index), 'state'), {
      ...basePayload(),
      fan_index:    f.index,
      pwm_duty_pct: f.duty,
      rpm:          f.rpm,
      stalled:      f.stalled,
      mode:         f.mode,
    }, { qos: 0 })
  }

  if (st.ticks % 5 === 0) {                                 /* FW-19: 5s 周期 */
    publish(topicOf('sensor', 'voltage'), {
      ...basePayload(),
      voltage_12v: r2(st.volts.v12),
      voltage_5v:  r2(st.volts.v5),
      voltage_3v3: r2(st.volts.v33),
    }, { qos: 0 })
    publish(topicOf('sensor', 'internal_temp'), {
      ...basePayload(),
      temperature_c: r1(st.mcu),
    }, { qos: 0 })
  }

  if (cfg.statusIntervalS > 0 &&
      now - st.lastStatusAt >= cfg.statusIntervalS * 1000) {
    st.lastStatusAt = now
    publishStatus('online')
  }
}

/* ========================================================================
 * 10. 告警（对齐 alert_manager.c：三源最大温度 / 双阈值 / duty>5% 停转 / 2min dedup）
 * ====================================================================== */
function publishAlertState(type, active, severity) {
  publish(topicOf('alert', type, 'state'), {   /* §5.2 per-type retained（HA 消费） */
    active,
    severity: active ? severity : 'normal',
    timestamp: nowSec(),
  }, { qos: 1, retain: true })
}

function fireAlert(type, severity, message, value, threshold) {
  const rule = st.rules[type]
  const now = Date.now()
  if (rule.active && now - rule.lastFired < DEDUP_MS) return
  rule.active = true
  rule.lastFired = now
  log(`ALERT [${type}] ${severity}: ${message} (val=${value}, thresh=${threshold})`)
  publish(topicOf('alert'), {                  /* §5.1 事件（web 消费） */
    ...basePayload(),
    alert_type: type,
    severity,
    message,
    value,
    threshold,
    sensor: ALERT_SENSOR[type],
  }, { qos: 1 })
  publishAlertState(type, true, severity)
}

function clearAlert(type) {
  const rule = st.rules[type]
  if (!rule.active) return
  rule.active = false
  log(`ALERT_CLEARED [${type}]`)
  publishAlertState(type, false, 'normal')
}

const SEV_RANK = { normal: 0, warning: 1, critical: 2 }

function evaluateAlerts() {
  const th = st.thresholds
  let severity = 'normal'
  const raise = (sev) => { if (SEV_RANK[sev] > SEV_RANK[severity]) severity = sev }

  /* Rule 1: temperature_high — 三源最大值（BME280 + DS18B20 探头，FW-26） */
  const maxTemp = Math.max(st.env.temp, st.ds[0].temp, st.ds[1].temp)
  if (maxTemp > th.temp_warn_c) {
    const sev = maxTemp > th.temp_crit_c ? 'critical' : 'warning'
    fireAlert('temperature_high', sev,
      `Temperature ${maxTemp.toFixed(1)}°C > ${th.temp_warn_c.toFixed(0)}°C`,
      r1(maxTemp), th.temp_warn_c)
    raise(sev)
  } else {
    clearAlert('temperature_high')
  }

  /* Rule 2: fan_stall — duty > 5% 且 RPM < stall_rpm */
  let anyStall = false
  for (const f of st.fans) {
    if (f.duty > STALL_DUTY_PCT && f.rpm < th.stall_rpm) {
      anyStall = true
      fireAlert('fan_stall', 'critical',
        `Fan ${f.index} stalled: ${f.rpm} RPM (duty ${f.duty}%)`,
        f.rpm, th.stall_rpm)
      raise('critical')
    }
  }
  if (!anyStall) clearAlert('fan_stall')

  /* Rule 3: voltage_abnormal — 12V 窗口 + 5V/3.3V 容差 */
  const voltOk = st.volts.v12 >= th.v12_min && st.volts.v12 <= th.v12_max &&
                 Math.abs(st.volts.v5 - V5_NOMINAL) <= V5_TOL &&
                 Math.abs(st.volts.v33 - V33_NOMINAL) <= V33_TOL
  if (!voltOk) {
    fireAlert('voltage_abnormal', 'warning',
      `Voltage abnormal: 12V=${st.volts.v12.toFixed(2)} 5V=${st.volts.v5.toFixed(2)} 3.3V=${st.volts.v33.toFixed(2)}`,
      r2(st.volts.v12), th.v12_min)
    raise('warning')
  } else {
    clearAlert('voltage_abnormal')
  }

  /* Rule 4: wifi_disconnected — 模拟器 MQTT 长连接即“联网”，恒为已连接 */
  clearAlert('wifi_disconnected')

  st.severity = severity
}

/* ========================================================================
 * 11. 命令处理（协议 §4/§6/§7；topic 路由对齐 main.c on_mqtt_command）
 * ====================================================================== */
function configAlertPayload() {
  const th = st.thresholds
  return {
    ...basePayload(),
    rules: [
      { type: 'temperature_high',  warn_c: th.temp_warn_c, crit_c: th.temp_crit_c, enabled: true },
      { type: 'fan_stall',         stall_rpm: th.stall_rpm, enabled: true },
      { type: 'voltage_abnormal',  '12v_min': th.v12_min, '12v_max': th.v12_max, enabled: true },
      { type: 'wifi_disconnected', timeout_s: th.wifi_timeout_s, enabled: true },
    ],
  }
}

function handleFanCommand(msg) {
  const idx  = Math.trunc(Number(msg.fan_index))
  const duty = Math.trunc(Number(msg.duty_pct))
  if (!Number.isFinite(idx) || !Number.isFinite(duty)) {
    warn('command/fan: missing fan_index/duty_pct, dropped'); return
  }
  if (idx < 0 || idx >= FAN_COUNT || duty < 0 || duty > 100) {
    warn('command/fan: index/duty out of range, dropped'); return
  }
  const f = st.fans[idx]
  f.mode = 'manual'        /* 固件忽略 payload.mode，恒切 MANUAL（回 AUTO 走 command/curve） */
  f.duty = duty
  log(`command/fan → fan ${idx} MANUAL duty ${duty}%`)
}

function handleCurveCommand(msg) {
  const idx = Math.trunc(Number(msg.fan_index))
  if (!Number.isFinite(idx) || idx < 0 || idx >= FAN_COUNT) {
    warn('curve: fan_index out of range, dropped'); return
  }
  const f = st.fans[idx]

  if (msg.temperature_source !== undefined) {           /* ADJ-5: 4 值枚举 */
    if (!TEMP_SOURCES.includes(msg.temperature_source)) {
      warn(`curve: invalid temperature_source '${msg.temperature_source}', dropped`); return
    }
    f.source = msg.temperature_source
  }

  if (msg.mode === 'pid') {                             /* ADJ-4: PID 字段平铺 */
    const num = (k, d) => (Number.isFinite(Number(msg[k])) ? Number(msg[k]) : d)
    f.pid = {
      kp: num('kp', 2.0), ki: num('ki', 0.1), kd: num('kd', 0.5),
      setpoint_c: num('setpoint_c', 50.0),
    }
    f.integral = 0; f.lastErr = 0
    f.curve = 'pid'; f.mode = 'auto'
    log(`command/curve → fan ${idx} PID(kp=${f.pid.kp} ki=${f.pid.ki} kd=${f.pid.kd} sp=${f.pid.setpoint_c}) AUTO`)
    return
  }

  const pts = Array.isArray(msg.points) ? msg.points : null
  if (pts && pts.length > 0 && pts.length <= MAX_LUT_POINTS) {
    let ok = true
    for (let i = 0; i < pts.length; i++) {
      const t = Number(pts[i].temp_c), d = Number(pts[i].duty_pct)
      if (!Number.isFinite(t) || !Number.isFinite(d)) { ok = false; break }
      if (d > 100) { ok = false; break }
      if (i > 0 && !(t > Number(pts[i - 1].temp_c))) { ok = false; break }  /* FW-33 */
    }
    if (ok) {
      f.lut = pts.map((p) => ({ temp_c: Number(p.temp_c), duty_pct: Math.trunc(Number(p.duty_pct)) }))
      log(`command/curve → fan ${idx} LUT(${f.lut.length} 点, source=${f.source}) AUTO`)
    } else {
      warn('curve: LUT rejected (temp_c 必须严格递增 / duty<=100)')
    }
  } else {
    warn('command/curve: points 缺失或点数超限（1-10）')
  }
  f.curve = 'lut'
  f.mode = 'auto'
}

async function runOta(firmwareUrl, version) {
  log(`command/ota → 开始 OTA: ${firmwareUrl}`)
  const step = cfg.otaStepMs
  for (let pct = 0; pct <= 90; pct += 10) {
    publish(topicOf('ota', 'status'), {
      ...basePayload(), state: 'downloading', progress_pct: pct,
      message: 'Downloading firmware',
    }, { qos: 1 })
    await sleep(step)
  }
  publish(topicOf('ota', 'status'), {
    ...basePayload(), state: 'downloading', progress_pct: 100,
    message: 'Downloading firmware',
  }, { qos: 1 })
  publish(topicOf('ota', 'status'), {
    ...basePayload(), state: 'verifying', progress_pct: 100, message: 'Verifying image',
  }, { qos: 1 })
  await sleep(step)
  if (version) cfg.fwVersion = String(version)     /* 新固件版本生效 */
  publish(topicOf('ota', 'status'), {
    ...basePayload(), state: 'success', progress_pct: 100,
    message: 'OTA complete, rebooting',
  }, { qos: 1 })
  await sleep(step)
  simulateReboot('ota')
}

function handleOtaCommand(msg) {
  if (!msg.firmware_url || typeof msg.firmware_url !== 'string') {
    warn('command/ota: 缺少 firmware_url，忽略（对齐固件行为）'); return
  }
  if (st.otaRunning) { warn('command/ota: OTA 进行中，忽略重复触发'); return }
  st.otaRunning = true
  runOta(msg.firmware_url, msg.version).catch((e) => {
    warn('OTA 异常:', e.message)
  }).finally(() => { st.otaRunning = false })
}

function handleResetCommand(msg) {
  if (msg.confirm !== true) {
    warn('reset without confirm:true — ignored（协议 §4.4）'); return
  }
  log('command/reset confirm:true → 恢复默认阈值/曲线 + 重启')
  st.thresholds = { temp_warn_c: 75.0, temp_crit_c: 80.0, v12_min: 10.8, v12_max: 13.2,
                    stall_rpm: STALL_RPM, wifi_timeout_s: 60 }
  for (let i = 0; i < FAN_COUNT; i++) {
    const fresh = makeFan(i)
    st.fans[i].lut = fresh.lut
    st.fans[i].mode = 'auto'
    st.fans[i].curve = 'lut'
    st.fans[i].source = 'bme280'
  }
  simulateReboot('reset')
}

function handleConfigAlert(msg) {
  if (msg.get === true) {                       /* §6.2 get 回读 */
    log('config/alert get → 回读当前阈值')
    publish(topicOf('config', 'alert'), configAlertPayload(), { qos: 1 })
    return
  }
  if (!Array.isArray(msg.rules)) {
    warn('config/alert: no rules array, ignored'); return
  }
  const th = { ...st.thresholds }
  for (const rule of msg.rules) {
    if (!rule || typeof rule.type !== 'string') continue
    if (rule.enabled === false) continue                       /* 停用：保持默认 */
    const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : undefined)
    switch (rule.type) {
      case 'temperature_high': {
        const warnC = n(rule.warn_c) ?? n(rule.threshold)
        const critC = n(rule.crit_c)
        if (warnC !== undefined && warnC > 0) th.temp_warn_c = warnC
        if (critC !== undefined && critC > th.temp_warn_c) th.temp_crit_c = critC
        break
      }
      case 'fan_stall': {
        const v = n(rule.stall_rpm) ?? n(rule.threshold)
        if (v !== undefined && v > 0) th.stall_rpm = v
        break
      }
      case 'voltage_abnormal': {
        const lo = n(rule['12v_min']), hi = n(rule['12v_max'])
        if (lo !== undefined && lo > 0) th.v12_min = lo
        if (hi !== undefined && hi > th.v12_min) th.v12_max = hi
        break
      }
      case 'wifi_disconnected': {
        const v = n(rule.timeout_s) ?? n(rule.threshold)
        if (v !== undefined && v > 0) th.wifi_timeout_s = v
        break
      }
      default: warn(`config/alert: unknown rule type '${rule.type}'`)
    }
  }
  st.thresholds = th
  log(`config/alert 已应用: warn=${th.temp_warn_c} crit=${th.temp_crit_c} 12V=${th.v12_min}-${th.v12_max} stall=${th.stall_rpm} wifi=${th.wifi_timeout_s}s`)
}

function onMessage(topic, payload) {
  const parts = topic.split('/')
  if (parts[0] !== TOPIC_PREFIX || parts.length < 3) return
  if (parts[1] !== cfg.deviceId) {              /* FW-04: topic 设备归属校验 */
    warn(`command for other device '${parts[1]}', ignored`); return
  }
  let msg
  try {
    msg = JSON.parse(payload.toString())
  } catch {
    warn(`malformed JSON on ${topic}, ignored`); return
  }
  const route = parts.slice(2).join('/')
  switch (route) {
    case 'command/fan':    handleFanCommand(msg); break
    case 'command/curve':  handleCurveCommand(msg); break
    case 'command/ota':    handleOtaCommand(msg); break
    case 'command/reboot': log('command/reboot → 重启'); simulateReboot('reboot'); break
    case 'command/reset':  handleResetCommand(msg); break
    case 'config/alert':   handleConfigAlert(msg); break
    default: dbg('unhandled topic', topic)
  }
}

/* ========================================================================
 * 12. 连接 / 重启模拟
 * ====================================================================== */
function simulateReboot(reason) {
  if (st.rebooting) return
  st.rebooting = true
  log(`重启（${reason}）：发布 offline → 断开 → ${cfg.rebootMs}ms 后重连`)
  const c = client
  const payload = JSON.stringify({ timestamp: nowSec(), device_id: cfg.deviceId, status: 'offline' })

  const doDisconnect = () => {
    connected = false
    if (c) { try { c.end(true, {}, () => { /* closed */ }) } catch { /* noop */ } }
    setTimeout(() => {
      st.bootedAt = Date.now()
      st.ticks = 0
      st.rebooting = false
      for (const f of st.fans) f.mode = 'auto'   /* 真机重启后 MANUAL 运行态丢失，曲线取自 NVS */
      connect()
    }, cfg.rebootMs)
  }
  /* 先确认 offline（retained + QoS1）已被 broker 收下，再断开连接 */
  if (c && connected) c.publish(topicOf('status'), payload, { qos: 1, retain: true }, doDisconnect)
  else doDisconnect()
}

function connect() {
  const url = cfg.brokerUrl
  log(`连接 broker: ${url}（device_id=${cfg.deviceId}）`)
  const opts = {
    clientId: cfg.deviceId,                    /* 固件用 device_id 作 clientId */
    clean: true,
    keepalive: 30,
    reconnectPeriod: 5000,
    connectTimeout: 10000,
    will: {                                    /* §1.2 LWT：异常掉线 broker 自动发 offline */
      topic: topicOf('status'),
      payload: JSON.stringify({ timestamp: nowSec(), device_id: cfg.deviceId, status: 'offline' }),
      qos: 1,
      retain: true,
    },
  }
  client = mqtt.connect(url, opts)

  client.on('connect', () => {
    connected = true
    log('MQTT 已连接')
    publishStatus('online')
    st.lastStatusAt = Date.now()
    client.subscribe(topicOf('command', '#'), { qos: 1 }, (err) =>
      err ? warn('subscribe command/# 失败:', err.message) : log(`已订阅 ${topicOf('command', '#')}`))
    client.subscribe(topicOf('config', '#'), { qos: 1 }, (err) =>
      err ? warn('subscribe config/# 失败:', err.message) : log(`已订阅 ${topicOf('config', '#')}`))
  })
  client.on('message', onMessage)
  client.on('reconnect', () => dbg('reconnecting...'))
  client.on('close', () => { if (connected) log('MQTT 连接关闭'); connected = false })
  client.on('error', (e) => warn('MQTT 错误:', e.message))
}

function shutdown(signal) {
  log(`收到 ${signal}，发布 offline 并断开（优雅退出，不用 LWT）`)
  publishStatus('offline')
  setTimeout(() => {
    if (client) client.end(true, {}, () => process.exit(0))
    else process.exit(0)
  }, 200)
}

function main() {
  log(`无硬件协议模拟器启动 — protocol v1.0.1 / 设备 ${cfg.deviceId} / ${FAN_COUNT} 路风扇`)
  log(`上报周期: 传感器+风扇 ${cfg.tickMs}ms, 电压/内部温度 ${cfg.tickMs * 5}ms, status 心跳 ${cfg.statusIntervalS}s`)
  if (cfg.alertDemo) {
    log('告警演示: 首次延迟 ' + cfg.firstAlertS + 's' +
        (cfg.alertIntervalS > 0
          ? '，每 ' + cfg.alertIntervalS + 's 交替注入 warning/critical 温升事件'
          : '（SIM_ALERT_INTERVAL_S=0：只注入首次事件）'))
  } else {
    log('告警演示: 已关闭（SIM_ALERT_DEMO=0）')
  }
  if (cfg.stallFan >= 0 && cfg.stallFan < FAN_COUNT) {
    log(`故障注入: fan ${cfg.stallFan} 恒停转（触发 fan_stall 告警）`)
  }

  connect()

  setInterval(() => {
    if (!connected || st.rebooting) return
    const now = Date.now()
    const s = cfg.tickMs / 1000
    st.ticks += 1
    stepDemo(now)
    stepPhysics(now, s)
    updateFans(s)
    publishTelemetry(now)
    evaluateAlerts()
  }, cfg.tickMs)

  process.on('SIGINT',  () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

main()
