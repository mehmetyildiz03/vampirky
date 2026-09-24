import { createMultiplayerServer } from './multiplayerServer'

const port = Number(process.env.PORT ?? 8787)
const host = process.env.HOST ?? '0.0.0.0'
const persistencePath =
  process.env.VAMPIRKY_STATE_FILE ?? '.data/vampirky-state.json'
function seconds(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number.`)
  }
  return value
}

const lifecycle = {
  reconnectGraceMs: seconds('VAMPIRKY_RECONNECT_GRACE_SECONDS', 120) * 1000,
  emptyLobbyTtlMs: seconds('VAMPIRKY_EMPTY_LOBBY_TTL_SECONDS', 900) * 1000,
  abandonedGameTtlMs: seconds('VAMPIRKY_ABANDONED_GAME_TTL_SECONDS', 3600) * 1000,
  finishedGameTtlMs: seconds('VAMPIRKY_FINISHED_GAME_TTL_SECONDS', 1800) * 1000,
}

const allowedOrigins = process.env.VAMPIRKY_ALLOWED_ORIGINS
  ?.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

const server = createMultiplayerServer({
  host,
  port,
  allowedOrigins,
  persistencePath,
  lifecycle,
})

const running = await server.listen()

console.log(`Vampir Köylü multiplayer server listening on ${running.httpUrl}`)
console.log(`WebSocket endpoint: ${running.websocketUrl}`)

console.log(`Persistent room state: ${persistencePath}`)

console.log(`Room lifecycle: reconnect ${lifecycle.reconnectGraceMs / 1000}s, lobby TTL ${lifecycle.emptyLobbyTtlMs / 1000}s, abandoned game TTL ${lifecycle.abandonedGameTtlMs / 1000}s, finished game TTL ${lifecycle.finishedGameTtlMs / 1000}s`)
