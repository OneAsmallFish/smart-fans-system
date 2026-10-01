// src/mqtt.ts — MQTT 订阅 + 设备状态缓存 + WebSocket 推送
// WEB-03: FAN_COUNT=8；WEB-04: 订阅 sensor/#（吃到 /buffered 五级 topic）
// 与 ota/status（OTA 进度经 WebSocket 转发前端）。
import mqtt from 'mqtt'
import { WebSocketServer, WebSocket } from 'ws'
import { FAN_COUNT, type DeviceState, type FanState } from './types.js'
import { recordSample } from './history.js'

const TOPIC_PREFIX = 'fan-controller'
const WS_PUSH_INTERVAL_MS = 2000

const devices = new Map<string, DeviceState>()

function getOrCreate(deviceId: string): DeviceState {
  if (!devices.has(deviceId)) {
    devices.set(deviceId, {
      deviceId,
      online: false,
      lastSeen: Date.now(),
      sensors: {},
      fans: Array.from({ length: FAN_COUNT }, (_, i): FanState => ({
        fan_index: i, pwm_duty_pct: 0, rpm: 0, stalled: false, mode: 'auto',
      })),
      alerts: [],
    })
  }
  return devices.get(deviceId)!
}

export function getDevices() { return devices }

/** /health 用：当前 MQTT 链路状态 */
export function mqttConnected(): boolean {
  return !!mqttClient?.connected
}

/** 曲线下发后由 REST 路由调用：写入回读缓存（设备侧无回读协议） */
export function setDeviceCurve(deviceId: string, fanIdx: number, cfg: import('./types.js').CurveCache) {
  const d = getOrCreate(deviceId)
  d.curves = { ...d.curves, [String(fanIdx)]: cfg }
}

let mqttClient: ReturnType<typeof mqtt.connect> | null = null

export function setupMQTT(brokerUrl: string, wss: WebSocketServer) {
  mqttClient = mqtt.connect(brokerUrl, {
    clientId: `smart-fan-web-${Math.random().toString(36).slice(2, 8)}`,
    reconnectPeriod: 5000,
  })

  mqttClient.on('connect', () => {
    console.log(`[mqtt] connected to ${brokerUrl}`)
    mqttClient!.subscribe(`${TOPIC_PREFIX}/+/status`)
    mqttClient!.subscribe(`${TOPIC_PREFIX}/+/sensor/#`)       // WEB-04: # 吃 buffered
    mqttClient!.subscribe(`${TOPIC_PREFIX}/+/fan/+/state`)
    mqttClient!.subscribe(`${TOPIC_PREFIX}/+/alert`)
    mqttClient!.subscribe(`${TOPIC_PREFIX}/+/ota/status`)     // WEB-04: OTA 进度
    mqttClient!.subscribe(`${TOPIC_PREFIX}/+/config/#`)       // alert/curve 回读（协议 §6）
  })

  mqttClient.on('message', (topic: string, payload: Buffer) => {
    try {
      const parts = topic.split('/')
      if (parts.length < 3 || parts[0] !== TOPIC_PREFIX) return
      const deviceId = parts[1]
      const device = getOrCreate(deviceId)
      device.lastSeen = Date.now()

      const data = JSON.parse(payload.toString())

      if (parts[2] === 'status') {
        device.online    = data.status === 'online'
        device.firmware  = data.firmware_version
        device.ipAddress = data.ip_address
        if (typeof data.uptime_seconds === 'number') device.uptime_s = data.uptime_seconds

      } else if (parts[2] === 'sensor') {
        // parts[3]=type；parts[4]==='buffered' 时为离线补发（同 schema）
        const sensorType = parts[3]
        if (sensorType === 'bme280') {
          device.sensors.bme280 = { ...data }
        } else if (sensorType === 'ds18b20' && Array.isArray(data.sensors)) {
          device.sensors.ds18b20 = data.sensors
        } else if (sensorType === 'voltage') {
          device.sensors.voltage = { ...data }
        } else if (sensorType === 'internal_temp') {
          device.sensors.internal_temp = data.temperature_c
        }

      } else if (parts[2] === 'fan' && parts[4] === 'state') {
        const idx = parseInt(parts[3])
        if (idx >= 0 && idx < FAN_COUNT) device.fans[idx] = { ...data }

      } else if (parts[2] === 'alert') {
        const ev = { ...data }
        device.alerts.unshift(ev)
        if (device.alerts.length > 100) device.alerts.length = 100

      } else if (parts[2] === 'ota' && parts[3] === 'status') {
        device.ota = { ...data }   // WEB-04: 前端经 WebSocket 读到进度

      } else if (parts[2] === 'config') {
        // 协议 §6: 设备对 config/{section} {get:true} 的应答原样缓存，随 WS 推给前端
        const section = parts[3]
        if (section === 'alert') {
          device.config = { ...device.config, alert: data }
        } else if (section === 'curve' && parts[4] !== undefined) {
          device.curves = { ...device.curves, [parts[4]]: { ...data, timestamp: data.timestamp ?? Math.floor(Date.now() / 1000) } }
        }
      }
    } catch { /* malformed JSON — ignore */ }
  })

  // Broadcast device state to all WebSocket clients every 2s (同步采集历史样本)
  setInterval(() => {
    for (const d of devices.values()) {
      if (d.online) recordSample(d.deviceId, d)
    }
    const payload = JSON.stringify({
      type: 'devices',
      data: [...devices.values()],
    })
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(payload)
    })
  }, WS_PUSH_INTERVAL_MS)
}

export function publishCommand(deviceId: string, action: string, body: unknown) {
  return publishTo(`${TOPIC_PREFIX}/${deviceId}/command/${action}`, body)
}

/** WEB-05: 配置类 topic（config/alert 等，协议 §6） */
export function publishConfig(deviceId: string, section: string, body: unknown) {
  return publishTo(`${TOPIC_PREFIX}/${deviceId}/config/${section}`, body)
}

export function publishTo(topic: string, body: unknown) {
  if (!mqttClient?.connected) return false
  mqttClient.publish(topic, JSON.stringify(body), { qos: 1 })
  return true
}
