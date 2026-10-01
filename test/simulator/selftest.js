#!/usr/bin/env node
/**
 * selftest.js — 无硬件模拟器「协议契约自检」
 *
 * 启动一份模拟器子进程，用独立 MQTT 客户端按 docs/protocol.md v1.0.1 断言
 * topic 树、payload 字段、QoS/retain、命令回执与 LWT 行为。
 * 输出为可直接引用的联调证据（PASS/FAIL 汇总）。
 *
 * 用法:
 *   node selftest.js                                   # 默认 broker localhost:1883
 *   node selftest.js --broker mqtt://192.168.3.131:1883
 *   node selftest.js --broker mqtt://192.168.3.131:1883 --device esp32-sim0001 --verbose
 */
import mqtt from 'mqtt'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SIM = path.join(HERE, 'simulator.js')

const argv = process.argv.slice(2)
const argVal = (flag) => {
  const i = argv.indexOf(flag)
  return (i >= 0 && i + 1 < argv.length) ? argv[i + 1] : undefined
}
const VERBOSE = argv.includes('--verbose') || argv.includes('-v')
const BROKER = argVal('--broker') ?? argVal('-b') ?? process.env.MQTT_URL ?? 'mqtt://localhost:1883'
const DEV1 = argVal('--device') ?? argVal('-d') ?? 'esp32-sim0001'
const DEV2 = DEV1 + 'b'

const PREFIX = 'fan-controller'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const nowSec = () => Math.floor(Date.now() / 1000)

let PASS = 0, FAIL = 0
const green = (s) => '\u001b[32m' + s + '\u001b[0m'
const red = (s) => '\u001b[31m' + s + '\u001b[0m'
function check(name, ok, detail) {
  if (ok) { PASS++; console.log(green('[PASS]') + ' ' + name + (detail ? '  — ' + detail : '')) }
  else    { FAIL++; console.log(red('[FAIL]') + ' ' + name + (detail ? '  — ' + detail : '')) }
  return ok
}
const info = (s) => console.log('\u001b[33m[INFO]\u001b[0m ' + s)

/* ------------------------------------------------------------------ */
/* 观察者：独立客户端，订阅 fan-controller/{device}/#（QoS1）           */
/* ------------------------------------------------------------------ */
async function makeObserver(deviceId) {
  const messages = []
  let startAt = Date.now()
  const client = mqtt.connect(BROKER, {
    clientId: 'sim-selftest-' + Math.random().toString(36).slice(2, 8),
    connectTimeout: 8000,
    reconnectPeriod: 2000,
  })
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('观察者连接 broker 超时: ' + BROKER)), 10000)
    client.once('connect', () => { clearTimeout(t); res() })
    client.once('error', (e) => { clearTimeout(t); rej(e) })
  })
  await new Promise((res) => client.subscribe(PREFIX + '/' + deviceId + '/#', { qos: 1 }, res))
  client.on('message', (topic, buf, packet) => {
    let json = null
    try { json = JSON.parse(buf.toString()) } catch { /* 非 JSON */ }
    messages.push({ topic, raw: buf.toString(), json, retain: !!packet.retain, qos: packet.qos, at: Date.now() })
    if (VERBOSE) console.log('  <-- [' + packet.qos + (packet.retain ? '/R' : '') + '] ' + topic + ' ' + buf.toString())
  })
  await sleep(400)
  startAt = Date.now()          /* 忽略订阅瞬间到达的历史 retained 报文 */
  return {
    client,
    messages,
    mark: () => Date.now(),
    topic: (suffix) => PREFIX + '/' + deviceId + '/' + suffix,
    hits(topic, since) {
      return messages.filter((m) => m.topic === topic && m.at >= (since ?? startAt))
    },
    /* 等待某条件成立，返回布尔 */
    async waitFor(pred, timeoutMs, label) {
      const t0 = Date.now()
      while (Date.now() - t0 < timeoutMs) {
        const hit = messages.find(pred)
        if (hit) return hit
        await sleep(100)
      }
      if (label) console.log('  (timeout) ' + label)
      return null
    },
    async end() { await new Promise((res) => client.end(true, {}, res)) },
  }
}

