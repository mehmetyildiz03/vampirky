import { describe, expect, it } from 'vitest'
import {
  beginDiscussion,
  beginNight,
  beginVoting,
  createGame,
  resolveNight,
  sendChatMessage,
  submitNightAction,
} from '../game/engine'
import type { GameState, PlayerSeed } from '../game/types'
import { createViewerSnapshot } from './snapshot'

function seeds(count: number): PlayerSeed[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    name: `Oyuncu ${index + 1}`,
  }))
}

function serializedKeys(value: unknown): string[] {
  const keys: string[] = []
  const visit = (candidate: unknown) => {
    if (!candidate || typeof candidate !== 'object') return
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item)
      return
    }
    for (const [key, child] of Object.entries(candidate)) {
      keys.push(key)
      visit(child)
    }
  }
  visit(value)
  return keys
}

function expectNoAuthoritativeFields(snapshot: unknown) {
  const keys = serializedKeys(snapshot)
  for (const forbidden of [
    'secretRole',
    'nightActions',
    'privateIntel',
    'dayVotes',
    'nextClaimId',
    'nextChatMessageId',
    'nextEventId',
    'protectedIds',
    'attackedId',
  ]) {
    expect(keys).not.toContain(forbidden)
  }
}

describe('viewer-scoped multiplayer snapshots', () => {
  it('never serializes authoritative secret-state fields', () => {
    const game = createGame(seeds(9))
    const viewer = game.players.find((player) => player.secretRole !== 'vampire')!

    const snapshot = createViewerSnapshot(game, viewer.id, 7)

    expect(snapshot.revision).toBe(7)
    expect(snapshot.self.role).toBe(viewer.secretRole)
    expect(snapshot.revealedRoles).toEqual([])
    expectNoAuthoritativeFields(snapshot)
  })

  it('shows vampire team knowledge only to living vampire viewers', () => {
    const game = createGame(seeds(9))
    const vampires = game.players.filter((player) => player.secretRole === 'vampire')
    const villager = game.players.find((player) => player.secretRole !== 'vampire')!

    const vampireSnapshot = createViewerSnapshot(game, vampires[0].id)
    const villagerSnapshot = createViewerSnapshot(game, villager.id)

    expect(vampireSnapshot.self.knownVampireIds).toEqual([vampires[1].id])
    expect(villagerSnapshot.self.knownVampireIds).toEqual([])
  })

  it('filters private chat messages before they reach another client', () => {
    let game = beginNight(createGame(seeds(9)))
    const vampire = game.players.find((player) => player.secretRole === 'vampire')!
    const nonVampire = game.players.find((player) => player.secretRole !== 'vampire')!

    game = sendChatMessage(game, vampire.id, 'vampire', 'Gizli hedef konuşması.')

    const outsiderSnapshot = createViewerSnapshot(game, nonVampire.id)
    const vampireSnapshot = createViewerSnapshot(game, vampire.id)

    expect(outsiderSnapshot.chatMessages).toEqual([])
    expect(vampireSnapshot.chatMessages.map((message) => message.text))
      .toContain('Gizli hedef konuşması.')
  })

  it('exposes only public night resolution details', () => {
    let game = beginNight(createGame(seeds(9)))
    const vampires = game.players.filter((player) => player.secretRole === 'vampire')
    const target = game.players.find((player) => player.secretRole !== 'vampire')!

    for (const vampire of vampires) {
      game = submitNightAction(game, vampire.id, target.id)
    }
    game = resolveNight(game)

    const snapshot = createViewerSnapshot(game, target.id)

    expect(snapshot.lastNight).toEqual({
      round: 1,
      victimId: target.id,
    })
    expectNoAuthoritativeFields(snapshot)
  })

  it('does not expose in-progress votes but exposes legal vote targets', () => {
    let game = beginNight(createGame(seeds(9)))
    game = resolveNight(game)
    game = beginDiscussion(game)
    game = beginVoting(game)

    const viewer = game.players.find((player) => player.alive)!
    const snapshot = createViewerSnapshot(game, viewer.id)

    expect(snapshot.capabilities.canVote).toBe(true)
    expect(snapshot.capabilities.voteTargetIds).not.toContain(viewer.id)
    expect(snapshot.voteHistory).toEqual([])
    expectNoAuthoritativeFields(snapshot)
  })

  it('reveals all roles only after the authoritative game has ended', () => {
    let game: GameState = createGame(seeds(6))
    game = {
      ...game,
      phase: 'ended',
      winner: 'village',
    }

    const snapshot = createViewerSnapshot(game, game.players[0].id)

    expect(snapshot.revealedRoles).toHaveLength(game.players.length)
    expect(snapshot.revealedRoles).toEqual(
      game.players.map((player) => ({
        playerId: player.id,
        role: player.secretRole,
      })),
    )
    expectNoAuthoritativeFields(snapshot)
  })
})
