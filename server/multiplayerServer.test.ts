import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { beginDiscussion, beginNight, createGame, resolveNight } from '../src/game/engine'
import type { PlayerSeed } from '../src/game/types'
import type { ServerTransportMessage } from '../src/multiplayer/protocol'
import { RoomSessionService } from '../src/multiplayer/sessionService'
import { createMultiplayerServer, type RunningMultiplayerServer } from './multiplayerServer'

function seeds(count: number): PlayerSeed[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    name: `Oyuncu ${index + 1}`,
  }))
}

function discussionGame() {
  let game = beginNight(createGame(seeds(9)))
  game = resolveNight(game)
  return beginDiscussion(game)
}

function nextMessage(socket: WebSocket): Promise<ServerTransportMessage> {
  return new Promise((resolve, reject) => {
    const onMessage = (data: WebSocket.RawData) => {
      cleanup()
      resolve(JSON.parse(data.toString()) as ServerTransportMessage)
    }
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    const cleanup = () => {
      socket.off('message', onMessage)
      socket.off('error', onError)
    }
    socket.on('message', onMessage)
    socket.on('error', onError)
  })
}

async function openSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    socket.once('open', () => resolve(socket))
    socket.once('error', reject)
  })
}

describe('real websocket multiplayer adapter', () => {
  let running: RunningMultiplayerServer | null = null

  afterEach(async () => {
    await running?.close()
    running = null
  })

  it('connects two real websocket clients to the same room with scoped snapshots', async () => {
    const game = discussionGame()
    const sessions = new RoomSessionService()
    const a = sessions.createRoom(game, game.players[0].id, 'SOCKET1')
    const b = sessions.claimSeat('SOCKET1', game.players[1].id)
    running = await createMultiplayerServer({
      port: 0,
      allowedOrigins: ['*'],
      sessions,
    }).listen()

    const socketA = await openSocket(running.websocketUrl)
    const socketB = await openSocket(running.websocketUrl)

    const readyA = nextMessage(socketA)
    const snapshotA = nextMessage(socketA)
    socketA.send(JSON.stringify({
      type: 'session.resume',
      roomId: a.roomId,
      sessionToken: a.sessionToken,
      lastSeenRevision: 0,
    }))

    expect(await readyA).toMatchObject({
      type: 'session.ready',
      playerId: game.players[0].id,
    })
    expect(await snapshotA).toMatchObject({
      type: 'game.snapshot',
      snapshot: { self: { id: game.players[0].id } },
    })

    const readyB = nextMessage(socketB)
    const snapshotB = nextMessage(socketB)
    socketB.send(JSON.stringify({
      type: 'session.resume',
      roomId: b.roomId,
      sessionToken: b.sessionToken,
      lastSeenRevision: 0,
    }))

    expect(await readyB).toMatchObject({
      type: 'session.ready',
      playerId: game.players[1].id,
    })
    expect(await snapshotB).toMatchObject({
      type: 'game.snapshot',
      snapshot: { self: { id: game.players[1].id } },
    })

    const acceptedA = nextMessage(socketA)
    const broadcastA = nextMessage(socketA)
    const broadcastB = nextMessage(socketB)

    socketA.send(JSON.stringify({
      type: 'game.command',
      command: {
        type: 'chat.send',
        requestId: 'real-ws-chat',
        baseRevision: 0,
        channel: 'village',
        text: 'Gerçek socket mesajı.',
      },
    }))

    expect(await acceptedA).toMatchObject({
      type: 'command.accepted',
      revision: 1,
    })
    expect(await broadcastA).toMatchObject({
      type: 'game.snapshot',
      revision: 1,
      snapshot: { self: { id: game.players[0].id } },
    })
    expect(await broadcastB).toMatchObject({
      type: 'game.snapshot',
      revision: 1,
      snapshot: { self: { id: game.players[1].id } },
    })

    socketA.close()
    socketB.close()
  })

  it('creates and claims bootstrap sessions over HTTP', async () => {
    running = await createMultiplayerServer({
      port: 0,
      allowedOrigins: ['*'],
    }).listen()

    const createResponse = await fetch(running.httpUrl + '/api/rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        players: seeds(6),
        hostPlayerId: 1,
        roomId: 'HTTP01',
      }),
    })
    const host = await createResponse.json() as {
      roomId: string
      playerId: number
      sessionToken: string
    }

    expect(createResponse.status).toBe(201)
    expect(host.roomId).toBe('HTTP01')
    expect(host.playerId).toBe(1)
    expect(host.sessionToken.length).toBeGreaterThan(40)

    const claimResponse = await fetch(
      running.httpUrl + '/api/rooms/HTTP01/seats/2',
      { method: 'POST' },
    )
    const guest = await claimResponse.json() as {
      playerId: number
      sessionToken: string
    }

    expect(claimResponse.status).toBe(201)
    expect(guest.playerId).toBe(2)
    expect(guest.sessionToken).not.toBe(host.sessionToken)
  })
})