/* ------------------------------------------------------------------ */
/* retained 语义验证：新订阅者的第一条报文才带 retain=1（MQTT 3.1.1）    */
/* ------------------------------------------------------------------ */
const tryParse = (s) => { try { return JSON.parse(s) } catch { return null } }

async function retainedSnapshot(topic, timeoutMs = 5000) {
  const client = mqtt.connect(BROKER, {
    clientId: 'sim-retain-' + Math.random().toString(36).slice(2, 8),
    connectTimeout: 8000, reconnectPeriod: 0,
  })
  try {
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('retained 观察连接超时')), 10000)
      client.once('connect', () => { clearTimeout(t); res() })
      client.once('error', (e) => { clearTimeout(t); rej(e) })
    })
    return await new Promise((res) => {
      const t = setTimeout(() => res(null), timeoutMs)
      client.once('message', (tp, buf, packet) => {
        clearTimeout(t)
        res({ topic: tp, raw: buf.toString(), json: tryParse(buf.toString()), retain: !!packet.retain })
      })
      client.subscribe(topic, { qos: 1 })
    })
  } finally {
    client.end(true, {}, () => { /* closed */ })
  }
}

/* ------------------------------------------------------------------ */
/* 模拟器子进程                                                        */
/* ------------------------------------------------------------------ */
function startSim(deviceId, extraEnv) {
  const env = {
    ...process.env,
    MQTT_URL: BROKER,
    SIM_DEVICE_ID: deviceId,
    SIM_LOG: VERBOSE ? 'debug' : 'info',
    ...extraEnv,
  }
  const child = spawn(process.execPath, [SIM], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', (d) => { if (VERBOSE) process.stdout.write('  [sim] ' + d.toString().replace(/\n$/, '\n')) })
  child.stderr.on('data', (d) => process.stderr.write('  [sim:err] ' + d.toString()))
  return child
}
async function stopSim(child, signal) {
  if (!child || child.exitCode !== null) return
  child.kill(signal || 'SIGINT')
  const t0 = Date.now()
  while (child.exitCode === null && Date.now() - t0 < 4000) await sleep(100)
}

/* ================================================================== */
/* 场景 1：遥测契约 + 命令回执 + OTA + 重启 + LWT                        */
/* ================================================================== */
async function scenario1() {
  info('=== 场景 1：遥测 / 调速 / 曲线 / 越界防御 / OTA / 重启 / LWT （设备 ' + DEV1 + '）===')
  const obs = await makeObserver(DEV1)
  /* 关闭自动告警演示，避免温升事件干扰调速断言 */
  const sim = startSim(DEV1, { SIM_ALERT_DEMO: '0', SIM_TICK_MS: '1000' })

  try {
    /* --- A 遥测契约（观察 8s，覆盖 1s/5s 两级周期） --- */
    info('A. 遥测契约（status/bme280/ds18b20/voltage/internal_temp/8 路 fan state）')
    await sleep(8000)
    const statusMsgs = obs.hits(obs.topic('status'))
    const online = statusMsgs.filter((m) => m.json && m.json.status === 'online')
    const s0 = online[0]
    check('A1 status online 已上报', !!s0, s0 ? s0.raw : 'no online status')
    if (s0) {
      const j = s0.json
      check('A2 status 字段完整（timestamp/device_id/status/firmware_version/ip_address/uptime_seconds）',
        typeof j.timestamp === 'number' && j.device_id === DEV1 && j.status === 'online' &&
        typeof j.firmware_version === 'string' && typeof j.ip_address === 'string' &&
        typeof j.uptime_seconds === 'number', s0.raw)
      const retainedStatus = await retainedSnapshot(obs.topic('status'))
      check('A3 status QoS=1，且 retained 下发（retain=true，协议 §1.1，HA availability 依赖）',
        s0.qos === 1 && !!retainedStatus && retainedStatus.retain === true &&
        retainedStatus.json && retainedStatus.json.status === 'online',
        'qos=' + s0.qos + ' retained-delivery-retain=' + (retainedStatus && retainedStatus.retain) +
        ' payload=' + (retainedStatus && retainedStatus.raw))
      check('A4 timestamp 为 Unix 秒（FW-15，|now-ts|<=60s）',
        j.timestamp >= 1000000000 && Math.abs(nowSec() - j.timestamp) <= 60, 'ts=' + j.timestamp)
    }

    const bme = obs.hits(obs.topic('sensor/bme280'))
    check('A5 sensor/bme280 周期上报（8s 内 >=4 条 @1s）', bme.length >= 4, bme.length + ' 条')
    if (bme.length) {
      const j = bme[bme.length - 1].json
      check('A6 bme280 字段契约（temperature_c/humidity_pct/pressure_hpa/timestamp/device_id）',
        typeof j.temperature_c === 'number' && typeof j.humidity_pct === 'number' &&
        typeof j.pressure_hpa === 'number' && typeof j.timestamp === 'number' && j.device_id === DEV1,
        JSON.stringify(j))
      check('A7 bme280 数值漂移（History 曲线数据源）',
        new Set(bme.map((m) => m.json.temperature_c)).size > 1,
        'distinct=' + new Set(bme.map((m) => m.json.temperature_c)).size)
      check('A8 sensor QoS=0（协议 §2 高频遥测）', bme[0].qos === 0, 'qos=' + bme[0].qos)
    }

    const ds = obs.hits(obs.topic('sensor/ds18b20'))
    const dsLast = ds.length ? ds[ds.length - 1].json : null
    check('A9 sensor/ds18b20 sensors[] 按 address/valid/temperature_c 上报（ADJ-6）',
      !!dsLast && Array.isArray(dsLast.sensors) && dsLast.sensors.length === 2 &&
      dsLast.sensors.every((s) => typeof s.address === 'string' && typeof s.valid === 'boolean' &&
                                   typeof s.temperature_c === 'number'),
      dsLast ? JSON.stringify(dsLast.sensors) : 'no ds18b20')

    const volt = obs.hits(obs.topic('sensor/voltage'))
    const voltLast = volt.length ? volt[volt.length - 1].json : null
    check('A10 sensor/voltage 三路电压（voltage_12v/5v/3v3）',
      !!voltLast && typeof voltLast.voltage_12v === 'number' &&
      typeof voltLast.voltage_5v === 'number' && typeof voltLast.voltage_3v3 === 'number',
      voltLast ? JSON.stringify(voltLast) : 'no voltage')

    const it = obs.hits(obs.topic('sensor/internal_temp'))
    check('A11 sensor/internal_temp 上报 MCU 温度',
      it.length > 0 && typeof it[it.length - 1].json.temperature_c === 'number',
      it.length ? it[it.length - 1].raw : 'no internal_temp')

    const fanSeen = new Set()
    for (let i = 0; i < 8; i++) {
      const h = obs.hits(obs.topic('fan/' + i + '/state'))
      if (h.length) fanSeen.add(i)
    }
    check('A12 8 路 fan/{0-7}/state 全部上报（ADJ-13）', fanSeen.size === 8, 'seen=' + [...fanSeen].join(','))
    const f0 = obs.hits(obs.topic('fan/0/state'))
    if (f0.length) {
      const j = f0[f0.length - 1].json
      check('A13 fan state 字段契约（fan_index/pwm_duty_pct/rpm/stalled/mode）',
        j.fan_index === 0 && typeof j.pwm_duty_pct === 'number' && typeof j.rpm === 'number' &&
        typeof j.stalled === 'boolean' && ['auto', 'manual'].includes(j.mode), JSON.stringify(j))
      check('A14 fan state QoS=0（协议 §3）', f0[0].qos === 0, 'qos=' + f0[0].qos)
    }

    /* --- B 手动调速 + rpm 随动 --- */
    info('B. command/fan 手动调速（MANUAL）与 rpm 随动')
    const markB = obs.mark()
    obs.client.publish(obs.topic('command/fan'),
      JSON.stringify({ timestamp: nowSec(), device_id: DEV1, fan_index: 2, mode: 'manual', duty_pct: 75 }), { qos: 1 })
    const b1 = await obs.waitFor((m) => m.topic === obs.topic('fan/2/state') && m.at >= markB &&
      m.json && m.json.pwm_duty_pct === 75 && m.json.mode === 'manual', 6000, 'fan2 duty=75/manual')
    check('B1 command/fan 回执：fan/2/state pwm_duty_pct=75 且 mode=manual', !!b1, b1 ? b1.raw : 'timeout')
    const b2 = await obs.waitFor((m) => m.topic === obs.topic('fan/2/state') && m.at >= markB &&
      m.json && m.json.rpm > 1500, 8000, 'fan2 rpm 跟随')
    check('B2 duty 下发后 rpm 随动（>1500 RPM）', !!b2, b2 ? 'rpm=' + b2.json.rpm : 'timeout')

    obs.client.publish(obs.topic('command/fan'),
      JSON.stringify({ timestamp: nowSec(), device_id: DEV1, fan_index: 2, mode: 'manual', duty_pct: 0 }), { qos: 1 })
    const b3 = await obs.waitFor((m) => m.topic === obs.topic('fan/2/state') && m.at >= markB &&
      m.json && m.json.pwm_duty_pct === 0 && m.json.rpm < 200, 10000, 'fan2 duty=0 rpm<200')
    check('B3 duty=0 后 rpm 衰减到 <200（合法停转）', !!b3, b3 ? b3.raw : 'timeout')

    /* --- C AUTO 切换（command/curve LUT） --- */
    info('C. command/curve → AUTO（LUT 查表）')
    const markC = obs.mark()
    obs.client.publish(obs.topic('command/curve'), JSON.stringify({
      timestamp: nowSec(), device_id: DEV1, fan_index: 2, mode: 'lut', temperature_source: 'bme280',
      points: [{ temp_c: 30, duty_pct: 20 }, { temp_c: 70, duty_pct: 100 }],
    }), { qos: 1 })
    const c1 = await obs.waitFor((m) => m.topic === obs.topic('fan/2/state') && m.at >= markC &&
      m.json && m.json.mode === 'auto', 6000, 'fan2 mode=auto')
    check('C1 command/curve 回执：fan/2/state mode=auto（MANUAL→AUTO）', !!c1, c1 ? c1.raw : 'timeout')
    if (c1) {
      const lastBme = obs.hits(obs.topic('sensor/bme280')).pop()
      const temp = lastBme && lastBme.json ? lastBme.json.temperature_c : null
      const expect = temp === null ? null
        : temp <= 30 ? 20 : temp >= 70 ? 100 : Math.round(20 + (temp - 30) / 40 * 80)
      check('C2 AUTO 占空比符合 LUT 线性插值（±6%）',
        expect !== null && Math.abs(c1.json.pwm_duty_pct - expect) <= 6,
        'temp=' + temp + ' expect=' + expect + ' actual=' + c1.json.pwm_duty_pct)
    }

    /* --- D 越界防御（FW-20⑤） --- */
    info('D. 越界命令防御（fan_index/duty 越界丢弃，FW-20⑤）')
    const before1 = obs.hits(obs.topic('fan/1/state')).pop()
    const markD = obs.mark()
    obs.client.publish(obs.topic('command/fan'),
      JSON.stringify({ timestamp: nowSec(), device_id: DEV1, fan_index: 9, duty_pct: 50 }), { qos: 1 })
    obs.client.publish(obs.topic('command/fan'),
      JSON.stringify({ timestamp: nowSec(), device_id: DEV1, fan_index: 1, duty_pct: 150 }), { qos: 1 })
    obs.client.publish(obs.topic('command/curve'),
      JSON.stringify({ timestamp: nowSec(), device_id: DEV1, fan_index: 0, mode: 'lut',
        temperature_source: 'gpu', points: [{ temp_c: 30, duty_pct: 20 }] }), { qos: 1 })
    await sleep(3000)
    check('D1 fan_index=9 越界：无 fan/9/state 产生',
      obs.hits(obs.topic('fan/9/state')).length === 0, 'messages=' + obs.hits(obs.topic('fan/9/state')).length)
    const after1 = obs.hits(obs.topic('fan/1/state'), markD).pop()
    check('D2 duty=150 越界：fan/1 状态未被改写（仍为 auto）',
      !!after1 && after1.json.mode === 'auto' && !!before1 && after1.json.pwm_duty_pct === before1.json.pwm_duty_pct,
      after1 ? after1.raw : 'no fan1 state')
    check('D3 非法 temperature_source=gpu 被丢弃（ADJ-5 枚举）',
      obs.hits(obs.topic('fan/0/state'), markD).every((m) => m.json && m.json.mode === 'auto'),
      'fan0 未进入 manual')
    check('D4 越界/非法命令后设备仍存活（遥测继续）',
      obs.hits(obs.topic('sensor/bme280'), markD).length >= 2,
      obs.hits(obs.topic('sensor/bme280'), markD).length + ' 条')

    /* --- E 重启回执 --- */
    info('E. command/reboot → offline 回执 → 重连 online')
    const markE = obs.mark()
    obs.client.publish(obs.topic('command/reboot'),
      JSON.stringify({ timestamp: nowSec(), device_id: DEV1 }), { qos: 1 })
    const off = await obs.waitFor((m) => m.topic === obs.topic('status') && m.at >= markE &&
      m.json && m.json.status === 'offline', 8000, 'status offline')
    check('E1 reboot 回执 1/2：status=offline（retain）', !!off, off ? off.raw : 'timeout')
    const on2 = await obs.waitFor((m) => m.topic === obs.topic('status') && m.at >= markE &&
      m.json && m.json.status === 'online' && m.json.uptime_seconds <= 15, 12000, 'status online after reboot')
    check('E2 reboot 回执 2/2：重连后 status=online 且 uptime 归零', !!on2, on2 ? on2.raw : 'timeout')

    /* --- F OTA --- */
    info('F. command/ota → ota/status 进度（downloading→verifying→success）→ 重启')
    const markF = obs.mark()
    obs.client.publish(obs.topic('command/ota'), JSON.stringify({
      timestamp: nowSec(), device_id: DEV1,
      firmware_url: 'https://example.com/firmware/v9.9.9.bin',
      version: 'v9.9.9', checksum_sha256: 'a1b2c3d4',
    }), { qos: 1 })
    const otaTarget = obs.topic('ota/status')
    const dl = await obs.waitFor((m) => m.topic === otaTarget && m.at >= markF &&
      m.json && m.json.state === 'downloading', 8000, 'ota downloading')
    check('F1 ota/status state=downloading + progress_pct（协议 §7）',
      !!dl && typeof dl.json.progress_pct === 'number' && typeof dl.json.message === 'string',
      dl ? dl.raw : 'timeout')
    const ver = await obs.waitFor((m) => m.topic === otaTarget && m.at >= markF &&
      m.json && m.json.state === 'verifying', 20000, 'ota verifying')
    check('F2 ota/status state=verifying', !!ver, ver ? ver.raw : 'timeout')
    const suc = await obs.waitFor((m) => m.topic === otaTarget && m.at >= markF &&
      m.json && m.json.state === 'success', 20000, 'ota success')
    check('F3 ota/status state=success（即将重启）', !!suc, suc ? suc.raw : 'timeout')
    const dlMsgs = obs.hits(otaTarget, markF).filter((m) => m.json && m.json.state === 'downloading')
    const pcts = dlMsgs.map((m) => m.json.progress_pct)
    check('F4 downloading 进度单调不减且覆盖 0→100',
      pcts.length >= 3 && pcts[0] === 0 && pcts[pcts.length - 1] === 100 &&
      pcts.every((p, i) => i === 0 || p >= pcts[i - 1]),
      'pcts=' + pcts.join(','))
    check('F5 ota/status QoS=1（协议 §7）', dlMsgs.length > 0 && dlMsgs[0].qos === 1, 'qos=' + (dlMsgs[0] && dlMsgs[0].qos))
    const on3 = await obs.waitFor((m) => m.topic === obs.topic('status') && m.at >= markF &&
      m.json && m.json.status === 'online' && m.json.firmware_version === 'v9.9.9', 20000, 'online after ota')
    check('F6 OTA 成功后重启并上报新固件版本 v9.9.9', !!on3, on3 ? on3.raw : 'timeout')

    /* --- G LWT（异常掉线） --- */
    info('G. LWT 遗嘱：客户端异常掉线（SIGKILL）→ broker 自动发 offline')
    const markG = obs.mark()
    sim.kill('SIGKILL')
    const lwt = await obs.waitFor((m) => m.topic === obs.topic('status') && m.at >= markG &&
      m.json && m.json.status === 'offline', 12000, 'LWT offline')
    check('G1 SIGKILL 后 broker 自动发布 status=offline（LWT retained）', !!lwt, lwt ? lwt.raw : 'timeout')
    if (lwt) {
      check('G2 LWT payload 含 timestamp/device_id/status 三字段（协议 §1.2）',
        typeof lwt.json.timestamp === 'number' && lwt.json.device_id === DEV1 && lwt.json.status === 'offline',
        lwt.raw)
      const retainedLwt = await retainedSnapshot(obs.topic('status'))
      check('G3 LWT 为 retained 遗嘱（新订阅者收到 retain=true 的 offline，HA availability 依赖）',
        !!retainedLwt && retainedLwt.retain === true && retainedLwt.json && retainedLwt.json.status === 'offline',
        'retained-delivery-retain=' + (retainedLwt && retainedLwt.retain) +
        ' payload=' + (retainedLwt && retainedLwt.raw))
    }
  } finally {
    await stopSim(sim)
    await obs.end()
  }
}

/* ================================================================== */
/* 场景 2：告警契约（事件 topic + per-type retained 状态 topic）          */
/* ================================================================== */
async function scenario2() {
  info('')
  info('=== 场景 2：告警契约（alert 事件 + alert/{type}/state retained）设备 ' + DEV2 + ' ===')
  const obs = await makeObserver(DEV2)
  /* 3s 后注入 critical 温升事件（持续 12s）+ 强制 fan 3 停转 */
  const sim = startSim(DEV2, {
    SIM_ALERT_DEMO: '1',
    SIM_ALERT_INTERVAL_S: '0',
    SIM_ALERT_KIND: 'critical',
    SIM_FIRST_ALERT_S: '3',
    SIM_EXCURSION_S: '12',
    SIM_TICK_MS: '1000',
    SIM_STALL_FAN: '3',
  })

  try {
    const alertTopic = obs.topic('alert')
    const stall = await obs.waitFor((m) => m.topic === alertTopic && m.json &&
      m.json.alert_type === 'fan_stall', 15000, 'fan_stall 事件')
    check('H1 fan_stall 告警事件（duty>5% 且 RPM<200，severity=critical）',
      !!stall && stall.json.severity === 'critical', stall ? stall.raw : 'timeout')
    if (stall) {
      check('H2 告警事件字段契约 §5.1（alert_type/severity/message/value/threshold/sensor/device_id/timestamp）',
        typeof stall.json.timestamp === 'number' && stall.json.device_id === DEV2 &&
        typeof stall.json.message === 'string' && typeof stall.json.value === 'number' &&
        typeof stall.json.threshold === 'number' && typeof stall.json.sensor === 'string',
        JSON.stringify(stall.json))
      check('H3 告警事件 QoS=1（协议 §5）', stall.qos === 1, 'qos=' + stall.qos)
    }

    const tempAlert = await obs.waitFor((m) => m.topic === alertTopic && m.json &&
      m.json.alert_type === 'temperature_high', 40000, 'temperature_high 事件')
    check('H4 temperature_high 告警事件（阈值模型 >75°C 警告 / >80°C 严重）',
      !!tempAlert && tempAlert.json.value > 75 && tempAlert.json.threshold === 75,
      tempAlert ? tempAlert.raw : 'timeout')
    check('H5 temperature_high 严重度达 critical（注入突发故障 >80°C）',
      !!tempAlert && tempAlert.json.severity === 'critical', tempAlert ? tempAlert.json.severity : 'n/a')

    const stateTopic = obs.topic('alert/temperature_high/state')
    const activeState = await obs.waitFor((m) => m.topic === stateTopic && m.json &&
      m.json.active === true, 8000, 'retained active=true')
    check('H6 per-type retained 状态 topic active=true（HA binary_sensor，ADJ-8）',
      !!activeState, activeState ? activeState.raw : 'timeout')
    if (activeState) {
      const retainedState = await retainedSnapshot(stateTopic)
      check('H7 状态 topic 为 retained（新订阅者 retain=true）且 payload 含 active/severity/timestamp',
        !!retainedState && retainedState.retain === true && retainedState.json &&
        typeof retainedState.json.active === 'boolean' &&
        typeof retainedState.json.severity === 'string' &&
        typeof retainedState.json.timestamp === 'number',
        'retained-delivery-retain=' + (retainedState && retainedState.retain) +
        ' payload=' + (retainedState && retainedState.raw))
    }
    const clearState = await obs.waitFor((m) => m.topic === stateTopic && m.json &&
      m.json.active === false, 30000, 'retained active=false（恢复）')
    check('H8 告警恢复：per-type retained 状态回到 active=false', !!clearState, clearState ? clearState.raw : 'timeout')

    const vTopic = obs.topic('alert/voltage_abnormal/state')
    const vHits = obs.hits(vTopic)
    check('H9 voltage_abnormal per-type 状态 topic 触发（12V 跌落演示，retained active=true）',
      vHits.some((m) => m.json && m.json.active === true),
      vHits.map((m) => m.raw).join(' | ') || 'none')
  } finally {
    await stopSim(sim, 'SIGINT')
    await sleep(500)
    await obs.end()
  }
}

/* ================================================================== */
async function main() {
  console.log('=== 无硬件协议模拟器 自检（协议 v1.0.1）===')
  console.log('broker: ' + BROKER)
  console.log('simulator: ' + SIM)
  console.log('')
  await scenario1()
  await scenario2()
  console.log('')
  console.log('================================================')
  console.log('  Contract Self-Test Summary')
  console.log('================================================')
  console.log('  PASS: ' + PASS + '    FAIL: ' + FAIL)
  console.log('================================================')
  if (FAIL === 0) { console.log(green('OK 全部契约断言通过') + ' (' + PASS + ' 项)'); process.exit(0) }
  console.log(red('FAILED ' + FAIL + ' 项契约断言未通过'))
  process.exit(1)
}

main().catch((e) => { console.error('自检异常:', e); process.exit(2) })
