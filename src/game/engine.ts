import { secureShuffle } from './random'
import { ROLE_DEFINITIONS, buildRolePack } from './roles'
import type {
  ChatAccess,
  ChatChannel,
  ChatMessage,
  GameEvent,
  GamePlayer,
  GameState,
  NightAction,
  NightActionType,
  NightResolution,
  PlayerSeed,
  PlayerTimelineEntry,
  PrivatePlayerView,
  PublicPlayer,
  ActionClaim,
  AccusationClaim,
  DefenseClaim,
  InformationClaim,
  RoleClaim,
  RoleClaimGroup,
  RoleId,
  StructuredClaim,
  VoteRecord,
  VoteResolution,
  Winner,
} from './types'

function cloneState(state: GameState): GameState {
  return {
    ...state,
    players: state.players.map((player) => ({ ...player })),
    claims: state.claims.map((claim) => ({ ...claim })),
    chatMessages: state.chatMessages.map((message) => ({ ...message })),
    nightActions: state.nightActions.map((action) => ({ ...action })),
    dayVotes: { ...state.dayVotes },
    voteHistory: state.voteHistory.map((vote) => ({ ...vote })),
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
    chatMessages: [],
    nightActions: [],
    dayVotes: {},
    voteHistory: [],
    privateIntel: Object.fromEntries(players.map((player) => [player.id, []])),
    lastNight: null,
    lastVote: null,
    winner: null,
    nextClaimId: 1,
    nextChatMessageId: 1,
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

  const completedVotes: VoteRecord[] = Object.entries(next.dayVotes).map(
    ([voterId, targetId]) => ({
      round: next.round,
      voterId: Number(voterId),
      targetId,
    }),
  )
  next.voteHistory.push(...completedVotes)
  next.lastVote = resolution
  next.phase = 'resolution'
  next = appendEvent(
    next,
    'day',
    eliminatedId === null ? 'Oylama elemesiz sonuçlandı.' : 'Bir oyuncu köyden gönderildi.',
  )

  return applyWinner(next)
}

export function getChatAccess(
  state: GameState,
  viewerId: number,
): ChatAccess {
  const viewer = findPlayer(state, viewerId)

  if (!viewer.alive) {
    return {
      readable: ['village', 'ghost'],
      writable: state.phase === 'ended' ? [] : ['ghost'],
    }
  }

  const readable: ChatChannel[] = ['village']
  const writable: ChatChannel[] = []

  if (['discussion', 'voting'].includes(state.phase)) {
    writable.push('village')
  }

  if (viewer.secretRole === 'vampire') {
    readable.push('vampire')
    if (state.phase === 'night') writable.push('vampire')
  }

  return { readable, writable }
}

export function getVisibleChatMessages(
  state: GameState,
  viewerId: number,
): ChatMessage[] {
  const readable = new Set(getChatAccess(state, viewerId).readable)
  return state.chatMessages
    .filter((message) => readable.has(message.channel))
    .map((message) => ({ ...message }))
}

export function sendChatMessage(
  state: GameState,
  authorId: number,
  channel: ChatChannel,
  text: string,
): GameState {
  findPlayer(state, authorId)
  const access = getChatAccess(state, authorId)
  if (!access.writable.includes(channel)) {
    throw new Error('Player cannot write to this chat channel right now.')
  }

  const normalized = text.trim()
  if (!normalized) throw new Error('Chat message cannot be empty.')
  if (normalized.length > 280) throw new Error('Chat message is too long.')

  const next = cloneState(state)
  next.chatMessages.push({
    id: next.nextChatMessageId,
    round: next.round,
    phase: next.phase,
    channel,
    authorId,
    text: normalized,
  })
  next.nextChatMessageId += 1
  return next
}

export function recordRoleClaim(
  state: GameState,
  claimantId: number,
  role: RoleId,
  quote?: string,
  sourceMessageId?: number,
): GameState {
  assertClaimCreationAllowed(state, claimantId, sourceMessageId)

  const next = cloneState(state)
  const claim: RoleClaim = {
    id: next.nextClaimId,
    claimantId,
    kind: 'role',
    role,
    quote: quote?.trim() || undefined,
    sourceMessageId,
    round: next.round,
    status: 'active',
  }

  next.claims.push(claim)
  next.nextClaimId += 1
  return next
}

function assertClaimantCanSpeak(state: GameState, claimantId: number): GamePlayer {
  const claimant = findPlayer(state, claimantId)
  if (!claimant.alive) throw new Error('Dead players cannot create new claims.')
  return claimant
}

function assertVillageMessageSource(
  state: GameState,
  claimantId: number,
  sourceMessageId: number,
): ChatMessage {
  const message = state.chatMessages.find((candidate) => candidate.id === sourceMessageId)
  if (!message) throw new Error('Source chat message not found.')
  if (message.channel !== 'village') {
    throw new Error('Only village chat messages can source public claims.')
  }
  if (message.authorId !== claimantId) {
    throw new Error('Claimant must match the source message author.')
  }
  return message
}

function assertClaimCreationAllowed(
  state: GameState,
  claimantId: number,
  sourceMessageId?: number,
): void {
  if (sourceMessageId !== undefined) {
    assertVillageMessageSource(state, claimantId, sourceMessageId)
    return
  }
  assertClaimantCanSpeak(state, claimantId)
}

function assertClaimTargetExists(state: GameState, targetId: number): GamePlayer {
  return findPlayer(state, targetId)
}

function appendStructuredClaim<T extends StructuredClaim>(
  state: GameState,
  claim: Omit<T, 'id' | 'round' | 'status'>,
): GameState {
  const next = cloneState(state)
  next.claims.push({
    ...claim,
    id: next.nextClaimId,
    round: next.round,
    status: 'active',
  } as T)
  next.nextClaimId += 1
  return next
}

export function recordInformationClaim(
  state: GameState,
  claimantId: number,
  targetId: number,
  statement: string,
  quote?: string,
  sourceMessageId?: number,
): GameState {
  assertClaimCreationAllowed(state, claimantId, sourceMessageId)
  assertClaimTargetExists(state, targetId)
  const text = statement.trim()
  if (!text) throw new Error('Information claim statement cannot be empty.')

  return appendStructuredClaim<InformationClaim>(state, {
    claimantId,
    kind: 'information',
    targetId,
    statement: text,
    quote: quote?.trim() || undefined,
    sourceMessageId,
  })
}

export function recordActionClaim(
  state: GameState,
  claimantId: number,
  targetId: number,
  action: ActionClaim['action'],
  quote?: string,
  sourceMessageId?: number,
): GameState {
  assertClaimCreationAllowed(state, claimantId, sourceMessageId)
  assertClaimTargetExists(state, targetId)

  return appendStructuredClaim<ActionClaim>(state, {
    claimantId,
    kind: 'action',
    targetId,
    action,
    quote: quote?.trim() || undefined,
    sourceMessageId,
  })
}

export function recordAccusationClaim(
  state: GameState,
  claimantId: number,
  targetId: number,
  suspectedRole?: RoleId,
  quote?: string,
  sourceMessageId?: number,
): GameState {
  assertClaimCreationAllowed(state, claimantId, sourceMessageId)
  assertClaimTargetExists(state, targetId)

  return appendStructuredClaim<AccusationClaim>(state, {
    claimantId,
    kind: 'accusation',
    targetId,
    suspectedRole,
    quote: quote?.trim() || undefined,
    sourceMessageId,
  })
}

export function recordDefenseClaim(
  state: GameState,
  claimantId: number,
  targetId: number,
  quote?: string,
  sourceMessageId?: number,
): GameState {
  assertClaimCreationAllowed(state, claimantId, sourceMessageId)
  assertClaimTargetExists(state, targetId)

  return appendStructuredClaim<DefenseClaim>(state, {
    claimantId,
    kind: 'defense',
    targetId,
    quote: quote?.trim() || undefined,
    sourceMessageId,
  })
}

export function getActiveClaims(state: GameState): StructuredClaim[] {
  return state.claims
    .filter((claim) => claim.status === 'active')
    .map((claim) => ({ ...claim }))
}

export function getVoteHistory(state: GameState): VoteRecord[] {
  return state.voteHistory.map((vote) => ({ ...vote }))
}

export function getPlayerTimeline(
  state: GameState,
  playerId: number,
): PlayerTimelineEntry[] {
  findPlayer(state, playerId)

  const claimEntries: PlayerTimelineEntry[] = state.claims
    .filter((claim) => claim.claimantId === playerId)
    .map((claim) => ({
      key: `claim-${claim.id}`,
      round: claim.round,
      kind: 'claim',
      claim: { ...claim },
    }))

  const voteEntries: PlayerTimelineEntry[] = state.voteHistory
    .filter((vote) => vote.voterId === playerId)
    .map((vote, index) => ({
      key: `vote-${vote.round}-${vote.voterId}-${index}`,
      round: vote.round,
      kind: 'vote',
      vote: { ...vote },
    }))

  return [...claimEntries, ...voteEntries].sort((a, b) => {
    if (a.round !== b.round) return a.round - b.round
    if (a.kind === b.kind) {
      if (a.kind === 'claim' && b.kind === 'claim') {
        return a.claim.id - b.claim.id
      }
      return 0
    }
    return a.kind === 'claim' ? -1 : 1
  })
}

export function groupRoleClaims(state: GameState): RoleClaimGroup[] {
  const groups = new Map<RoleId, RoleClaim[]>()

  for (const claim of state.claims) {
    if (claim.kind !== 'role' || claim.status !== 'active') continue
    const current = groups.get(claim.role) ?? []
    groups.set(claim.role, [...current, { ...claim }])
  }

  return [...groups.entries()].map(([role, claims]) => ({ role, claims }))
}

export function withdrawClaim(state: GameState, claimId: number): GameState {
  const claim = state.claims.find((candidate) => candidate.id === claimId)
  if (!claim) throw new Error('Claim not found.')

  const next = cloneState(state)
  next.claims = next.claims.map((candidate): StructuredClaim =>
    candidate.id === claimId ? { ...candidate, status: 'withdrawn' } : candidate,
  )
  return next
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
