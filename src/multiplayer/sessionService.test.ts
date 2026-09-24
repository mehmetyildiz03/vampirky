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
