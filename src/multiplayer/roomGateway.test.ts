import { describe, expect, it } from 'vitest'
import { beginDiscussion, beginNight, createGame, resolveNight } from '../game/engine'
import type { PlayerSeed } from '../game/types'
import type { ServerTransportMessage } from './protocol'
import { RoomGateway, type TransportPeer } from './roomGateway'
import { RoomSessionService } from './sessionService'

function seeds(count: number): PlayerSeed[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    name: `Oyuncu ${index + 1}`,
  }))
}

class FakePeer implements TransportPeer {
  messages: ServerTransportMessage[] = []
  closed = false

  constructor(readonly id: string) {}

  send(message: ServerTransportMessage) {
    this.messages.push(message)
  }

  close() {
    this.closed = true
  }
}

function discussionGame() {
  let game = beginNight(createGame(seeds(9)))
  game = resolveNight(game)
  return beginDiscussion(game)
}

describe('room transport gateway', () => {
  it('binds a game peer by session token and sends a fresh scoped snapshot', () => {
    const game = discussionGame()
    const service = new RoomSessionService()
    const session = service.createRoom(game, game.players[0].id, 'GATE01')
    const gateway = new RoomGateway(service)
    const peer = new FakePeer('peer-a')

    gateway.receive(peer, {
      type: 'session.resume',
      roomId: session.roomId,
      sessionToken: session.sessionToken,
      lastSeenRevision: 0,
    })

    expect(peer.messages[0]).toMatchObject({
      type: 'session.ready',
      playerId: game.players[0].id,
      caughtUp: true,
    })
    expect(peer.messages[1]).toMatchObject({
      type: 'game.snapshot',
      revision: 0,
    })
  })

  it('binds a lobby peer and broadcasts presence without changing revision', () => {
    const service = new RoomSessionService()
    const session = service.createLobby('Host', 'LOBBYG')
    const gateway = new RoomGateway(service)
    const peer = new FakePeer('host-peer')

    gateway.receive(peer, {
      type: 'session.resume',
      roomId: session.roomId,
      sessionToken: session.sessionToken,
      lastSeenRevision: 0,
    })

    expect(peer.messages[0]).toMatchObject({
      type: 'session.ready',
      revision: 0,
    })
    expect(peer.messages[1]).toMatchObject({
      type: 'lobby.snapshot',
      revision: 0,
      snapshot: {
        players: [expect.objectContaining({ connected: true })],
      },
    })
  })

  it('replaces an older connection when the same session reconnects', () => {
    const game = discussionGame()
    const service = new RoomSessionService()
    const session = service.createRoom(game, game.players[0].id, 'GATE02')
    const gateway = new RoomGateway(service)
    const oldPeer = new FakePeer('old')
    const newPeer = new FakePeer('new')

    for (const peer of [oldPeer, newPeer]) {
      gateway.receive(peer, {
        type: 'session.resume',
        roomId: session.roomId,
        sessionToken: session.sessionToken,
        lastSeenRevision: 0,
      })
    }

    expect(oldPeer.closed).toBe(true)
    expect(oldPeer.messages).toContainEqual(expect.objectContaining({
      type: 'session.rejected',
      code: 'session_mismatch',
    }))
    expect(newPeer.messages.at(-1)?.type).toBe('game.snapshot')
  })

  it('broadcasts viewer-specific snapshots after an accepted game command', () => {
    const game = discussionGame()
    const service = new RoomSessionService()
    const a = service.createRoom(game, game.players[0].id, 'GATE03')
    const b = service.claimSeat('GATE03', game.players[1].id)
    const gateway = new RoomGateway(service)
    const peerA = new FakePeer('a')
    const peerB = new FakePeer('b')

    gateway.receive(peerA, {
      type: 'session.resume',
      roomId: a.roomId,
      sessionToken: a.sessionToken,
      lastSeenRevision: 0,
    })
    gateway.receive(peerB, {
      type: 'session.resume',
      roomId: b.roomId,
      sessionToken: b.sessionToken,
      lastSeenRevision: 0,
    })

    peerA.messages = []
    peerB.messages = []

    gateway.receive(peerA, {
      type: 'game.command',
      command: {
        type: 'chat.send',
        requestId: 'msg-1',
        baseRevision: 0,
        channel: 'village',
        text: 'Herkese merhaba.',
      },
    })

    expect(peerA.messages[0]).toMatchObject({
      type: 'command.accepted',
      revision: 1,
    })
    expect(peerA.messages[1]).toMatchObject({
      type: 'game.snapshot',
      snapshot: { self: { id: game.players[0].id } },
    })
    expect(peerB.messages[0]).toMatchObject({
      type: 'game.snapshot',
      snapshot: { self: { id: game.players[1].id } },
    })
  })

  it('closes connected peers when their room expires', () => {
    const service = new RoomSessionService({ emptyLobbyTtlMs: 10 })
    const session = service.createLobby('Host', 'EXPIRE1')
    const gateway = new RoomGateway(service)
    const peer = new FakePeer('expire-peer')

    gateway.receive(peer, {
      type: 'session.resume',
      roomId: session.roomId,
      sessionToken: session.sessionToken,
      lastSeenRevision: 0,
    })
    peer.messages = []

    // Once disconnected, the room can enter its empty-room TTL window.
    gateway.disconnect(peer)
    const sweepPeer = new FakePeer('unused')
    void sweepPeer
    gateway.tick(Date.now() + 20)

    expect(service.roomIdForSession(session.sessionToken)).toBeNull()
  })

  it('rejects and closes a connected peer when a finished game TTL expires', () => {
    const service = new RoomSessionService({ finishedGameTtlMs: 10 })
    const game = discussionGame()
    game.phase = 'ended'
    game.winner = 'village'
    const session = service.createRoom(game, game.players[0].id, 'FINISH1')
    const gateway = new RoomGateway(service)
    const peer = new FakePeer('finished-peer')

    gateway.receive(peer, {
      type: 'session.resume',
      roomId: session.roomId,
      sessionToken: session.sessionToken,
      lastSeenRevision: 0,
    })
    peer.messages = []

    gateway.tick(Date.now() + 20)

    expect(peer.messages).toContainEqual(expect.objectContaining({
      type: 'session.rejected',
      code: 'room_not_found',
    }))
    expect(peer.closed).toBe(true)
    expect(service.roomIdForSession(session.sessionToken)).toBeNull()
  })

  it('does not accept commands before session resume', () => {
    const service = new RoomSessionService()
    const gateway = new RoomGateway(service)
    const peer = new FakePeer('anonymous')

    gateway.receive(peer, {
      type: 'lobby.command',
      command: {
        type: 'lobby.ready',
        requestId: 'bad',
        baseRevision: 0,
        ready: true,
      },
    })

    expect(peer.messages).toEqual([
      expect.objectContaining({
        type: 'session.rejected',
        code: 'invalid_session',
      }),
    ])
  })
})
