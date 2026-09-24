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

    const stale = room.dispatch(player.id, {
      type: 'chat.send',
      requestId: 'chat-2',
      baseRevision: 0,
      channel: 'village',
      text: 'Bu stale olmalı.',
    })

    expect(stale.response).toMatchObject({
      type: 'command.rejected',
      code: 'stale_revision',
      revision: 1,
    })
    expect(room.getRevision()).toBe(1)
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

  it('uses the server phase and legal targets for vote commands', () => {
    let game = beginNight(createGame(seeds(9)))
    game = resolveNight(game)
    game = beginDiscussion(game)
    game = beginVoting(game)
    const room = new AuthoritativeRoom(game)
    const voter = game.players.find((player) => player.alive)!
    const targetId = room.snapshotFor(voter.id).capabilities.voteTargetIds[0]

    const accepted = room.dispatch(voter.id, {
      type: 'vote.submit',
      requestId: 'vote-1',
      baseRevision: 0,
      targetId,
    })

    expect(accepted.response.type).toBe('command.accepted')
    expect(accepted.snapshot.voteHistory).toEqual([])
    expect(accepted.snapshot.capabilities.canVote).toBe(true)
  })
})
