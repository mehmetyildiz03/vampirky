import { fisherYates, secureRandom } from './random'
import { ROLE_DEFINITIONS, roleTeam } from './roles'
import type {
  GameState,
  NightAction,
  PlayerId,
  PublicPlayer,
  RandomSource,
  RoleId,
  Vote,
  Winner,
} from './types'

export type CreatePlayer = Pick<PublicPlayer, 'id' | 'name'>

const MIN_PLAYERS = 6
const MAX_PLAYERS = 12

export function buildClassicRoleDeck(playerCount: number): RoleId[] {
  if (playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    throw new Error(`Klasik paket ${MIN_PLAYERS}-${MAX_PLAYERS} oyuncu destekliyor.`)
  }

  const vampireCount = playerCount <= 7 ? 1 : 2
  const fixed: RoleId[] = [
    ...Array<RoleId>(vampireCount).fill('vampire'),
    'seer',
    'guardian',
  ]
  return [...fixed, ...Array<RoleId>(playerCount - fixed.length).fill('villager')]
}

export function assignRoles(
  playerIds: PlayerId[],
  random: RandomSource = secureRandom,
): Record<PlayerId, RoleId> {
  if (new Set(playerIds).size !== playerIds.length) {
    throw new Error('Oyuncu kimlikleri benzersiz olmalıdır.')
  }

  const shuffledDeck = fisherYates(buildClassicRoleDeck(playerIds.length), random)
  return Object.fromEntries(playerIds.map((id, index) => [id, shuffledDeck[index]])) as Record<PlayerId, RoleId>
}

export function createGame(players: CreatePlayer[], random: RandomSource = secureRandom): GameState {
  if (new Set(players.map((p) => p.id)).size !== players.length) {
    throw new Error('Oyuncu kimlikleri benzersiz olmalıdır.')
  }

  const roles = assignRoles(players.map((p) => p.id), random)
  const investigations = Object.fromEntries(players.map((p) => [p.id, []]))

  return {
    public: {
      phase: 'role-reveal',
      day: 1,
      players: players.map((p) => ({ ...p, alive: true })),
      voteHistory: [],
      lastNight: null,
      lastEliminatedPlayerId: null,
      winner: null,
    },
    secret: {
      roles,
      investigations,
    },
  }
}

export function getRoleForPlayer(state: GameState, playerId: PlayerId): RoleId {
  const role = state.secret.roles[playerId]
  if (!role) throw new Error('Oyuncu rolü bulunamadı.')
  return role
}

export function beginNight(state: GameState): GameState {
  if (!['role-reveal', 'verdict'].includes(state.public.phase)) {
    throw new Error('Gece yalnızca rol gösteriminden veya karar ekranından başlatılabilir.')
  }

  return {
    ...state,
    public: {
      ...state.public,
      phase: 'night',
      day: state.public.phase === 'verdict' ? state.public.day + 1 : state.public.day,
      lastNight: null,
      lastEliminatedPlayerId: state.public.phase === 'verdict' ? null : state.public.lastEliminatedPlayerId,
    },
  }
}

function alivePlayer(state: GameState, playerId: PlayerId): PublicPlayer {
  const player = state.public.players.find((p) => p.id === playerId)
  if (!player || !player.alive) throw new Error('Hedef oyuncu hayatta değil.')
  return player
}

function validateNightAction(state: GameState, action: NightAction): void {
  if (state.public.phase !== 'night') throw new Error('Gece aksiyonu yalnızca gece aşamasında yapılabilir.')
  alivePlayer(state, action.actorId)
  alivePlayer(state, action.targetId)

  const role = getRoleForPlayer(state, action.actorId)
  const expected = ROLE_DEFINITIONS[role].nightAction
  if (expected !== action.type) throw new Error('Bu rol bu gece aksiyonunu kullanamaz.')

  if (action.actorId === action.targetId && action.type !== 'protect') {
    throw new Error('Bu gece aksiyonunda oyuncu kendisini hedefleyemez.')
  }

  if (action.type === 'vampire-kill' && roleTeam(getRoleForPlayer(state, action.targetId)) === 'vampire') {
    throw new Error('Vampirler kendi takım arkadaşlarını hedefleyemez.')
  }
}

function topVampireTarget(actions: NightAction[]): { targetId: PlayerId | null; tied: boolean } {
  const vampireActions = actions.filter((a) => a.type === 'vampire-kill')
  if (vampireActions.length === 0) return { targetId: null, tied: false }

  const counts = new Map<PlayerId, number>()
  vampireActions.forEach((a) => counts.set(a.targetId, (counts.get(a.targetId) ?? 0) + 1))
  const max = Math.max(...counts.values())
  const top = [...counts.entries()].filter(([, count]) => count === max).map(([targetId]) => targetId)
  return top.length === 1 ? { targetId: top[0], tied: false } : { targetId: null, tied: true }
}

