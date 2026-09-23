import { describe, expect, it } from 'vitest'
import {
  beginDay,
  beginNight,
  beginVote,
  buildClassicRoleDeck,
  createGame,
  determineWinner,
  resolveNight,
  resolveVote,
} from './engine'
import type { GameState, RoleId } from './types'

const players = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, name: `Oyuncu ${i + 1}` }))
const zeroRandom = () => 0

function forceRoles(state: GameState, roles: RoleId[]): GameState {
  return {
    ...state,
    secret: {
      ...state.secret,
      roles: Object.fromEntries(state.public.players.map((p, i) => [p.id, roles[i]])),
    },
  }
}

describe('classic role deck', () => {
  it('10 oyuncuda 2 vampir, 1 kâhin, 1 koruyucu ve 6 köylü üretir', () => {
    const deck = buildClassicRoleDeck(10)
    expect(deck.filter((r) => r === 'vampire')).toHaveLength(2)
    expect(deck.filter((r) => r === 'seer')).toHaveLength(1)
    expect(deck.filter((r) => r === 'guardian')).toHaveLength(1)
    expect(deck.filter((r) => r === 'villager')).toHaveLength(6)
  })

  it('her oyuncuya tam bir rol dağıtır', () => {
    const game = createGame(players, zeroRandom)
    expect(Object.keys(game.secret.roles)).toHaveLength(players.length)
    expect(new Set(Object.keys(game.secret.roles).map(Number))).toEqual(new Set(players.map((p) => p.id)))
  })
})

describe('night resolution', () => {
  it('koruyucu vampir saldırısını engeller', () => {
    let game = createGame(players, zeroRandom)
    game = forceRoles(game, ['vampire','vampire','seer','guardian','villager','villager','villager','villager','villager','villager'])
    game = beginNight(game)
    game = resolveNight(game, [
      { actorId: 1, type: 'vampire-kill', targetId: 5 },
      { actorId: 2, type: 'vampire-kill', targetId: 5 },
      { actorId: 3, type: 'investigate', targetId: 1 },
      { actorId: 4, type: 'protect', targetId: 5 },
    ])
    expect(game.public.lastNight?.killedPlayerId).toBeNull()
    expect(game.public.players.find((p) => p.id === 5)?.alive).toBe(true)
  })

  it('kâhin sonucu gizli kalır ve public state rol bilgisi sızdırmaz', () => {
    let game = createGame(players, zeroRandom)
    game = forceRoles(game, ['vampire','vampire','seer','guardian','villager','villager','villager','villager','villager','villager'])
    game = beginNight(game)
    game = resolveNight(game, [
      { actorId: 1, type: 'vampire-kill', targetId: 5 },
      { actorId: 2, type: 'vampire-kill', targetId: 5 },
      { actorId: 3, type: 'investigate', targetId: 1 },
      { actorId: 4, type: 'protect', targetId: 6 },
    ])
    expect(game.secret.investigations[3].at(-1)?.team).toBe('vampire')
    expect(JSON.stringify(game.public)).not.toContain('"roles"')
    expect(JSON.stringify(game.public)).not.toContain('"investigations"')
    expect(JSON.stringify(game.public)).not.toContain('protectedPlayerId')
  })
})

describe('voting and win conditions', () => {
  it('tek çoğunluk adayını eler', () => {
    let game = createGame(players, zeroRandom)
    game = forceRoles(game, ['vampire','vampire','seer','guardian','villager','villager','villager','villager','villager','villager'])
    game = beginNight(game)
    game = resolveNight(game, [
      { actorId: 1, type: 'vampire-kill', targetId: 10 },
      { actorId: 2, type: 'vampire-kill', targetId: 10 },
      { actorId: 3, type: 'investigate', targetId: 1 },
      { actorId: 4, type: 'protect', targetId: 9 },
    ])
    game = beginDay(game)
    game = beginVote(game)
    game = resolveVote(game, [
      { voterId: 1, targetId: 2 },
      { voterId: 2, targetId: 1 },
      { voterId: 3, targetId: 1 },
      { voterId: 4, targetId: 1 },
      { voterId: 5, targetId: 1 },
      { voterId: 6, targetId: 1 },
      { voterId: 7, targetId: 1 },
      { voterId: 8, targetId: 1 },
      { voterId: 9, targetId: 1 },
    ])
    expect(game.public.lastEliminatedPlayerId).toBe(1)
    expect(game.public.players.find((p) => p.id === 1)?.alive).toBe(false)
  })

  it('son vampir gidince köy kazanır', () => {
    let game = createGame(players.slice(0, 6), zeroRandom)
    game = forceRoles(game, ['vampire','seer','guardian','villager','villager','villager'])
    game = {
      ...game,
      public: {
        ...game.public,
        players: game.public.players.map((p) => p.id === 1 ? { ...p, alive: false } : p),
      },
    }
    expect(determineWinner(game)).toBe('village')
  })

  it('vampirler yaşayan diğer oyuncularla eşitlendiğinde vampir tarafı kazanır', () => {
    let game = createGame(players.slice(0, 6), zeroRandom)
    game = forceRoles(game, ['vampire','seer','guardian','villager','villager','villager'])
    game = {
      ...game,
      public: {
        ...game.public,
        players: game.public.players.map((p) => ({ ...p, alive: [1, 2].includes(p.id) })),
      },
    }
    expect(determineWinner(game)).toBe('vampire')
  })
})
