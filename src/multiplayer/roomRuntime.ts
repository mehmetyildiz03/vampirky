import {
  recordAccusationClaim,
  recordActionClaim,
  recordDefenseClaim,
  recordInformationClaim,
  recordRoleClaim,
  sendChatMessage,
  submitNightAction,
  submitVote,
  withdrawClaim,
} from '../game/engine'
import type { GameState } from '../game/types'
import type {
  ClientGameCommand,
  CommandAcceptedMessage,
  CommandRejectedMessage,
  ServerGameMessage,
} from './protocol'
import { createViewerSnapshot, type ViewerGameSnapshot } from './snapshot'

export interface CommandDispatchResult {
  response: CommandAcceptedMessage | CommandRejectedMessage
  snapshot: ViewerGameSnapshot
}

export class AuthoritativeRoom {
  private state: GameState
  private revision = 0

  constructor(initialState: GameState) {
    this.state = initialState
  }

  getRevision(): number {
    return this.revision
  }

  snapshotFor(playerId: number): ViewerGameSnapshot {
    return createViewerSnapshot(this.state, playerId, this.revision)
  }

  messageFor(playerId: number): ServerGameMessage {
    return {
      type: 'game.snapshot',
      revision: this.revision,
      snapshot: this.snapshotFor(playerId),
    }
  }

  dispatch(playerId: number, command: ClientGameCommand): CommandDispatchResult {
    if (command.baseRevision !== this.revision) {
      return this.reject(
        playerId,
        command.requestId,
        'stale_revision',
        'Client revision is stale. Refresh the viewer snapshot before retrying.',
      )
    }

    try {
      const next = this.applyCommand(playerId, command)
      this.state = next
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

  private applyCommand(playerId: number, command: ClientGameCommand): GameState {
    if (!this.state.players.some((player) => player.id === playerId)) {
      throw new Error('Player is not a member of this room.')
    }

    if (command.type === 'chat.send') {
      return sendChatMessage(this.state, playerId, command.channel, command.text)
    }

    if (command.type === 'night.submit') {
      return submitNightAction(this.state, playerId, command.targetId)
    }

    if (command.type === 'vote.submit') {
      return submitVote(this.state, playerId, command.targetId)
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
      return withdrawClaim(this.state, command.claimId)
    }

    if (!['discussion', 'voting'].includes(this.state.phase)) {
      throw new Error('Public claims can only be recorded during the day.')
    }

    const payload = command.payload
    if (payload.kind === 'role') {
      return recordRoleClaim(
        this.state,
        playerId,
        payload.role,
        payload.quote,
        payload.sourceMessageId,
      )
    }
    if (payload.kind === 'information') {
      return recordInformationClaim(
        this.state,
        playerId,
        payload.targetId,
        payload.statement,
        payload.quote,
        payload.sourceMessageId,
      )
    }
    if (payload.kind === 'action') {
      return recordActionClaim(
        this.state,
        playerId,
        payload.targetId,
        payload.action,
        payload.quote,
        payload.sourceMessageId,
      )
    }
    if (payload.kind === 'accusation') {
      return recordAccusationClaim(
        this.state,
        playerId,
        payload.targetId,
        payload.suspectedRole,
        payload.quote,
        payload.sourceMessageId,
      )
    }
    return recordDefenseClaim(
      this.state,
      playerId,
      payload.targetId,
      payload.quote,
      payload.sourceMessageId,
    )
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
  if (normalized.includes('phase') || normalized.includes('during the day')) {
    return 'invalid_phase'
  }
  if (
    normalized.includes('only') ||
    normalized.includes('member') ||
    normalized.includes('dead players')
  ) {
    return 'not_authorized'
  }
  if (normalized.includes('target')) return 'invalid_target'
  return 'invalid_payload'
}
