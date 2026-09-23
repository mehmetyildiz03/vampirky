import { describe, expect, it } from 'vitest'
import {
  beginDiscussion,
  beginNight,
  beginVoting,
  createGame,
  groupRoleClaims,
  withdrawClaim,
  getActiveClaims,
  getChatAccess,
  getPlayerTimeline,
  getPrivatePlayerView,
  getVisibleChatMessages,
  getVoteHistory,
  recordAccusationClaim,
  recordActionClaim,
  recordDefenseClaim,
  recordInformationClaim,
  recordRoleClaim,
  resolveNight,
  resolveVote,
  sendChatMessage,
  submitNightAction,
  submitVote,
} from './engine'
import { buildRolePack, countRoles } from './roles'
import type { PlayerSeed } from './types'

function seeds(count: number): PlayerSeed[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    name: `Oyuncu ${index + 1}`,
  }))
}

describe('role pack', () => {
  it('builds a balanced 9-player pack', () => {
    expect(countRoles(buildRolePack(9))).toEqual({
      vampire: 2,
      villager: 5,
      seer: 1,
      protector: 1,
    })
  })
})

describe('secret information boundary', () => {
  it('never exposes secretRole through publicPlayers', () => {
    const game = createGame(seeds(9))
    const view = getPrivatePlayerView(game, 1)

    expect(view.publicPlayers).toHaveLength(9)
    for (const player of view.publicPlayers) {
      expect('secretRole' in player).toBe(false)
    }
  })

  it('only reveals vampire allies to a vampire viewer', () => {
    const game = createGame(seeds(9))
    const vampire = game.players.find((player) => player.secretRole === 'vampire')!
    const villager = game.players.find((player) => player.secretRole !== 'vampire')!

    expect(getPrivatePlayerView(game, vampire.id).knownVampireIds.length).toBe(1)
    expect(getPrivatePlayerView(game, villager.id).knownVampireIds).toEqual([])
  })
})

describe('night resolution', () => {
  it('lets protection stop a coordinated vampire attack and keeps seer intel private', () => {
    let game = beginNight(createGame(seeds(9)))

    const vampires = game.players.filter((player) => player.secretRole === 'vampire')
    const protector = game.players.find((player) => player.secretRole === 'protector')!
    const seer = game.players.find((player) => player.secretRole === 'seer')!
    const target = game.players.find(
      (player) =>
        player.secretRole !== 'vampire' &&
        player.id !== protector.id &&
        player.id !== seer.id,
    )!

    for (const vampire of vampires) {
      game = submitNightAction(game, vampire.id, target.id)
    }
    game = submitNightAction(game, protector.id, target.id)
    game = submitNightAction(game, seer.id, vampires[0].id)
    game = resolveNight(game)

    expect(game.lastNight?.attackedId).toBe(target.id)
    expect(game.lastNight?.victimId).toBeNull()
    expect(game.players.find((player) => player.id === target.id)?.alive).toBe(true)

    const seerView = getPrivatePlayerView(game, seer.id)
    const otherView = getPrivatePlayerView(game, protector.id)
    expect(seerView.intel.at(-1)).toMatchObject({
      targetId: vampires[0].id,
      isVampire: true,
    })
    expect(otherView.intel).toEqual([])
  })

  it('kills the target when the coordinated attack is not protected', () => {
    let game = beginNight(createGame(seeds(9)))
    const vampires = game.players.filter((player) => player.secretRole === 'vampire')
    const target = game.players.find((player) => player.secretRole !== 'vampire')!

    for (const vampire of vampires) {
      game = submitNightAction(game, vampire.id, target.id)
    }
    game = resolveNight(game)

    expect(game.lastNight?.victimId).toBe(target.id)
    expect(game.players.find((player) => player.id === target.id)?.alive).toBe(false)
  })
})

describe('day resolution', () => {
  it('ends the game for the village when the only vampire is eliminated', () => {
    let game = beginNight(createGame(seeds(6)))
    game = resolveNight(game)
    game = beginDiscussion(game)
    game = beginVoting(game)

    const vampire = game.players.find((player) => player.secretRole === 'vampire')!
    for (const voter of game.players.filter(
      (player) => player.alive && player.id !== vampire.id,
    )) {
      game = submitVote(game, voter.id, vampire.id)
    }

    game = resolveVote(game)

    expect(game.lastVote?.eliminatedId).toBe(vampire.id)
    expect(game.winner).toBe('village')
    expect(game.phase).toBe('ended')
  })
})

