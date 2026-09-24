import {
  getChatAccess,
  getPrivatePlayerView,
  getPublicPlayers,
  getVisibleChatMessages,
  validNightTargets,
} from '../game/engine'
import type {
  ChatAccess,
  ChatMessage,
  GameEvent,
  GamePhase,
  GameState,
  PublicPlayer,
  RoleId,
  SeerIntel,
  StructuredClaim,
  VoteRecord,
  VoteResolution,
  Winner,
} from '../game/types'

export interface ViewerSelfSnapshot {
  id: number
  alive: boolean
  role: RoleId
  knownVampireIds: number[]
  intel: SeerIntel[]
}

export interface PublicNightSnapshot {
  round: number
  victimId: number | null
}

export interface ViewerCapabilities {
  readableChatChannels: ChatAccess['readable']
  writableChatChannels: ChatAccess['writable']
  canRecordPublicClaim: boolean
  canWithdrawPublicClaim: boolean
  canVote: boolean
  voteTargetIds: number[]
  hasSubmittedVote: boolean
  canActAtNight: boolean
  nightTargetIds: number[]
  hasSubmittedNightAction: boolean
  canMarkPhaseReady: boolean
  hasMarkedPhaseReady: boolean
  canAdvancePhase: boolean
}

export interface RevealedRole {
  playerId: number
  role: RoleId
}

export interface ViewerRuntimeMeta {
  serverNow: number
  hostPlayerId: number
  phaseDeadlineAt: number | null
  phaseDurationSeconds: number | null
  phaseReadyPlayerIds: number[]
  phaseReadyRequired: number
}

export interface ViewerGameSnapshot {
  revision: number
  gameId: string
  serverNow: number
  phase: GamePhase
  round: number
  winner: Winner
  hostPlayerId: number
  phaseDeadlineAt: number | null
  phaseDurationSeconds: number | null
  phaseReadyCount: number
  phaseReadyRequired: number
  players: PublicPlayer[]
  self: ViewerSelfSnapshot
  claims: StructuredClaim[]
  chatMessages: ChatMessage[]
  voteHistory: VoteRecord[]
  lastNight: PublicNightSnapshot | null
  lastVote: VoteResolution | null
  events: GameEvent[]
  capabilities: ViewerCapabilities
  revealedRoles: RevealedRole[]
}

function cloneClaims(claims: StructuredClaim[]): StructuredClaim[] {
  return claims.map((claim) => ({ ...claim }))
}

function buildCapabilities(
  state: GameState,
  viewerId: number,
  runtime: ViewerRuntimeMeta,
): ViewerCapabilities {
  const view = getPrivatePlayerView(state, viewerId)
  const self = view.publicPlayers.find((player) => player.id === viewerId)
  if (!self) throw new Error('Viewer not found in public player view.')

  const chat = getChatAccess(state, viewerId)
  const voteTargetIds =
    state.phase === 'voting' && self.alive
      ? state.players
          .filter((player) => player.alive && player.id !== viewerId)
          .map((player) => player.id)
      : []

  const nightTargetIds =
    state.phase === 'night' && self.alive
      ? validNightTargets(state, viewerId).map((player) => player.id)
      : []

  const readyPhase = ['role_reveal', 'dawn', 'resolution'].includes(state.phase)

  return {
    readableChatChannels: [...chat.readable],
    writableChatChannels: [...chat.writable],
    canRecordPublicClaim:
      self.alive && ['discussion', 'voting'].includes(state.phase),
    canWithdrawPublicClaim:
      self.alive && ['discussion', 'voting'].includes(state.phase),
    canVote: voteTargetIds.length > 0,
    voteTargetIds,
    hasSubmittedVote: Object.hasOwn(state.dayVotes, viewerId),
    canActAtNight: nightTargetIds.length > 0,
    nightTargetIds,
    hasSubmittedNightAction: state.nightActions.some(
      (action) => action.actorId === viewerId,
    ),
    canMarkPhaseReady: readyPhase && !runtime.phaseReadyPlayerIds.includes(viewerId),
    hasMarkedPhaseReady: runtime.phaseReadyPlayerIds.includes(viewerId),
    canAdvancePhase:
      viewerId === runtime.hostPlayerId && state.phase === 'discussion',
  }
}

export function createViewerSnapshot(
  state: GameState,
  viewerId: number,
  revision = 0,
  runtime: ViewerRuntimeMeta = {
    serverNow: Date.now(),
    hostPlayerId: state.players[0]?.id ?? 0,
    phaseDeadlineAt: null,
    phaseDurationSeconds: null,
    phaseReadyPlayerIds: [],
    phaseReadyRequired: 0,
  },
): ViewerGameSnapshot {
  const privateView = getPrivatePlayerView(state, viewerId)
  const self = privateView.publicPlayers.find((player) => player.id === viewerId)
  if (!self) throw new Error('Viewer not found.')

  return {
    revision,
    gameId: state.id,
    phase: state.phase,
    round: state.round,
    winner: state.winner,
    serverNow: runtime.serverNow,
    hostPlayerId: runtime.hostPlayerId,
    phaseDeadlineAt: runtime.phaseDeadlineAt,
    phaseDurationSeconds: runtime.phaseDurationSeconds,
    phaseReadyCount: runtime.phaseReadyPlayerIds.length,
    phaseReadyRequired: runtime.phaseReadyRequired,
    players: getPublicPlayers(state),
    self: {
      id: viewerId,
      alive: self.alive,
      role: privateView.selfRole,
      knownVampireIds: [...privateView.knownVampireIds],
      intel: privateView.intel.map((intel) => ({ ...intel })),
    },
    claims: cloneClaims(state.claims),
    chatMessages: getVisibleChatMessages(state, viewerId),
    voteHistory: state.voteHistory.map((vote) => ({ ...vote })),
    lastNight: state.lastNight
      ? {
          round: state.lastNight.round,
          victimId: state.lastNight.victimId,
        }
      : null,
    lastVote: state.lastVote ? { ...state.lastVote } : null,
    events: state.events.map((event) => ({ ...event })),
    capabilities: buildCapabilities(state, viewerId, runtime),
    revealedRoles:
      state.phase === 'ended'
        ? state.players.map((player) => ({
            playerId: player.id,
            role: player.secretRole,
          }))
        : [],
  }
}
