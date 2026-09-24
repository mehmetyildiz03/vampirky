import {
  beginDiscussion,
  beginNight,
  beginVoting,
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
  withdrawClaim,
} from '../game/engine'
import { ROLE_DEFINITIONS } from '../game/roles'
import type { GamePhase, GameState } from '../game/types'
import type {
  ClientGameCommand,
  CommandAcceptedMessage,
  CommandRejectedMessage,
  ServerGameMessage,
} from './protocol'
import {
  createViewerSnapshot,
  type ViewerGameSnapshot,
  type ViewerRuntimeMeta,
} from './snapshot'

export const SERVER_PHASE_DURATIONS_SECONDS: Partial<Record<GamePhase, number>> = {
  role_reveal: 60,
  night: 40,
  dawn: 8,
  discussion: 90,
  voting: 30,
  resolution: 8,
}

export interface CommandDispatchResult {
  response: CommandAcceptedMessage | CommandRejectedMessage
  snapshot: ViewerGameSnapshot
}

export class AuthoritativeRoom {
  private state: GameState
  private revision: number
  private readonly hostPlayerId: number
  private phaseReadyPlayerIds = new Set<number>()
  private phaseDeadlineAt: number | null
  private phaseDurationSeconds: number | null

  constructor(
    initialState: GameState,
    initialRevision = 0,
    hostPlayerId = initialState.players[0]?.id ?? 0,
    now = Date.now(),
  ) {
    this.state = initialState
    this.revision = initialRevision
    this.hostPlayerId = hostPlayerId
    const duration = SERVER_PHASE_DURATIONS_SECONDS[initialState.phase] ?? null
    this.phaseDurationSeconds = duration
    this.phaseDeadlineAt = duration === null ? null : now + duration * 1000
  }

  getRevision(): number {
    return this.revision
  }

  getPhaseDeadlineAt(): number | null {
    return this.phaseDeadlineAt
  }

  snapshotFor(playerId: number): ViewerGameSnapshot {
    return createViewerSnapshot(
      this.state,
      playerId,
      this.revision,
      this.runtimeMeta(Date.now()),
    )
  }

  messageFor(playerId: number): ServerGameMessage {
    return {
      type: 'game.snapshot',
      revision: this.revision,
      snapshot: this.snapshotFor(playerId),
    }
  }

