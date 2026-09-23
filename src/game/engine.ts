import { secureShuffle } from './random'
import { ROLE_DEFINITIONS, buildRolePack } from './roles'
import type {
  GameEvent,
  GamePlayer,
  GameState,
  NightAction,
  NightActionType,
  NightResolution,
  PlayerSeed,
  PrivatePlayerView,
  PublicPlayer,
  RoleClaim,
  RoleId,
  VoteResolution,
  Winner,
} from './types'

function cloneState(state: GameState): GameState {
  return {
    ...state,
    players: state.players.map((player) => ({ ...player })),
    claims: state.claims.map((claim) => ({ ...claim })),
    nightActions: state.nightActions.map((action) => ({ ...action })),
    dayVotes: { ...state.dayVotes },
    privateIntel: Object.fromEntries(
      Object.entries(state.privateIntel).map(([key, value]) => [
        Number(key),
        value.map((intel) => ({ ...intel })),
      ]),
    ),
    events: state.events.map((event) => ({ ...event })),
    lastNight: state.lastNight
      ? { ...state.lastNight, protectedIds: [...state.lastNight.protectedIds] }
      : null,
    lastVote: state.lastVote ? { ...state.lastVote } : null,
  }
}

function assertUniquePlayers(players: readonly PlayerSeed[]): void {
  const ids = new Set<number>()
  const names = new Set<string>()

  for (const player of players) {
    const normalized = player.name.trim().toLocaleLowerCase('tr-TR')
    if (!player.name.trim()) throw new Error('Player names cannot be empty.')
    if (ids.has(player.id)) throw new Error('Player ids must be unique.')
    if (names.has(normalized)) throw new Error('Player names must be unique.')
    ids.add(player.id)
    names.add(normalized)
  }
}

function appendEvent(
  state: GameState,
  type: GameEvent['type'],
  text: string,
): GameState {
  const next = cloneState(state)
  next.events.push({
    id: next.nextEventId,
    round: next.round,
    type,
    text,
  })
  next.nextEventId += 1
  return next
}

function alivePlayers(state: GameState): GamePlayer[] {
  return state.players.filter((player) => player.alive)
}

function findPlayer(state: GameState, id: number): GamePlayer {
  const player = state.players.find((candidate) => candidate.id === id)
  if (!player) throw new Error('Player not found.')
  return player
}

function ensurePhase(state: GameState, phase: GameState['phase']): void {
  if (state.phase !== phase) {
    throw new Error(`Action requires phase "${phase}", current phase is "${state.phase}".`)
  }
}

export function createGame(players: readonly PlayerSeed[]): GameState {
  assertUniquePlayers(players)
  const pack = secureShuffle(buildRolePack(players.length))

  const assignedPlayers: GamePlayer[] = players.map((player, index) => ({
    ...player,
    alive: true,
    secretRole: pack[index],
  }))

  return {
    id: crypto.randomUUID(),
    phase: 'role_reveal',
    round: 1,
    players: assignedPlayers,
    claims: [],
    nightActions: [],
    dayVotes: {},
    privateIntel: Object.fromEntries(players.map((player) => [player.id, []])),
    lastNight: null,
    lastVote: null,
    winner: null,
    nextClaimId: 1,
    nextEventId: 1,
    events: [],
  }
}

export function beginNight(state: GameState): GameState {
  if (!['role_reveal', 'resolution'].includes(state.phase)) {
    throw new Error('Night can only begin after role reveal or day resolution.')
  }

  const next = cloneState(state)
  if (state.phase === 'resolution') next.round += 1
  next.phase = 'night'
  next.nightActions = []
  next.dayVotes = {}
  next.lastNight = null
  next.lastVote = null
  return appendEvent(next, 'system', `${next.round}. gece başladı.`)
}

function expectedActionForRole(role: RoleId): NightActionType | null {
  return ROLE_DEFINITIONS[role].nightAction
}

export function validNightTargets(
  state: GameState,
  actorId: number,
): PublicPlayer[] {
  ensurePhase(state, 'night')
  const actor = findPlayer(state, actorId)
  if (!actor.alive) return []

  const action = expectedActionForRole(actor.secretRole)
  if (!action) return []

  return alivePlayers(state)
    .filter((target) => {
      if (action === 'attack') return target.secretRole !== 'vampire'
      if (action === 'investigate') return target.id !== actor.id
      return true
    })
    .map(({ id, name, alive }) => ({ id, name, alive }))
}

export function submitNightAction(
  state: GameState,
  actorId: number,
  targetId: number,
): GameState {
  ensurePhase(state, 'night')
  const actor = findPlayer(state, actorId)
  const target = findPlayer(state, targetId)

  if (!actor.alive || !target.alive) {
    throw new Error('Only living players can act on living targets.')
  }

  const type = expectedActionForRole(actor.secretRole)
  if (!type) throw new Error('This role has no night action.')

  const validIds = new Set(validNightTargets(state, actorId).map((player) => player.id))
  if (!validIds.has(targetId)) throw new Error('Invalid night target.')

  const next = cloneState(state)
  next.nightActions = next.nightActions.filter((action) => action.actorId !== actorId)
  next.nightActions.push({ actorId, targetId, type })
  return next
}

function pickUniqueMajority(actions: NightAction[]): number | null {
  if (!actions.length) return null
  const counts = new Map<number, number>()

  for (const action of actions) {
    counts.set(action.targetId, (counts.get(action.targetId) ?? 0) + 1)
  }

  const ranking = [...counts.entries()].sort((a, b) => b[1] - a[1])
  if (ranking.length > 1 && ranking[0][1] === ranking[1][1]) return null
  return ranking[0][0]
}

