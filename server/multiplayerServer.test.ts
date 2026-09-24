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

function nextMessages(
  socket: WebSocket,
  count: number,
): Promise<ServerTransportMessage[]> {
  return new Promise((resolve, reject) => {
    const messages: ServerTransportMessage[] = []
    const onMessage = (data: WebSocket.RawData) => {
      messages.push(JSON.parse(data.toString()) as ServerTransportMessage)
      if (messages.length === count) {
        cleanup()
        resolve(messages)
      }
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

function discussionGame() {
  let game = beginNight(createGame(seeds(9)))
  game = resolveNight(game)
  return beginDiscussion(game)
}

describe('real websocket multiplayer adapter', () => {
  let running: RunningMultiplayerServer | null = null

  afterEach(async () => {
    await running?.close()
    running = null
  })

  it('connects two real websocket clients to the same active game with scoped snapshots', async () => {
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

    const initialA = nextMessages(socketA, 2)
    socketA.send(JSON.stringify({
      type: 'session.resume',
      roomId: a.roomId,
      sessionToken: a.sessionToken,
      lastSeenRevision: 0,
    }))
    const [readyA, snapshotA] = await initialA
    expect(readyA).toMatchObject({ type: 'session.ready', playerId: game.players[0].id })
    expect(snapshotA).toMatchObject({
      type: 'game.snapshot',
      snapshot: { self: { id: game.players[0].id } },
    })

    const initialB = nextMessages(socketB, 2)
    socketB.send(JSON.stringify({
      type: 'session.resume',
      roomId: b.roomId,
      sessionToken: b.sessionToken,
      lastSeenRevision: 0,
    }))
    const [readyB, snapshotB] = await initialB
    expect(readyB).toMatchObject({ type: 'session.ready', playerId: game.players[1].id })
    expect(snapshotB).toMatchObject({
      type: 'game.snapshot',
      snapshot: { self: { id: game.players[1].id } },
    })

    const responseA = nextMessages(socketA, 2)
    const responseB = nextMessages(socketB, 1)
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

    const [acceptedA, broadcastA] = await responseA
    const [broadcastB] = await responseB
    expect(acceptedA).toMatchObject({ type: 'command.accepted', revision: 1 })
    expect(broadcastA).toMatchObject({
      type: 'game.snapshot',
      revision: 1,
      snapshot: { self: { id: game.players[0].id } },
    })
    expect(broadcastB).toMatchObject({
      type: 'game.snapshot',
      revision: 1,
      snapshot: { self: { id: game.players[1].id } },
    })

    socketA.close()
    socketB.close()
  })

  it('creates a lobby, joins by name, and starts the game with the same host session', async () => {
    running = await createMultiplayerServer({
      port: 0,
      allowedOrigins: ['*'],
    }).listen()

    const createResponse = await fetch(running.httpUrl + '/api/lobbies', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hostName: 'Mehmet', roomId: 'LIVE01' }),
    })
    const host = await createResponse.json() as {
      roomId: string
      playerId: number
      sessionToken: string
      revision: number
    }
    expect(createResponse.status).toBe(201)
    expect(host.roomId).toBe('LIVE01')

    const sessions = [host]
    for (const name of ['Ayşe', 'Mert', 'Esra', 'Burak', 'Zeynep']) {
      const response = await fetch(running.httpUrl + '/api/lobbies/LIVE01/join', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      expect(response.status).toBe(201)
      sessions.push(await response.json() as typeof host)
    }

    const hostSocket = await openSocket(running.websocketUrl)
    const initial = nextMessages(hostSocket, 2)
    hostSocket.send(JSON.stringify({
      type: 'session.resume',
      roomId: host.roomId,
      sessionToken: host.sessionToken,
      lastSeenRevision: sessions.at(-1)!.revision,
    }))
    const [ready, lobbySnapshot] = await initial
    expect(ready).toMatchObject({ type: 'session.ready', playerId: host.playerId })
    expect(lobbySnapshot).toMatchObject({
      type: 'lobby.snapshot',
      snapshot: { players: expect.arrayContaining([
        expect.objectContaining({ name: 'Mehmet', connected: true }),
        expect.objectContaining({ name: 'Zeynep' }),
      ]) },
    })

    let revision = sessions.at(-1)!.revision
    for (const [index, session] of sessions.entries()) {
      const result = running.sessions.dispatchLobby(session.sessionToken, {
        type: 'lobby.ready',
        requestId: 'ready-' + index,
        baseRevision: revision,
        ready: true,
      })
      expect(result.response.type).toBe('command.accepted')
      revision = result.response.revision
    }

    const readyBroadcast = nextMessages(hostSocket, 1)
    running.gateway.broadcastRoom('LIVE01')
    expect((await readyBroadcast)[0]).toMatchObject({
      type: 'lobby.snapshot',
      revision,
      snapshot: { canStart: true },
    })

    const startFrames = nextMessages(hostSocket, 2)
    hostSocket.send(JSON.stringify({
      type: 'lobby.command',
      command: {
        type: 'lobby.start',
        requestId: 'start-live',
        baseRevision: revision,
      },
    }))

    const [accepted, gameSnapshot] = await startFrames
    expect(accepted).toMatchObject({
      type: 'command.accepted',
      revision: revision + 1,
    })
    expect(gameSnapshot).toMatchObject({
      type: 'game.snapshot',
      revision: revision + 1,
      snapshot: {
        self: { id: host.playerId },
        phase: 'role_reveal',
      },
    })
    expect(JSON.stringify(gameSnapshot)).not.toContain('"secretRole"')

    hostSocket.close()
  })

  it('keeps legacy active-game bootstrap endpoints for integration tooling', async () => {
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

    const claimResponse = await fetch(
      running.httpUrl + '/api/rooms/HTTP01/seats/2',
      { method: 'POST' },
    )
    expect(claimResponse.status).toBe(201)
  })
})
