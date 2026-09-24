import { describe, expect, it } from 'vitest'
import { RoomSessionService } from './sessionService'

describe('authoritative multiplayer lobby', () => {
  it('creates an empty-role lobby and joins players by name', () => {
    const service = new RoomSessionService()
    const host = service.createLobby('Mehmet', 'LOBBY1')
    const guest = service.joinLobby('lobby1', 'Ayşe')

    expect(host.snapshot.phase).toBe('lobby')
    expect(host.snapshot.players).toEqual([
      expect.objectContaining({ id: 1, name: 'Mehmet', isHost: true, ready: false }),
    ])
    expect(guest.playerId).toBe(2)
    expect(guest.revision).toBe(1)
    expect(guest.snapshot.players.map((player) => player.name))
      .toEqual(['Mehmet', 'Ayşe'])
    expect(JSON.stringify(guest.snapshot)).not.toContain('secretRole')
  })

  it('accepts simultaneous ready commands from the same lobby revision', () => {
    const service = new RoomSessionService()
    const host = service.createLobby('Host', 'CONCUR')
    const guest = service.joinLobby('CONCUR', 'Guest')
    const baseRevision = guest.revision

    const hostReady = service.dispatchLobby(host.sessionToken, {
      type: 'lobby.ready',
      requestId: 'host-ready',
      baseRevision,
      ready: true,
    })
    const guestReady = service.dispatchLobby(guest.sessionToken, {
      type: 'lobby.ready',
      requestId: 'guest-ready',
      baseRevision,
      ready: true,
    })

    expect(hostReady.response.type).toBe('command.accepted')
    expect(guestReady.response).toMatchObject({
      type: 'command.accepted',
      revision: baseRevision + 2,
    })
  })

  it('keeps the same host session token across lobby to game transition', () => {
    const service = new RoomSessionService()
    const host = service.createLobby('Host', 'START1')
    const sessions = [host]

    for (const name of ['A', 'B', 'C', 'D', 'E']) {
      sessions.push(service.joinLobby('START1', name))
    }

    let revision = sessions.at(-1)!.revision
    for (const session of sessions) {
      const ready = service.dispatchLobby(session.sessionToken, {
        type: 'lobby.ready',
        requestId: 'ready-' + session.playerId,
        baseRevision: revision,
        ready: true,
      })
      expect(ready.response.type).toBe('command.accepted')
      revision = ready.response.revision
    }

    const start = service.dispatchLobby(host.sessionToken, {
      type: 'lobby.start',
      requestId: 'start',
      baseRevision: revision,
    })

    expect(start.response.type).toBe('command.accepted')
    expect(start.message.type).toBe('game.snapshot')
    expect(service.roomIdForSession(host.sessionToken)).toBe('START1')

    const resumed = service.resumeSession(
      'START1',
      host.sessionToken,
      start.response.revision,
    )
    expect(resumed.message.type).toBe('game.snapshot')
    if (resumed.message.type === 'game.snapshot') {
      expect(resumed.message.snapshot.self.id).toBe(host.playerId)
      expect(resumed.message.snapshot.self.role).toBeTruthy()
    }
  })

  it('allows only host to start and requires six ready players', () => {
    const service = new RoomSessionService()
    const host = service.createLobby('Host', 'RULES1')
    const guest = service.joinLobby('RULES1', 'Guest')

    const notHost = service.dispatchLobby(guest.sessionToken, {
      type: 'lobby.start',
      requestId: 'guest-start',
      baseRevision: guest.revision,
    })
    expect(notHost.response).toMatchObject({
      type: 'command.rejected',
      code: 'not_authorized',
    })

    const tooFew = service.dispatchLobby(host.sessionToken, {
      type: 'lobby.start',
      requestId: 'too-few',
      baseRevision: guest.revision,
    })
    expect(tooFew.response).toMatchObject({
      type: 'command.rejected',
      code: 'invalid_payload',
    })
  })

  it('does not consume authoritative revision when presence changes', () => {
    const service = new RoomSessionService()
    const host = service.createLobby('Host', 'PRES01')

    const broadcasts = service.setSessionConnected(host.sessionToken, true)
    expect(broadcasts[0].message).toMatchObject({
      type: 'lobby.snapshot',
      revision: 0,
      snapshot: {
        players: [expect.objectContaining({ connected: true })],
      },
    })

    const ready = service.dispatchLobby(host.sessionToken, {
      type: 'lobby.ready',
      requestId: 'ready',
      baseRevision: 0,
      ready: true,
    })
    expect(ready.response).toMatchObject({
      type: 'command.accepted',
      revision: 1,
    })
  })

  it('rejects duplicate names and joins after game start', () => {
    const service = new RoomSessionService()
    const host = service.createLobby('Host', 'NAMES1')
    service.joinLobby('NAMES1', 'Ayşe')
    expect(() => service.joinLobby('NAMES1', '  AYŞE  '))
      .toThrow('Player name is already in use in this lobby.')

    const sessions = [host]
    for (const name of ['B', 'C', 'D', 'E']) {
      sessions.push(service.joinLobby('NAMES1', name))
    }
    // Ayşe session is player 2; fetch it by creating the full readiness list from broadcasts.
    const ayseToken = service.broadcastsForRoomId('NAMES1')
      .find((item) => item.playerId === 2)!.sessionToken
    const allTokens = [host.sessionToken, ayseToken, ...sessions.slice(1).map((s) => s.sessionToken)]
    let revision = service.broadcastsForRoomId('NAMES1')[0].message.revision
    for (const [index, token] of allTokens.entries()) {
      const result = service.dispatchLobby(token, {
        type: 'lobby.ready',
        requestId: 'r-' + index,
        baseRevision: revision,
        ready: true,
      })
      revision = result.response.revision
    }
    service.dispatchLobby(host.sessionToken, {
      type: 'lobby.start',
      requestId: 'go',
      baseRevision: revision,
    })
    expect(() => service.joinLobby('NAMES1', 'Late'))
      .toThrow('Room is not in lobby phase.')
  })
})
