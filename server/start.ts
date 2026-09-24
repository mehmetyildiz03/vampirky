import { createMultiplayerServer } from './multiplayerServer'

const port = Number(process.env.PORT ?? 8787)
const host = process.env.HOST ?? '0.0.0.0'
const persistencePath =
  process.env.VAMPIRKY_STATE_FILE ?? '.data/vampirky-state.json'
const allowedOrigins = process.env.VAMPIRKY_ALLOWED_ORIGINS
  ?.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

const server = createMultiplayerServer({
  host,
  port,
  allowedOrigins,
  persistencePath,
})

const running = await server.listen()

console.log(`Vampir Köylü multiplayer server listening on ${running.httpUrl}`)
console.log(`WebSocket endpoint: ${running.websocketUrl}`)

console.log(`Persistent room state: ${persistencePath}`)