  dispatch(
    playerId: number,
    command: ClientGameCommand,
    now = Date.now(),
  ): CommandDispatchResult {
    if (command.baseRevision > this.revision) {
      return this.reject(
        playerId,
        command.requestId,
        'stale_revision',
        'Client revision is ahead of the authoritative room.',
      )
    }

    try {
      this.assertMember(playerId)
      const changed = this.applyCommand(playerId, command, now)
      if (!changed) throw new Error('Command did not change authoritative state.')
      this.revision += 1

      return {
        response: {
          type: 'command.accepted',
          requestId: command.requestId,
          revision: this.revision,
        },
        snapshot: this.snapshotFor(playerId),
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Command rejected.'
      return this.reject(
        playerId,
        command.requestId,
        classifyError(message),
        message,
      )
    }
  }

  advanceExpired(now = Date.now()): boolean {
    if (this.phaseDeadlineAt === null || now < this.phaseDeadlineAt) return false
    if (this.state.phase === 'ended') return false

    this.advanceCurrentPhase(now)
    this.revision += 1
    return true
  }

  private applyCommand(
    playerId: number,
    command: ClientGameCommand,
    now: number,
  ): boolean {
    if (command.type === 'phase.ready') {
      return this.markPhaseReady(playerId, now)
    }

    if (command.type === 'phase.advance') {
      if (playerId !== this.hostPlayerId) {
        throw new Error('Only the host can advance discussion early.')
      }
      if (this.state.phase !== 'discussion') {
        throw new Error('Early phase advance is only available during discussion.')
      }
      this.transitionTo(beginVoting(this.state), now)
      return true
    }

    if (command.type === 'chat.send') {
      this.state = sendChatMessage(this.state, playerId, command.channel, command.text)
      return true
    }

    if (command.type === 'night.submit') {
      this.state = submitNightAction(this.state, playerId, command.targetId)
      if (this.allNightActionsSubmitted()) {
        this.transitionTo(resolveNight(this.state), now)
      }
      return true
    }

    if (command.type === 'vote.submit') {
      this.state = submitVote(this.state, playerId, command.targetId)
      if (this.allLivingVotesSubmitted()) {
        this.transitionTo(resolveVote(this.state), now)
      }
      return true
    }

    if (command.type === 'claim.withdraw') {
      if (!['discussion', 'voting'].includes(this.state.phase)) {
        throw new Error('Public claims can only be changed during the day.')
      }
      const player = this.state.players.find((candidate) => candidate.id === playerId)!
      if (!player.alive) throw new Error('Dead players cannot change public claims.')

      const claim = this.state.claims.find((candidate) => candidate.id === command.claimId)
      if (!claim) throw new Error('Claim not found.')
      if (claim.claimantId !== playerId) {
        throw new Error('Players may only withdraw their own public claims.')
      }
      this.state = withdrawClaim(this.state, command.claimId)
      return true
    }

    if (!['discussion', 'voting'].includes(this.state.phase)) {
      throw new Error('Public claims can only be recorded during the day.')
    }

    const payload = command.payload
    if (payload.kind === 'role') {
      this.state = recordRoleClaim(
        this.state,
        playerId,
        payload.role,
        payload.quote,
        payload.sourceMessageId,
      )
    } else if (payload.kind === 'information') {
      this.state = recordInformationClaim(
        this.state,
        playerId,
        payload.targetId,
        payload.statement,
        payload.quote,
        payload.sourceMessageId,
      )
    } else if (payload.kind === 'action') {
      this.state = recordActionClaim(
        this.state,
        playerId,
        payload.targetId,
        payload.action,
        payload.quote,
        payload.sourceMessageId,
      )
    } else if (payload.kind === 'accusation') {
      this.state = recordAccusationClaim(
        this.state,
        playerId,
        payload.targetId,
        payload.suspectedRole,
        payload.quote,
        payload.sourceMessageId,
      )
    } else {
      this.state = recordDefenseClaim(
        this.state,
        playerId,
        payload.targetId,
        payload.quote,
        payload.sourceMessageId,
      )
    }
    return true
  }

  private markPhaseReady(playerId: number, now: number): boolean {
    if (!['role_reveal', 'dawn', 'resolution'].includes(this.state.phase)) {
      throw new Error('This phase does not accept ready confirmations.')
    }
    if (this.phaseReadyPlayerIds.has(playerId)) {
      throw new Error('Player is already ready for this phase.')
    }

    this.phaseReadyPlayerIds.add(playerId)
    if (this.phaseReadyPlayerIds.size >= this.readyRequired()) {
      this.advanceCurrentPhase(now)
    }
    return true
  }

  private advanceCurrentPhase(now: number): void {
    if (this.state.phase === 'role_reveal') {
      this.transitionTo(beginNight(this.state), now)
      return
    }
    if (this.state.phase === 'night') {
      this.transitionTo(resolveNight(this.state), now)
      return
    }
    if (this.state.phase === 'dawn') {
      this.transitionTo(beginDiscussion(this.state), now)
      return
    }
    if (this.state.phase === 'discussion') {
      this.transitionTo(beginVoting(this.state), now)
      return
    }
    if (this.state.phase === 'voting') {
      this.transitionTo(resolveVote(this.state), now)
      return
    }
    if (this.state.phase === 'resolution') {
      this.transitionTo(beginNight(this.state), now)
      return
    }
    throw new Error('Current phase cannot advance.')
  }

  private transitionTo(next: GameState, now: number): void {
    this.state = next
    this.phaseReadyPlayerIds.clear()
    const duration = SERVER_PHASE_DURATIONS_SECONDS[next.phase] ?? null
    this.phaseDurationSeconds = duration
    this.phaseDeadlineAt = duration === null ? null : now + duration * 1000
  }

  private allNightActionsSubmitted(): boolean {
    if (this.state.phase !== 'night') return false
    const required = this.state.players
      .filter(
        (player) =>
          player.alive &&
          ROLE_DEFINITIONS[player.secretRole].nightAction !== null,
      )
      .map((player) => player.id)

    if (required.length === 0) return true
    const submitted = new Set(this.state.nightActions.map((action) => action.actorId))
    return required.every((id) => submitted.has(id))
  }

  private allLivingVotesSubmitted(): boolean {
    if (this.state.phase !== 'voting') return false
    const living = this.state.players.filter((player) => player.alive)
    return living.every((player) => Object.hasOwn(this.state.dayVotes, player.id))
  }

  private readyRequired(): number {
    return ['role_reveal', 'dawn', 'resolution'].includes(this.state.phase)
      ? this.state.players.length
      : 0
  }

  private runtimeMeta(now: number): ViewerRuntimeMeta {
    return {
      serverNow: now,
      hostPlayerId: this.hostPlayerId,
      phaseDeadlineAt: this.phaseDeadlineAt,
      phaseDurationSeconds: this.phaseDurationSeconds,
      phaseReadyPlayerIds: [...this.phaseReadyPlayerIds],
      phaseReadyRequired: this.readyRequired(),
    }
  }

  private assertMember(playerId: number): void {
    if (!this.state.players.some((player) => player.id === playerId)) {
      throw new Error('Player is not a member of this room.')
    }
  }

  private reject(
    playerId: number,
    requestId: string,
    code: CommandRejectedMessage['code'],
    message: string,
  ): CommandDispatchResult {
    return {
      response: {
        type: 'command.rejected',
        requestId,
        code,
        message,
        revision: this.revision,
      },
      snapshot: this.snapshotFor(playerId),
    }
  }
}

function classifyError(message: string): CommandRejectedMessage['code'] {
  const normalized = message.toLocaleLowerCase('en-US')
  if (
    normalized.includes('only') ||
    normalized.includes('member') ||
    normalized.includes('dead players')
  ) {
    return 'not_authorized'
  }
  if (
    normalized.includes('phase') ||
    normalized.includes('during the day') ||
    normalized.includes('discussion')
  ) {
    return 'invalid_phase'
  }
  if (normalized.includes('target')) return 'invalid_target'
  return 'invalid_payload'
}
