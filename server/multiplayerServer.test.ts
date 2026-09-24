import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

  it('advances a real websocket room from role reveal into a server-timed day cycle', async () => {
    const sessionsService = new RoomSessionService()
    const game = createGame(seeds(6))
    const host = sessionsService.createRoom(game, game.players[0].id, 'CYCLE1')
    const guests = game.players.slice(1).map((player) =>
      sessionsService.claimSeat('CYCLE1', player.id),
    )

    running = await createMultiplayerServer({
      port: 0,
      allowedOrigins: ['*'],
      sessions: sessionsService,
    }).listen()

    const socket = await openSocket(running.websocketUrl)
    const initial = nextMessages(socket, 2)
    socket.send(JSON.stringify({
      type: 'session.resume',
      roomId: host.roomId,
      sessionToken: host.sessionToken,
      lastSeenRevision: 0,
    }))
    await initial

    let revision = 0
    for (const guest of guests) {
      const result = sessionsService.dispatchGame(guest.sessionToken, {
        type: 'phase.ready',
        requestId: 'guest-ready-' + guest.playerId,
        baseRevision: revision,
      })
      expect(result.response.type).toBe('command.accepted')
      revision = result.response.revision
    }

    const beforeHostReady = nextMessages(socket, 1)
    running.gateway.broadcastRoom('CYCLE1')
    const [readySnapshot] = await beforeHostReady
    expect(readySnapshot).toMatchObject({
      type: 'game.snapshot',
      revision,
      snapshot: { phase: 'role_reveal', phaseReadyCount: 5 },
    })

    const hostReadyFrames = nextMessages(socket, 2)
    socket.send(JSON.stringify({
      type: 'game.command',
      command: {
        type: 'phase.ready',
        requestId: 'host-ready',
        baseRevision: revision,
      },
    }))
    const [accepted, nightSnapshot] = await hostReadyFrames
    expect(accepted).toMatchObject({ type: 'command.accepted' })
    expect(nightSnapshot).toMatchObject({
      type: 'game.snapshot',
      snapshot: { phase: 'night' },
    })

    if (nightSnapshot.type !== 'game.snapshot') throw new Error('night snapshot expected')
    const nightDeadline = nightSnapshot.snapshot.phaseDeadlineAt!
    const dawnFrame = nextMessages(socket, 1)
    running.gateway.tick(nightDeadline)
    const [dawnSnapshot] = await dawnFrame
    expect(dawnSnapshot).toMatchObject({
      type: 'game.snapshot',
      snapshot: { phase: 'dawn' },
    })

    if (dawnSnapshot.type !== 'game.snapshot') throw new Error('dawn snapshot expected')
    const dawnDeadline = dawnSnapshot.snapshot.phaseDeadlineAt!
    const discussionFrame = nextMessages(socket, 1)
    running.gateway.tick(dawnDeadline)
    const [discussionSnapshot] = await discussionFrame
    expect(discussionSnapshot).toMatchObject({
      type: 'game.snapshot',
      snapshot: { phase: 'discussion' },
    })

    socket.close()
  })

  it('restores an active match and the same session token after a real server restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'vampirky-restart-'))
    const persistencePath = join(directory, 'rooms.json')

    try {
      running = await createMultiplayerServer({
        port: 0,
        allowedOrigins: ['*'],
        persistencePath,
      }).listen()

      const createResponse = await fetch(running.httpUrl + '/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          players: seeds(6),
          hostPlayerId: 1,
          roomId: 'RESTART1',
        }),
      })
      const host = await createResponse.json() as {
        roomId: string
        playerId: number
        sessionToken: string
        revision: number
      }

      const privateNote = running.sessions.dispatchPrivate(host.sessionToken, {
        type: 'deduction.general.add',
        requestId: 'restart-private',
        baseRevision: 0,
        text: 'Restart sonrasında geri gelmeli.',
      })
      expect(privateNote.response.type).toBe('command.accepted')

      const ready = running.sessions.dispatchGame(host.sessionToken, {
        type: 'phase.ready',
        requestId: 'restart-ready',
        baseRevision: 0,
      })
      expect(ready.response).toMatchObject({
        type: 'command.accepted',
        revision: 1,
      })
      if (ready.message.type !== 'game.snapshot') {
        throw new Error('game snapshot expected before restart')
      }
      const deadlineBeforeRestart = ready.message.snapshot.phaseDeadlineAt

      await running.close()
      running = null

      running = await createMultiplayerServer({
        port: 0,
        allowedOrigins: ['*'],
        persistencePath,
      }).listen()

      const socket = await openSocket(running.websocketUrl)
      const reconnectFrames = nextMessages(socket, 2)
      socket.send(JSON.stringify({
        type: 'session.resume',
        roomId: host.roomId,
        sessionToken: host.sessionToken,
        lastSeenRevision: 1,
      }))

      const [sessionReady, restoredSnapshot] = await reconnectFrames
      expect(sessionReady).toMatchObject({
        type: 'session.ready',
        roomId: 'RESTART1',
        playerId: host.playerId,
        revision: 1,
        caughtUp: true,
      })
      expect(restoredSnapshot).toMatchObject({
        type: 'game.snapshot',
        revision: 1,
        snapshot: {
          phase: 'role_reveal',
          phaseReadyCount: 1,
          phaseDeadlineAt: deadlineBeforeRestart,
          privateDeduction: {
            generalNotes: [
              expect.objectContaining({
                text: 'Restart sonrasında geri gelmeli.',
              }),
            ],
          },
        },
      })

      const duplicate = running.sessions.dispatchGame(host.sessionToken, {
        type: 'phase.ready',
        requestId: 'restart-ready',
        baseRevision: 0,
      })
      expect(duplicate.response).toEqual(ready.response)
      expect(duplicate.mutated).toBe(false)
      if (duplicate.message.type === 'game.snapshot') {
        expect(duplicate.message.snapshot.phaseReadyCount).toBe(1)
      }

      socket.close()
    } finally {
      await running?.close()
      running = null
      await rm(directory, { recursive: true, force: true })
    }
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