describe('claim system', () => {
  it('groups any number of active role claims without labeling them as a contradiction', () => {
    let game = createGame(seeds(9))
    game = recordRoleClaim(game, 1, 'seer', 'Ben Kâhinim.')
    game = recordRoleClaim(game, 2, 'seer', 'Kâhin benim.')
    game = recordRoleClaim(game, 3, 'seer', 'Ben de Kâhinim.')

    const groups = groupRoleClaims(game)
    const seerGroup = groups.find((group) => group.role === 'seer')

    expect(seerGroup?.claims.map((claim) => claim.claimantId)).toEqual([1, 2, 3])
  })

  it('keeps different role claims in different groups', () => {
    let game = createGame(seeds(9))
    game = recordRoleClaim(game, 1, 'seer')
    game = recordRoleClaim(game, 2, 'protector')
    game = recordRoleClaim(game, 3, 'villager')

    expect(groupRoleClaims(game).map((group) => group.role)).toEqual([
      'seer',
      'protector',
      'villager',
    ])
  })

  it('removes withdrawn role claims from active claim groups without deleting history', () => {
    let game = createGame(seeds(9))
    game = recordRoleClaim(game, 1, 'seer')
    game = recordRoleClaim(game, 2, 'seer')
    game = withdrawClaim(game, 1)

    expect(groupRoleClaims(game)[0].claims.map((claim) => claim.claimantId)).toEqual([2])
    expect(game.claims).toHaveLength(2)
    expect(game.claims.find((claim) => claim.id === 1)?.status).toBe('withdrawn')
  })
})


describe('structured social claims', () => {
  it('records information, action, accusation and defense as separate public claim types', () => {
    let game = createGame(seeds(9))
    game = recordInformationClaim(game, 1, 2, 'Masum olduğunu söylüyor.', 'Ayşe masum çıktı.')
    game = recordActionClaim(game, 3, 2, 'protected', 'Ayşe’yi korudum.')
    game = recordAccusationClaim(game, 4, 5, 'vampire', 'Burak bana göre Vampir.')
    game = recordDefenseClaim(game, 6, 2, 'Ayşe’ye güveniyorum.')

    expect(getActiveClaims(game).map((claim) => claim.kind)).toEqual([
      'information',
      'action',
      'accusation',
      'defense',
    ])
  })

  it('does not validate a public claim against secret role truth', () => {
    let game = createGame(seeds(9))
    const villager = game.players.find((player) => player.secretRole === 'villager')!
    const target = game.players.find((player) => player.id !== villager.id)!

    game = recordInformationClaim(
      game,
      villager.id,
      target.id,
      'Vampir olduğunu gördüm.',
    )

    expect(getActiveClaims(game)).toHaveLength(1)
    expect(getActiveClaims(game)[0].kind).toBe('information')
  })

  it('keeps withdrawn non-role claims in history but out of active claims', () => {
    let game = createGame(seeds(9))
    game = recordAccusationClaim(game, 1, 2, 'vampire')
    const claimId = game.claims[0].id
    game = withdrawClaim(game, claimId)

    expect(getActiveClaims(game)).toEqual([])
    expect(game.claims[0].status).toBe('withdrawn')
  })

  it('rejects new claims from dead players', () => {
    let game = beginNight(createGame(seeds(9)))
    const vampires = game.players.filter((player) => player.secretRole === 'vampire')
    const target = game.players.find((player) => player.secretRole !== 'vampire')!

    for (const vampire of vampires) {
      game = submitNightAction(game, vampire.id, target.id)
    }
    game = resolveNight(game)

    expect(() =>
      recordDefenseClaim(game, target.id, vampires[0].id, 'Ona güveniyorum.'),
    ).toThrow('Dead players cannot create new claims.')
  })
})


