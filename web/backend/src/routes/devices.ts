// src/routes/devices.ts — REST API 端点 (Zod 校验 + 统一响应)
// WEB-05: alert 端点改发 config/alert（协议 §6.2，原 command/alert 不存在）；
// CurveSchema pid 字段平铺（ADJ-4）+ temperature_source 枚举（ADJ-5）。
import { Router } from 'express'
import { z } from 'zod'
import { getDevices, setDeviceCurve, publishCommand, publishConfig } from '../mqtt.js'
import { getHistory } from '../history.js'

const router = Router()

// 统一响应格式
function ok(data: unknown) { return { ok: true, data } }
function fail(error: string, status = 400) { return { ok: false, error, status } }

function send(res: any, result: any) {
  const s = result.status ?? 200
  delete result.status
  res.status(s).json(result)
}

// GET /api/devices
router.get('/', (_req, res) => {
  const list = [...getDevices().values()]
  res.json(ok(list))
})

// GET /api/devices/:id
router.get('/:id', (req, res) => {
  const device = getDevices().get(req.params.id)
  if (!device) return send(res, fail('device not found', 404))
  res.json(ok(device))
})

// GET /api/devices/:id/history?from&to — 环形缓冲真实数据（内存态，重启清零）
// 降采样至 ≤600 点，保证前端渲染与传输体积可控
router.get('/:id/history', (req, res) => {
  const to = Math.min(Number(req.query.to) || Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000))
  const from = Math.max(Number(req.query.from) || to - 3600, to - 24 * 3600)
  const all = getHistory(req.params.id, from, to)
  const step = Math.max(1, Math.ceil(all.length / 600))
  const points = all.filter((_, i) => i % step === 0 || i === all.length - 1)
  res.json(ok({ deviceId: req.params.id, from, to, points }))
})

// POST /api/devices/:id/fan/:fanIdx  { speed: 0-100 }
const FanSchema = z.object({ speed: z.number().int().min(0).max(100) })
router.post('/:id/fan/:fanIdx', (req, res) => {
  const parsed = FanSchema.safeParse(req.body)
  if (!parsed.success) return send(res, fail(parsed.error.message))
  const idx = parseInt(req.params.fanIdx)
  const published = publishCommand(req.params.id, 'fan', {
    fan_index: idx, mode: 'manual', duty_pct: parsed.data.speed,
    timestamp: Math.floor(Date.now() / 1000),
  })
  res.json(ok({ queued: published, fan_index: idx, speed: parsed.data.speed }))
})

// POST /api/devices/:id/fan/:fanIdx/curve
// ADJ-4: PID 字段平铺在 payload 顶层（kp/ki/kd/setpoint_c）
// ADJ-5: temperature_source 限 4 个合法字符串
const TEMP_SOURCES = ['bme280', 'ds18b20_0', 'ds18b20_1', 'internal'] as const
const CurveSchema = z.object({
  mode: z.enum(['lut', 'pid']),
  temperature_source: z.enum(TEMP_SOURCES).optional(),
  points: z.array(z.object({
    temp_c: z.number(),
    duty_pct: z.number().int().min(0).max(100),
  })).max(10).optional(),
  kp: z.number().optional(),
  ki: z.number().optional(),
  kd: z.number().optional(),
  setpoint_c: z.number().optional(),
})
router.post('/:id/fan/:fanIdx/curve', (req, res) => {
  const parsed = CurveSchema.safeParse(req.body)
  if (!parsed.success) return send(res, fail(parsed.error.message))
  const { points, ...rest } = parsed.data
  const clampedPoints = points?.map(p => ({
    temp_c: p.temp_c,
    duty_pct: Math.max(0, Math.min(100, p.duty_pct)),
  }))
  publishCommand(req.params.id, 'curve', {
    fan_index: parseInt(req.params.fanIdx),
    timestamp: Math.floor(Date.now() / 1000),
    ...rest,
    ...(clampedPoints ? { points: clampedPoints } : {}),
  })
  // 回读缓存（设备侧无 curve 回读协议，WEB 重构：UI 依此回显）
  setDeviceCurve(req.params.id, parseInt(req.params.fanIdx), {
    mode: rest.mode,
    temperature_source: rest.temperature_source,
    ...(clampedPoints ? { points: clampedPoints } : {}),
    ...(rest.kp !== undefined ? { kp: rest.kp } : {}),
    ...(rest.ki !== undefined ? { ki: rest.ki } : {}),
    ...(rest.kd !== undefined ? { kd: rest.kd } : {}),
    ...(rest.setpoint_c !== undefined ? { setpoint_c: rest.setpoint_c } : {}),
    timestamp: Math.floor(Date.now() / 1000),
  })
  res.json(ok({ applied: true }))
})

// GET /api/devices/:id/curve/:fanIdx — 最近一次下发的曲线（回读缓存；设备侧无回读协议）
router.get('/:id/curve/:fanIdx', (req, res) => {
  const cached = getDevices().get(req.params.id)?.curves?.[req.params.fanIdx] ?? null
  res.json(ok(cached))
})

// POST /api/devices/:id/alert  { rules: [...] }
// WEB-05/ADJ-14: 双阈值模型，发往 config/alert（协议 §6.2）
const AlertSchema = z.object({
  rules: z.array(z.object({
    type: z.enum(['temperature_high', 'fan_stall', 'voltage_abnormal', 'wifi_disconnected']),
    threshold: z.number().optional(),   // 单阈值维度（stall_rpm / wifi timeout_s）
    warn_c: z.number().optional(),      // 温度双阈值
    crit_c: z.number().optional(),
    '12v_min': z.number().optional(),   // 电压窗口
    '12v_max': z.number().optional(),
    enabled: z.boolean(),
  })),
})
router.post('/:id/alert', (req, res) => {
  const parsed = AlertSchema.safeParse(req.body)
  if (!parsed.success) return send(res, fail(parsed.error.message))
  publishConfig(req.params.id, 'alert', {
    timestamp: Math.floor(Date.now() / 1000),
    rules: parsed.data.rules,
  })
  res.json(ok({ applied: true }))
})

// POST /api/devices/:id/alert/get — 回读当前告警阈值（config/alert get，FW-20④）
router.post('/:id/alert/get', (req, res) => {
  const published = publishConfig(req.params.id, 'alert', { get: true })
  res.json(ok({ requested: published }))
})

// POST /api/devices/:id/ota  { url: "https://..." }
const OTASchema = z.object({ url: z.string().url() })
router.post('/:id/ota', (req, res) => {
  const parsed = OTASchema.safeParse(req.body)
  if (!parsed.success) return send(res, fail(parsed.error.message))
  publishCommand(req.params.id, 'ota', {
    firmware_url: parsed.data.url, timestamp: Math.floor(Date.now() / 1000),
  })
  res.json(ok({ ota_started: true }))
})

// POST /api/devices/:id/reboot
router.post('/:id/reboot', (req, res) => {
  publishCommand(req.params.id, 'reboot', { timestamp: Math.floor(Date.now() / 1000) })
  res.json(ok({ rebooting: true }))
})

export default router