export function resolveNight(state: GameState): GameState {
  ensurePhase(state, 'night')
  let next = cloneState(state)

  const attacks = next.nightActions.filter((action) => action.type === 'attack')
  const protections = next.nightActions.filter((action) => action.type === 'protect')
  const investigations = next.nightActions.filter(
    (action) => action.type === 'investigate',
  )

  const attackedId = pickUniqueMajority(attacks)
  const protectedIds = [...new Set(protections.map((action) => action.targetId))]
  const victimId =
    attackedId !== null && !protectedIds.includes(attackedId) ? attackedId : null

  if (victimId !== null) {
    const victim = findPlayer(next, victimId)
    victim.alive = false
  }

  for (const action of investigations) {
    const target = findPlayer(next, action.targetId)
    next.privateIntel[action.actorId] = [
      ...(next.privateIntel[action.actorId] ?? []),
      {
        round: next.round,
        targetId: action.targetId,
        isVampire: target.secretRole === 'vampire',
      },
    ]
  }

  const resolution: NightResolution = {
    round: next.round,
    attackedId,
    victimId,
    protectedIds,
  }

  next.lastNight = resolution
  next.phase = 'dawn'
  next.nightActions = []
  next = appendEvent(
    next,
    'night',
    victimId === null ? 'Gece kimse ölmedi.' : 'Gece bir oyuncu öldü.',
  )

  return applyWinner(next)
}

export function beginDiscussion(state: GameState): GameState {
  if (state.phase !== 'dawn') throw new Error('Discussion begins after dawn.')
  if (state.winner) return state
  const next = cloneState(state)
  next.phase = 'discussion'
  return next
}

export function beginVoting(state: GameState): GameState {
  ensurePhase(state, 'discussion')
  const next = cloneState(state)
  next.phase = 'voting'
  next.dayVotes = {}
  return next
}

export function submitVote(
  state: GameState,
  voterId: number,
  targetId: number,
): GameState {
  ensurePhase(state, 'voting')
  const voter = findPlayer(state, voterId)
  const target = findPlayer(state, targetId)

  if (!voter.alive || !target.alive) throw new Error('Only living players may vote.')
  if (voterId === targetId) throw new Error('Players cannot vote for themselves.')

  const next = cloneState(state)
  next.dayVotes[voterId] = targetId
  return next
}

export function resolveVote(state: GameState): GameState {
  ensurePhase(state, 'voting')
  let next = cloneState(state)

  const counts = new Map<number, number>()
  for (const targetId of Object.values(next.dayVotes)) {
    counts.set(targetId, (counts.get(targetId) ?? 0) + 1)
  }

  const ranking = [...counts.entries()].sort((a, b) => b[1] - a[1])
  const tied =
    ranking.length > 1 && ranking[0]?.[1] !== undefined && ranking[0][1] === ranking[1][1]
  const eliminatedId = ranking.length && !tied ? ranking[0][0] : null

  if (eliminatedId !== null) findPlayer(next, eliminatedId).alive = false

  const resolution: VoteResolution = {
    round: next.round,
    eliminatedId,
    tied,
  }

  next.lastVote = resolution
  next.phase = 'resolution'
  next = appendEvent(
    next,
    'day',
    eliminatedId === null ? 'Oylama elemesiz sonuçlandı.' : 'Bir oyuncu köyden gönderildi.',
  )

  return applyWinner(next)
}

export function recordRoleClaim(
  state: GameState,
  claimantId: number,
  role: RoleId,
  quote?: string,
): GameState {
  const claimant = findPlayer(state, claimantId)
  if (!claimant.alive) throw new Error('Dead players cannot create new claims.')

  const next = cloneState(state)
  const claim: RoleClaim = {
    id: next.nextClaimId,
    claimantId,
    role,
    quote: quote?.trim() || undefined,
    round: next.round,
  }

  next.claims.push(claim)
  next.nextClaimId += 1
  return next
}

export function findRoleClaimConflicts(state: GameState): RoleClaim[][] {
  const groups = new Map<RoleId, RoleClaim[]>()

  for (const claim of state.claims) {
    if (!ROLE_DEFINITIONS[claim.role].singletonClaim) continue
    const current = groups.get(claim.role) ?? []
    groups.set(claim.role, [...current, claim])
  }

  return [...groups.values()].filter(
    (claims) => new Set(claims.map((claim) => claim.claimantId)).size > 1,
  )
}

function winnerForState(state: GameState): Winner {
  const alive = alivePlayers(state)
  const vampires = alive.filter((player) => player.secretRole === 'vampire').length
  const village = alive.length - vampires

  if (vampires === 0) return 'village'
  if (vampires >= village) return 'vampire'
  return null
}

function applyWinner(state: GameState): GameState {
  const next = cloneState(state)
  const winner = winnerForState(next)
  next.winner = winner
  if (winner) next.phase = 'ended'
  return next
}

export function getPublicPlayers(state: GameState): PublicPlayer[] {
  return state.players.map(({ id, name, alive }) => ({ id, name, alive }))
}

export function getPrivatePlayerView(
  state: GameState,
  viewerId: number,
): PrivatePlayerView {
  const viewer = findPlayer(state, viewerId)
  const knownVampireIds =
    viewer.secretRole === 'vampire'
      ? state.players
          .filter((player) => player.secretRole === 'vampire' && player.id !== viewerId)
          .map((player) => player.id)
      : []

  return {
    publicPlayers: getPublicPlayers(state),
    selfRole: viewer.secretRole,
    knownVampireIds,
    intel: (state.privateIntel[viewerId] ?? []).map((intel) => ({ ...intel })),
    phase: state.phase,
    round: state.round,
    winner: state.winner,
  }
}
