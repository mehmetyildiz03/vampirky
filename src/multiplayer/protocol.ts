import type { ChatChannel, ClaimKind, RoleId } from '../game/types'
import type { ViewerGameSnapshot } from './snapshot'

export type ClientRequestId = string

export type ClaimCommandPayload =
  | {
      kind: 'role'
      role: RoleId
      quote?: string
      sourceMessageId?: number
    }
  | {
      kind: 'information'
      targetId: number
      statement: string
      quote?: string
      sourceMessageId?: number
    }
  | {
      kind: 'action'
      targetId: number
      action: 'protected' | 'investigated' | 'visited'
      quote?: string
      sourceMessageId?: number
    }
  | {
      kind: 'accusation'
      targetId: number
      suspectedRole?: RoleId
      quote?: string
      sourceMessageId?: number
    }
  | {
      kind: 'defense'
      targetId: number
      quote?: string
      sourceMessageId?: number
    }

export type ClientGameCommand =
  | {
      type: 'chat.send'
      requestId: ClientRequestId
      channel: ChatChannel
      text: string
    }
  | {
      type: 'night.submit'
      requestId: ClientRequestId
      targetId: number
    }
  | {
      type: 'vote.submit'
      requestId: ClientRequestId
      targetId: number
    }
  | {
      type: 'claim.record'
      requestId: ClientRequestId
      payload: ClaimCommandPayload
    }
  | {
      type: 'claim.withdraw'
      requestId: ClientRequestId
      claimId: number
    }

export interface SnapshotMessage {
  type: 'game.snapshot'
  revision: number
  snapshot: ViewerGameSnapshot
}

export interface CommandAcceptedMessage {
  type: 'command.accepted'
  requestId: ClientRequestId
  revision: number
}

export interface CommandRejectedMessage {
  type: 'command.rejected'
  requestId: ClientRequestId
  code:
    | 'invalid_phase'
    | 'not_authorized'
    | 'invalid_target'
    | 'invalid_payload'
    | 'stale_revision'
  message: string
  revision: number
}

export type ServerGameMessage =
  | SnapshotMessage
  | CommandAcceptedMessage
  | CommandRejectedMessage

export interface ReconnectHello {
  type: 'session.resume'
  roomId: string
  lastSeenRevision: number
}

// Prevent protocol drift when claim kinds change.
const _claimKinds: ClaimKind[] = [
  'role',
  'information',
  'action',
  'accusation',
  'defense',
]
void _claimKinds
