import type { ChatChannel, ClaimKind, RoleId } from '../game/types'
import type { ViewerGameSnapshot } from './snapshot'

export type ClientRequestId = string

export interface CommandMeta {
  requestId: ClientRequestId
  baseRevision: number
}

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
  | (CommandMeta & {
      type: 'chat.send'
      channel: ChatChannel
      text: string
    })
  | (CommandMeta & {
      type: 'night.submit'
      targetId: number
    })
  | (CommandMeta & {
      type: 'vote.submit'
      targetId: number
    })
  | (CommandMeta & {
      type: 'claim.record'
      payload: ClaimCommandPayload
    })
  | (CommandMeta & {
      type: 'claim.withdraw'
      claimId: number
    })

export type ClientLobbyCommand =
  | (CommandMeta & {
      type: 'lobby.ready'
      ready: boolean
    })
  | (CommandMeta & {
      type: 'lobby.start'
    })

export interface LobbyPlayerSnapshot {
  id: number
  name: string
  ready: boolean
  connected: boolean
  isHost: boolean
}

export interface LobbySnapshot {
  roomId: string
  revision: number
  phase: 'lobby'
  hostPlayerId: number
  minPlayers: number
  maxPlayers: number
  canStart: boolean
  players: LobbyPlayerSnapshot[]
}

export interface SnapshotMessage {
  type: 'game.snapshot'
  revision: number
  snapshot: ViewerGameSnapshot
}

export interface LobbySnapshotMessage {
  type: 'lobby.snapshot'
  revision: number
  snapshot: LobbySnapshot
}

export type RoomSnapshotMessage = SnapshotMessage | LobbySnapshotMessage

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
  | RoomSnapshotMessage
  | CommandAcceptedMessage
  | CommandRejectedMessage

export interface ReconnectHello {
  type: 'session.resume'
  roomId: string
  sessionToken: string
  lastSeenRevision: number
}

export interface GameCommandMessage {
  type: 'game.command'
  command: ClientGameCommand
}

export interface LobbyCommandMessage {
  type: 'lobby.command'
  command: ClientLobbyCommand
}

export type ClientTransportMessage =
  | ReconnectHello
  | GameCommandMessage
  | LobbyCommandMessage

export interface SessionReadyMessage {
  type: 'session.ready'
  roomId: string
  playerId: number
  revision: number
  caughtUp: boolean
}

export interface SessionRejectedMessage {
  type: 'session.rejected'
  code: 'room_not_found' | 'invalid_session' | 'session_mismatch'
  message: string
}

export type ServerTransportMessage =
  | ServerGameMessage
  | SessionReadyMessage
  | SessionRejectedMessage

// Prevent protocol drift when claim kinds change.
const _claimKinds: ClaimKind[] = [
  'role',
  'information',
  'action',
  'accusation',
  'defense',
]
void _claimKinds
