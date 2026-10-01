// src/server.ts — Express HTTP + WebSocket + MQTT (完整集成版)
import express from 'express'
import cors from 'cors'
import { WebSocketServer } from 'ws'
import http from 'http'
import { setupMQTT, mqttConnected } from './mqtt.js'
import devicesRouter from './routes/devices.js'

const app = express()
const PORT = Number(process.env.PORT ?? 3001)
const BROKER_URL = process.env.MQTT_BROKER ?? 'mqtt://localhost:1883'

app.use(cors())
app.use(express.json())

// Health check — smoke test uses this endpoint
app.get('/health', (_req, res) => res.json({ ok: true, uptime: process.uptime(), mqtt: mqttConnected() }))

// REST API routes
app.use('/api/devices', devicesRouter)

// 404 handler
app.use((_req, res) => res.status(404).json({ ok: false, error: 'not found' }))

const server = http.createServer(app)
const wss = new WebSocketServer({ server })

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'connected', message: 'Smart Fan WebSocket ready' }))
})

// Connect to MQTT and start WebSocket push (every 2s)
setupMQTT(BROKER_URL, wss)

server.listen(PORT, () => {
  console.log(`Smart Fan Backend: http://localhost:${PORT}  (MQTT: ${BROKER_URL})`)
})

export default app
