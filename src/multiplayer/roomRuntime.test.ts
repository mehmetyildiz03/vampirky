import { describe, expect, it } from 'vitest'
import {
  beginDiscussion,
  beginNight,
  beginVoting,
  createGame,
  resolveNight,
} from '../game/engine'
import type { PlayerSeed } from '../game/types'
import { AuthoritativeRoom } from './roomRuntime'

function seeds(count: number): PlayerSeed[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    name: `Oyuncu ${index + 1}`,
  }))
}

describe('authoritative multiplayer room runtime', () => {
  it('increments revision only after accepted commands', () => {
    let game = beginNight(createGame(seeds(9)))
    game = resolveNight(game)
    game = beginDiscussion(game)
    const room = new AuthoritativeRoom(game)
    const player = game.players.find((candidate) => candidate.alive)!

    const accepted = room.dispatch(player.id, {
      type: 'chat.send',
      requestId: 'chat-1',
      baseRevision: 0,
      channel: 'village',
      text: 'Merhaba köy.',
    })

    expect(accepted.response).toMatchObject({
      type: 'command.accepted',
      requestId: 'chat-1',
      revision: 1,
    })
    expect(room.getRevision()).toBe(1)

    const impossibleFuture = room.dispatch(player.id, {
      type: 'chat.send',
      requestId: 'chat-2',
      baseRevision: 5,
      channel: 'village',
      text: 'Gelecek revision reddedilmeli.',
    })

    expect(impossibleFuture.response).toMatchObject({
      type: 'command.rejected',
      code: 'stale_revision',
      revision: 1,
    })
    expect(room.getRevision()).toBe(1)
  })

  it('accepts concurrent commands that started from the same older snapshot', () => {
    let game = beginNight(createGame(seeds(6)))
    game = resolveNight(game)
    game = beginDiscussion(game)
    const room = new AuthoritativeRoom(game)
    const [a, b] = game.players.filter((player) => player.alive)

    const first = room.dispatch(a.id, {
      type: 'chat.send',
      requestId: 'concurrent-a',
      baseRevision: 0,
      channel: 'village',
      text: 'A',
    })
    const second = room.dispatch(b.id, {
      type: 'chat.send',
      requestId: 'concurrent-b',
      baseRevision: 0,
      channel: 'village',
      text: 'B',
    })

    expect(first.response.type).toBe('command.accepted')
    expect(second.response).toMatchObject({
      type: 'command.accepted',
      revision: 2,
    })
    expect(second.snapshot.chatMessages.map((message) => message.text))
      .toEqual(['A', 'B'])
  })

  it('moves role reveal to night when every player confirms ready', () => {
    const game = createGame(seeds(6))
    const room = new AuthoritativeRoom(game, 0, game.players[0].id, 1_000)
    let revision = 0

    for (const [index, player] of game.players.entries()) {
      const result = room.dispatch(player.id, {
        type: 'phase.ready',
        requestId: 'ready-' + player.id,
        baseRevision: revision,
      }, 2_000 + index)
      expect(result.response.type).toBe('command.accepted')
      revision += 1
    }

    expect(room.snapshotFor(game.players[0].id)).toMatchObject({
      phase: 'night',
      revision: 6,
      phaseDurationSeconds: 40,
      phaseReadyCount: 0,
    })
  })

  it('lets only the host end discussion early', () => {
    let game = beginNight(createGame(seeds(6)))
    game = resolveNight(game)
    game = beginDiscussion(game)
    const hostId = game.players[0].id
    const room = new AuthoritativeRoom(game, 0, hostId)

    const rejected = room.dispatch(game.players[1].id, {
      type: 'phase.advance',
      requestId: 'not-host',
      baseRevision: 0,
    })
    expect(rejected.response).toMatchObject({
      type: 'command.rejected',
      code: 'not_authorized',
    })

    const accepted = room.dispatch(hostId, {
      type: 'phase.advance',
      requestId: 'host',
      baseRevision: 0,
    })
    expect(accepted.response.type).toBe('command.accepted')
    expect(accepted.snapshot.phase).toBe('voting')
  })

  it('advances expired server phases and treats missing actions as pass', () => {
    const game = beginNight(createGame(seeds(6)))
    const room = new AuthoritativeRoom(game, 0, game.players[0].id, 10_000)
    const deadline = room.getPhaseDeadlineAt()!

    expect(room.advanceExpired(deadline - 1)).toBe(false)
    expect(room.advanceExpired(deadline)).toBe(true)
    expect(room.getRevision()).toBe(1)
    expect(room.snapshotFor(game.players[0].id).phase).toBe('dawn')
  })

  it('resolves voting as soon as every living player has voted', () => {
    let game = beginNight(createGame(seeds(6)))
    game = resolveNight(game)
    game = beginDiscussion(game)
    game = beginVoting(game)
    const room = new AuthoritativeRoom(game)
    const living = game.players.filter((player) => player.alive)
    let revision = 0

    for (const voter of living) {
      const target = living.find((candidate) => candidate.id !== voter.id)!
      const result = room.dispatch(voter.id, {
        type: 'vote.submit',
        requestId: 'vote-' + voter.id,
        baseRevision: revision,
        targetId: target.id,
      })
      expect(result.response.type).toBe('command.accepted')
      revision += 1
    }

    expect(room.snapshotFor(living[0].id).phase).toBe('resolution')
  })

  it('derives the claim author from the authenticated player id', () => {
    let game = beginNight(createGame(seeds(9)))
    game = resolveNight(game)
    game = beginDiscussion(game)
    const room = new AuthoritativeRoom(game)
    const actor = game.players.find((candidate) => candidate.alive)!

    const result = room.dispatch(actor.id, {
      type: 'claim.record',
      requestId: 'claim-1',
      baseRevision: 0,
      payload: {
        kind: 'role',
        role: 'seer',
        quote: 'Ben Kâhinim.',
      },
    })

    expect(result.response.type).toBe('command.accepted')
    expect(result.snapshot.claims.at(-1)).toMatchObject({
      claimantId: actor.id,
      kind: 'role',
      role: 'seer',
    })
  })

  it('prevents one player from withdrawing another player claim', () => {
    let game = beginNight(createGame(seeds(9)))
    game = resolveNight(game)
    game = beginDiscussion(game)
    const room = new AuthoritativeRoom(game)
    const alive = game.players.filter((candidate) => candidate.alive)

    const claim = room.dispatch(alive[0].id, {
      type: 'claim.record',
      requestId: 'claim-owner',
      baseRevision: 0,
      payload: {
        kind: 'role',
        role: 'villager',
      },
    })
    const claimId = claim.snapshot.claims[0].id

    const unauthorized = room.dispatch(alive[1].id, {
      type: 'claim.withdraw',
      requestId: 'withdraw-other',
      baseRevision: 1,
      claimId,
    })

    expect(unauthorized.response).toMatchObject({
      type: 'command.rejected',
      code: 'not_authorized',
      revision: 1,
    })
    expect(unauthorized.snapshot.claims[0].status).toBe('active')
  })

  it('never broadcasts vampire chat in another viewers snapshot', () => {
    const game = beginNight(createGame(seeds(9)))
    const room = new AuthoritativeRoom(game)
    const vampire = game.players.find((player) => player.secretRole === 'vampire')!
    const outsider = game.players.find((player) => player.secretRole !== 'vampire')!

    const result = room.dispatch(vampire.id, {
      type: 'chat.send',
      requestId: 'vamp-chat',
      baseRevision: 0,
      channel: 'vampire',
      text: 'Bu yalnızca bize özel.',
    })

    expect(result.response.type).toBe('command.accepted')
    expect(room.snapshotFor(outsider.id).chatMessages).toEqual([])
    expect(room.snapshotFor(vampire.id).chatMessages).toHaveLength(1)
  })
})
