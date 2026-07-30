// src/routes/devices.ts — REST API 端点 (Zod 校验 + 统一响应)
import { Router } from 'express'
import { z } from 'zod'
import { getDevices, publishCommand } from '../mqtt.js'

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

// GET /api/devices/:id/history — placeholder (data from Flash logs via USB)
router.get('/:id/history', (req, res) => {
  const { from, to } = req.query
  // In production: query Go Agent which reads from ESP32 NVS/Flash
  res.json(ok({ deviceId: req.params.id, from, to, entries: [] }))
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
const CurveSchema = z.object({
  mode: z.enum(['lut', 'pid']),
  temperature_source: z.string().optional(),
  points: z.array(z.object({ temp_c: z.number(), duty_pct: z.number().int() })).optional(),
  pid: z.object({ kp: z.number(), ki: z.number(), kd: z.number(), setpoint_c: z.number() }).optional(),
})
router.post('/:id/fan/:fanIdx/curve', (req, res) => {
  const parsed = CurveSchema.safeParse(req.body)
  if (!parsed.success) return send(res, fail(parsed.error.message))
  publishCommand(req.params.id, 'curve', {
    fan_index: parseInt(req.params.fanIdx),
    timestamp: Math.floor(Date.now() / 1000),
    ...parsed.data,
  })
  res.json(ok({ applied: true }))
})

// POST /api/devices/:id/alert  { rules: [...] }
const AlertSchema = z.object({
  rules: z.array(z.object({
    type: z.string(),
    threshold: z.number().optional(),
    enabled: z.boolean(),
  })),
})
router.post('/:id/alert', (req, res) => {
  const parsed = AlertSchema.safeParse(req.body)
  if (!parsed.success) return send(res, fail(parsed.error.message))
  publishCommand(req.params.id, 'alert', {
    timestamp: Math.floor(Date.now() / 1000),
    rules: parsed.data.rules,
  })
  res.json(ok({ applied: true }))
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