export function resolveNight(state: GameState, actions: NightAction[]): GameState {
  actions.forEach((action) => validateNightAction(state, action))

  const actorKeys = actions.map((action) => `${action.actorId}:${action.type}`)
  if (new Set(actorKeys).size !== actorKeys.length) {
    throw new Error('Bir oyuncu aynı gece aynı aksiyonu birden fazla kez kullanamaz.')
  }

  const { targetId: vampireTarget } = topVampireTarget(actions)
  const protectedPlayerId = actions.find((a) => a.type === 'protect')?.targetId ?? null
  const killedPlayerId = vampireTarget !== null && vampireTarget !== protectedPlayerId ? vampireTarget : null

  const players = state.public.players.map((player) =>
    player.id === killedPlayerId ? { ...player, alive: false } : player,
  )

  const investigations = structuredClone(state.secret.investigations)
  actions
    .filter((action): action is Extract<NightAction, { type: 'investigate' }> => action.type === 'investigate')
    .forEach((action) => {
      investigations[action.actorId] = [
        ...(investigations[action.actorId] ?? []),
        {
          day: state.public.day,
          targetId: action.targetId,
          team: roleTeam(getRoleForPlayer(state, action.targetId)),
        },
      ]
    })

  const next: GameState = {
    public: {
      ...state.public,
      phase: 'dawn',
      players,
      lastNight: {
        day: state.public.day,
        killedPlayerId,
      },
    },
    secret: {
      ...state.secret,
      investigations,
    },
  }

  return withWinner(next)
}

export function beginDay(state: GameState): GameState {
  if (state.public.phase !== 'dawn') throw new Error('Gündüz yalnızca şafak sonucundan sonra başlayabilir.')
  if (state.public.winner) return { ...state, public: { ...state.public, phase: 'ended' } }
  return { ...state, public: { ...state.public, phase: 'day' } }
}

export function beginVote(state: GameState): GameState {
  if (state.public.phase !== 'day') throw new Error('Oylama yalnızca gündüz aşamasında başlayabilir.')
  return { ...state, public: { ...state.public, phase: 'vote' } }
}

function validateVote(state: GameState, vote: Vote): void {
  if (state.public.phase !== 'vote') throw new Error('Oy yalnızca oylama aşamasında verilebilir.')
  alivePlayer(state, vote.voterId)
  alivePlayer(state, vote.targetId)
  if (vote.voterId === vote.targetId) throw new Error('Oyuncu kendisine oy veremez.')
}

export function resolveVote(state: GameState, votes: Vote[]): GameState {
  votes.forEach((vote) => validateVote(state, vote))
  if (new Set(votes.map((v) => v.voterId)).size !== votes.length) {
    throw new Error('Bir oyuncu aynı oylamada birden fazla oy kullanamaz.')
  }

  const counts = new Map<PlayerId, number>()
  votes.forEach((vote) => counts.set(vote.targetId, (counts.get(vote.targetId) ?? 0) + 1))

  let eliminatedPlayerId: PlayerId | null = null
  let tied = true
  if (counts.size > 0) {
    const max = Math.max(...counts.values())
    const top = [...counts.entries()].filter(([, count]) => count === max).map(([id]) => id)
    if (top.length === 1) {
      eliminatedPlayerId = top[0]
      tied = false
    }
  }

  const players = state.public.players.map((player) =>
    player.id === eliminatedPlayerId ? { ...player, alive: false } : player,
  )

  const voteMap = Object.fromEntries(votes.map((v) => [v.voterId, v.targetId])) as Record<PlayerId, PlayerId>
  const next: GameState = {
    ...state,
    public: {
      ...state.public,
      phase: 'verdict',
      players,
      lastEliminatedPlayerId: eliminatedPlayerId,
      voteHistory: [
        ...state.public.voteHistory,
        { day: state.public.day, votes: voteMap, eliminatedPlayerId, tied },
      ],
    },
  }

  return withWinner(next)
}

export function determineWinner(state: GameState): Winner {
  const alive = state.public.players.filter((p) => p.alive)
  const vampires = alive.filter((p) => getRoleForPlayer(state, p.id) === 'vampire').length
  const nonVampires = alive.length - vampires

  if (vampires === 0) return 'village'
  if (vampires >= nonVampires) return 'vampire'
  return null
}

function withWinner(state: GameState): GameState {
  const winner = determineWinner(state)
  if (!winner) return state
  return {
    ...state,
    public: {
      ...state.public,
      winner,
      phase: 'ended',
    },
  }
}

export function livingPlayers(state: GameState): PublicPlayer[] {
  return state.public.players.filter((p) => p.alive)
}

export function validNightTargets(state: GameState, actorId: PlayerId): PublicPlayer[] {
  const actorRole = getRoleForPlayer(state, actorId)
  return livingPlayers(state).filter((target) => {
    if (actorRole === 'guardian') return true
    if (target.id === actorId) return false
    if (actorRole === 'vampire') return roleTeam(getRoleForPlayer(state, target.id)) !== 'vampire'
    return actorRole === 'seer'
  })
}

export function validVoteTargets(state: GameState, voterId: PlayerId): PublicPlayer[] {
  return livingPlayers(state).filter((p) => p.id !== voterId)
}
