import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from 'node:http'
import { randomUUID } from 'node:crypto'
import { WebSocketServer, type RawData, type WebSocket } from 'ws'
import { createGame } from '../src/game/engine'
import type { PlayerSeed } from '../src/game/types'
import { RoomGateway, type TransportPeer } from '../src/multiplayer/roomGateway'
import { RoomSessionService } from '../src/multiplayer/sessionService'
import { decodeClientTransportMessage } from '../src/multiplayer/wireCodec'

const MAX_JSON_BYTES = 64 * 1024

export interface MultiplayerServerOptions {
  host?: string
  port?: number
  allowedOrigins?: string[]
  sessions?: RoomSessionService
}

export interface RunningMultiplayerServer {
  httpServer: HttpServer
  sessions: RoomSessionService
  gateway: RoomGateway
  host: string
  port: number
  httpUrl: string
  websocketUrl: string
  close(): Promise<void>
}

interface CreateRoomBody {
  players: PlayerSeed[]
  hostPlayerId: number
  roomId?: string
}

function json(
  response: ServerResponse,
  status: number,
  body: unknown,
  origin?: string,
): void {
  if (origin) response.setHeader('access-control-allow-origin', origin)
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.statusCode = status
  response.end(JSON.stringify(body))
}

function originAllowed(
  request: IncomingMessage,
  allowedOrigins: string[],
): string | null {
  const origin = request.headers.origin
  if (!origin) return '*'
  if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) return origin
  return null
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  let bytes = 0
  const chunks: Buffer[] = []

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.length
    if (bytes > MAX_JSON_BYTES) throw new Error('Request body is too large.')
    chunks.push(buffer)
  }

  if (!chunks.length) return {} as T
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T
}

function validateCreateRoomBody(body: CreateRoomBody): void {
  if (!Array.isArray(body.players) || body.players.length < 6 || body.players.length > 12) {
    throw new Error('A room requires 6 to 12 players.')
  }
  if (!Number.isInteger(body.hostPlayerId)) {
    throw new Error('hostPlayerId must be an integer.')
  }
  for (const player of body.players) {
    if (!Number.isInteger(player.id) || typeof player.name !== 'string') {
      throw new Error('Invalid player roster.')
    }
  }
}

export function createMultiplayerServer(
  options: MultiplayerServerOptions = {},
): {
  listen(): Promise<RunningMultiplayerServer>
  httpServer: HttpServer
  sessions: RoomSessionService
  gateway: RoomGateway
} {
  const host = options.host ?? '127.0.0.1'
  const configuredPort = options.port ?? 8787
  const allowedOrigins = options.allowedOrigins ?? [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'https://mehmetyildiz03.github.io',
  ]
  const sessions = options.sessions ?? new RoomSessionService()
  const gateway = new RoomGateway(sessions)

  const httpServer = createServer(async (request, response) => {
    const allowedOrigin = originAllowed(request, allowedOrigins)

    if (request.method === 'OPTIONS') {
      if (!allowedOrigin) {
        response.statusCode = 403
        response.end()
        return
      }
      response.setHeader('access-control-allow-origin', allowedOrigin)
      response.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS')
      response.setHeader('access-control-allow-headers', 'content-type')
      response.statusCode = 204
      response.end()
      return
    }

    if (!allowedOrigin) {
      json(response, 403, { error: 'Origin is not allowed.' })
      return
    }

    try {
      const url = new URL(request.url ?? '/', 'http://server.local')

      if (request.method === 'GET' && url.pathname === '/health') {
        json(response, 200, { ok: true }, allowedOrigin)
        return
      }

      if (request.method === 'POST' && url.pathname === '/api/rooms') {
        const body = await readJsonBody<CreateRoomBody>(request)
        validateCreateRoomBody(body)
        const game = createGame(body.players)
        const session = sessions.createRoom(
          game,
          body.hostPlayerId,
          body.roomId,
        )
        json(response, 201, session, allowedOrigin)
        return
      }

      const seatMatch = url.pathname.match(
        /^\/api\/rooms\/([^/]+)\/seats\/(\d+)$/,
      )
      if (request.method === 'POST' && seatMatch) {
        const roomId = decodeURIComponent(seatMatch[1])
        const playerId = Number(seatMatch[2])
        const session = sessions.claimSeat(roomId, playerId)
        json(response, 201, session, allowedOrigin)
        return
      }

      json(response, 404, { error: 'Not found.' }, allowedOrigin)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed.'
      json(response, 400, { error: message }, allowedOrigin)
    }
  })

  const websocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_JSON_BYTES,
  })

  httpServer.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', 'http://server.local')
    const allowedOrigin = originAllowed(request, allowedOrigins)

    if (url.pathname !== '/ws' || !allowedOrigin) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
      socket.destroy()
      return
    }

    websocketServer.handleUpgrade(request, socket, head, (websocket) => {
      websocketServer.emit('connection', websocket, request)
    })
  })

  websocketServer.on('connection', (websocket) => {
    const peer = websocketPeer(websocket)

    websocket.on('message', (raw) => {
      const text = rawDataToString(raw)
      const message = decodeClientTransportMessage(text)
      if (!message) {
        websocket.send(JSON.stringify({
          type: 'session.rejected',
          code: 'invalid_session',
          message: 'Malformed transport message.',
        }))
        return
      }
      gateway.receive(peer, message)
    })

    websocket.on('close', () => gateway.disconnect(peer))
    websocket.on('error', () => gateway.disconnect(peer))
  })

  return {
    httpServer,
    sessions,
    gateway,
    async listen() {
      await new Promise<void>((resolve, reject) => {
        httpServer.once('error', reject)
        httpServer.listen(configuredPort, host, () => {
          httpServer.off('error', reject)
          resolve()
        })
      })

      const address = httpServer.address()
      if (!address || typeof address === 'string') {
        throw new Error('Unable to determine server address.')
      }
      const port = address.port
      const httpUrl = `http://${host}:${port}`

      return {
        httpServer,
        sessions,
        gateway,
        host,
        port,
        httpUrl,
        websocketUrl: `ws://${host}:${port}/ws`,
        close: () =>
          new Promise<void>((resolve, reject) => {
            for (const client of websocketServer.clients) client.terminate()
            websocketServer.close(() => {
              httpServer.close((error) => error ? reject(error) : resolve())
            })
          }),
      }
    },
  }
}

function websocketPeer(websocket: WebSocket): TransportPeer {
  return {
    id: randomUUID(),
    send(message) {
      if (websocket.readyState === websocket.OPEN) {
        websocket.send(JSON.stringify(message))
      }
    },
    close(reason) {
      websocket.close(4001, reason.slice(0, 120))
    },
  }
}

function rawDataToString(raw: RawData): string {
  if (typeof raw === 'string') return raw
  if (Buffer.isBuffer(raw)) return raw.toString('utf8')
  if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8')
  return Buffer.from(raw).toString('utf8')
}