describe('public player history', () => {
  it('persists completed votes across rounds', () => {
    let game = beginNight(createGame(seeds(9)))
    game = resolveNight(game)
    game = beginDiscussion(game)
    game = beginVoting(game)

    const voter = game.players.find((player) => player.alive)!
    const target = game.players.find(
      (player) => player.alive && player.id !== voter.id,
    )!
    game = submitVote(game, voter.id, target.id)
    game = resolveVote(game)

    expect(getVoteHistory(game)).toContainEqual({
      round: 1,
      voterId: voter.id,
      targetId: target.id,
    })
  })

  it('builds one player timeline from claims and final votes', () => {
    let game = createGame(seeds(9))
    game = recordRoleClaim(game, 1, 'seer', 'Ben Kâhinim.')
    game = recordDefenseClaim(game, 1, 2, 'Ayşe’ye güveniyorum.')
    game = withdrawClaim(game, game.claims[0].id)

    game = beginNight(game)
    game = resolveNight(game)
    game = beginDiscussion(game)
    game = beginVoting(game)

    const target = game.players.find(
      (player) => player.alive && player.id !== 1,
    )!
    game = submitVote(game, 1, target.id)
    game = resolveVote(game)

    const timeline = getPlayerTimeline(game, 1)

    expect(timeline.map((entry) => entry.kind)).toEqual([
      'claim',
      'claim',
      'vote',
    ])
    expect(
      timeline.find(
        (entry) => entry.kind === 'claim' && entry.claim.kind === 'role',
      ),
    ).toMatchObject({
      kind: 'claim',
      claim: { status: 'withdrawn' },
    })
    expect(timeline.at(-1)).toMatchObject({
      kind: 'vote',
      vote: { targetId: target.id },
    })
  })
})


describe('chat channels', () => {
  it('allows living players to write only to village chat during discussion', () => {
    let game = beginNight(createGame(seeds(9)))
    game = resolveNight(game)
    game = beginDiscussion(game)

    const living = game.players.find((player) => player.alive)!

    expect(getChatAccess(game, living.id).writable).toContain('village')
    game = sendChatMessage(game, living.id, 'village', 'Bence dikkatli olalım.')

    expect(getVisibleChatMessages(game, living.id).at(-1)).toMatchObject({
      channel: 'village',
      authorId: living.id,
      text: 'Bence dikkatli olalım.',
    })
  })

  it('allows living vampires to use vampire chat at night and hides it from non-vampires', () => {
    let game = beginNight(createGame(seeds(9)))
    const vampire = game.players.find((player) => player.secretRole === 'vampire')!
    const villager = game.players.find((player) => player.secretRole !== 'vampire')!

    expect(getChatAccess(game, vampire.id).writable).toContain('vampire')
    expect(getChatAccess(game, villager.id).readable).not.toContain('vampire')

    game = sendChatMessage(game, vampire.id, 'vampire', 'Bu gece aynı hedefe gidelim.')

    expect(getVisibleChatMessages(game, vampire.id).some((message) => message.channel === 'vampire')).toBe(true)
    expect(getVisibleChatMessages(game, villager.id).some((message) => message.channel === 'vampire')).toBe(false)
  })

  it('lets dead players write to ghost chat, read village chat, and never read vampire chat', () => {
    let game = beginNight(createGame(seeds(9)))
    const vampires = game.players.filter((player) => player.secretRole === 'vampire')
    const victim = game.players.find((player) => player.secretRole !== 'vampire')!

    game = sendChatMessage(game, vampires[0].id, 'vampire', 'Gizli takım mesajı.')

    for (const vampire of vampires) {
      game = submitNightAction(game, vampire.id, victim.id)
    }
    game = resolveNight(game)
    game = beginDiscussion(game)

    const living = game.players.find((player) => player.alive)!
    game = sendChatMessage(game, living.id, 'village', 'Gündüz mesajı.')
    game = sendChatMessage(game, victim.id, 'ghost', 'Beni duyabilen var mı?')

    const access = getChatAccess(game, victim.id)
    const visible = getVisibleChatMessages(game, victim.id)

    expect(access.readable).toEqual(['village', 'ghost'])
    expect(access.writable).toEqual(['ghost'])
    expect(visible.some((message) => message.channel === 'village')).toBe(true)
    expect(visible.some((message) => message.channel === 'ghost')).toBe(true)
    expect(visible.some((message) => message.channel === 'vampire')).toBe(false)
  })

  it('rejects cross-channel writes and empty messages', () => {
    let game = beginNight(createGame(seeds(9)))
    const nonVampire = game.players.find((player) => player.secretRole !== 'vampire')!

    expect(() =>
      sendChatMessage(game, nonVampire.id, 'vampire', 'Olmaması gereken mesaj'),
    ).toThrow('Player cannot write to this chat channel right now.')

    game = resolveNight(game)
    game = beginDiscussion(game)

    expect(() =>
      sendChatMessage(game, nonVampire.id, 'village', '   '),
    ).toThrow('Chat message cannot be empty.')
  })
})
