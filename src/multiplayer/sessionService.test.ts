import { describe, expect, it } from 'vitest'
import { beginDiscussion, beginNight, createGame, resolveNight } from '../game/engine'
import type { PlayerSeed } from '../game/types'
import { RoomSessionService } from './sessionService'

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

describe('room session service', () => {
  it('claims a seat once and resumes it with the same identity', () => {
    const game = discussionGame()
    const service = new RoomSessionService()
    const host = service.createRoom(game, game.players[0].id, 'VKTEST')
    const guest = service.claimSeat('vktest', game.players[1].id)

    expect(host.roomId).toBe('VKTEST')
    expect(guest.sessionToken).not.toBe(host.sessionToken)

    const resumed = service.resumeSession(
      'VKTEST',
      guest.sessionToken,
      guest.revision,
    )
    expect(resumed.playerId).toBe(game.players[1].id)
    expect(resumed.caughtUp).toBe(true)
    expect(resumed.message.type).toBe('game.snapshot')
    if (resumed.message.type === 'game.snapshot') {
      expect(resumed.message.snapshot.self.id).toBe(game.players[1].id)
    }

    expect(() => service.claimSeat('VKTEST', game.players[1].id))
      .toThrow('This player seat already has a session.')
  })

  it('rejects a token from another room', () => {
    const game = discussionGame()
    const service = new RoomSessionService()
    const roomA = service.createRoom(game, game.players[0].id, 'ROOMA')
    service.createRoom(game, game.players[0].id, 'ROOMB')

    expect(() =>
      service.resumeSession('ROOMB', roomA.sessionToken, 0),
    ).toThrow('Invalid session token for this room.')
  })

  it('makes accepted request ids idempotent across retries', () => {
    const game = discussionGame()
    const service = new RoomSessionService()
    const host = service.createRoom(game, game.players[0].id, 'RETRY1')

    const command = {
      type: 'chat.send' as const,
      requestId: 'same-request',
      baseRevision: 0,
      channel: 'village' as const,
      text: 'Bir kez yazılmalı.',
    }

    const first = service.dispatch(host.sessionToken, command)
    const retry = service.dispatch(host.sessionToken, command)

    expect(first.response.type).toBe('command.accepted')
    expect(first.mutated).toBe(true)
    expect(retry.response).toEqual(first.response)
    expect(retry.mutated).toBe(false)
    expect(retry.snapshot.chatMessages).toHaveLength(1)
  })

  it('keeps private deductions session-scoped and restores them on reconnect', () => {
    const game = discussionGame()
    const service = new RoomSessionService()
    const host = service.createRoom(game, game.players[0].id, 'PRIVATE1')
    const guest = service.claimSeat('PRIVATE1', game.players[1].id)

    const mark = service.dispatchPrivate(host.sessionToken, {
      type: 'deduction.mark',
      requestId: 'mark-guest',
      baseRevision: 0,
      targetId: guest.playerId,
      mark: 'suspicious',
    })
    expect(mark.response).toMatchObject({
      type: 'command.accepted',
      revision: 0,
    })
    expect(mark.broadcasts).toHaveLength(1)
    expect(mark.broadcasts[0].sessionToken).toBe(host.sessionToken)

    const note = service.dispatchPrivate(host.sessionToken, {
      type: 'deduction.note.add',
      requestId: 'note-guest',
      baseRevision: 0,
      targetId: guest.playerId,
      text: 'Rol iddiasını değiştirdi.',
    })
    expect(note.message).toMatchObject({
      type: 'game.snapshot',
      snapshot: {
        privateDeduction: {
          marks: { [guest.playerId]: 'suspicious' },
        },
      },
    })

    const guestSnapshot = service.snapshotForSession(guest.sessionToken)
    expect(guestSnapshot.privateDeduction.marks[host.playerId]).toBe('uncertain')
    expect(JSON.stringify(guestSnapshot)).not.toContain('Rol iddiasını değiştirdi.')

    const resumed = service.resumeSession('PRIVATE1', host.sessionToken, 0)
    expect(resumed.message).toMatchObject({
      type: 'game.snapshot',
      snapshot: {
        privateDeduction: {
          notes: {
            [guest.playerId]: [
              expect.objectContaining({ text: 'Rol iddiasını değiştirdi.' }),
            ],
          },
        },
      },
    })
  })

  it('keeps match-wide private notes scoped to one session', () => {
    const game = discussionGame()
    const service = new RoomSessionService()
    const host = service.createRoom(game, game.players[0].id, 'GENERAL1')
    const guest = service.claimSeat('GENERAL1', game.players[1].id)

    const result = service.dispatchPrivate(host.sessionToken, {
      type: 'deduction.general.add',
      requestId: 'general-note',
      baseRevision: 0,
      text: 'İki oyuncu aynı rolü iddia etti.',
    })

    expect(result.response).toMatchObject({
      type: 'command.accepted',
      revision: 0,
    })
    expect(result.broadcasts).toHaveLength(1)
    expect(result.message).toMatchObject({
      type: 'game.snapshot',
      snapshot: {
        privateDeduction: {
          generalNotes: [
            expect.objectContaining({ text: 'İki oyuncu aynı rolü iddia etti.' }),
          ],
        },
      },
    })

    expect(JSON.stringify(service.snapshotForSession(guest.sessionToken)))
      .not.toContain('İki oyuncu aynı rolü iddia etti.')
  })

  it('rejects oversized private notes without changing public revision', () => {
    const game = discussionGame()
    const service = new RoomSessionService()
    const host = service.createRoom(game, game.players[0].id, 'PRIVATE2')
    const guest = service.claimSeat('PRIVATE2', game.players[1].id)

    const result = service.dispatchPrivate(host.sessionToken, {
      type: 'deduction.note.add',
      requestId: 'too-long',
      baseRevision: 0,
      targetId: guest.playerId,
      text: 'x'.repeat(221),
    })

    expect(result.response).toMatchObject({
      type: 'command.rejected',
      code: 'invalid_payload',
      revision: 0,
    })
  })

  it('broadcasts a separately scoped game snapshot for every claimed session', () => {
    const game = discussionGame()
    const service = new RoomSessionService()
    const host = service.createRoom(game, game.players[0].id, 'BCAST1')
    const guest = service.claimSeat('BCAST1', game.players[1].id)

    const result = service.dispatch(host.sessionToken, {
      type: 'chat.send',
      requestId: 'public-chat',
      baseRevision: 0,
      channel: 'village',
      text: 'Köye açık mesaj.',
    })

    expect(result.broadcasts).toHaveLength(2)
    expect(result.broadcasts.map((item) => item.sessionToken).sort())
      .toEqual([host.sessionToken, guest.sessionToken].sort())
    for (const broadcast of result.broadcasts) {
      expect(broadcast.message.type).toBe('game.snapshot')
      if (broadcast.message.type === 'game.snapshot') {
        expect(broadcast.message.snapshot.self.id).toBe(broadcast.playerId)
      }
    }
  })
})
