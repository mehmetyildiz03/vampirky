import type { GameState } from '../game/types'
import type {
  ClientGameCommand,
  CommandAcceptedMessage,
  CommandRejectedMessage,
  SnapshotMessage,
} from './protocol'
import { AuthoritativeRoom } from './roomRuntime'
import type { ViewerGameSnapshot } from './snapshot'

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

interface SessionRecord {
  token: string
  playerId: number
  acceptedRequests: Map<string, CommandAcceptedMessage>
}

interface RoomRecord {
  roomId: string
  runtime: AuthoritativeRoom
  playerIds: Set<number>
  sessionsByToken: Map<string, SessionRecord>
  tokenByPlayerId: Map<number, string>
}

export interface ClaimedSession {
  roomId: string
  playerId: number
  sessionToken: string
  revision: number
  snapshot: ViewerGameSnapshot
}

export interface ResumedSession {
  roomId: string
  playerId: number
  sessionToken: string
  revision: number
  caughtUp: boolean
  snapshot: ViewerGameSnapshot
}

export interface SessionBroadcast {
  sessionToken: string
  playerId: number
  message: SnapshotMessage
}

export interface SessionDispatchResult {
  response: CommandAcceptedMessage | CommandRejectedMessage
  snapshot: ViewerGameSnapshot
  mutated: boolean
  broadcasts: SessionBroadcast[]
}

function secureToken(): string {
  return `${crypto.randomUUID().replaceAll('-', '')}${crypto.randomUUID().replaceAll('-', '')}`
}

function secureRoomCode(): string {
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => ROOM_ALPHABET[byte % ROOM_ALPHABET.length]).join('')
}

function normalizeRoomId(roomId: string): string {
  return roomId.trim().toUpperCase()
}

export class RoomSessionService {
  private rooms = new Map<string, RoomRecord>()
  private roomIdBySessionToken = new Map<string, string>()

  createRoom(
    initialState: GameState,
    hostPlayerId: number,
    requestedRoomId?: string,
  ): ClaimedSession {
    if (!initialState.players.some((player) => player.id === hostPlayerId)) {
      throw new Error('Host player is not part of the game.')
    }

    let roomId = requestedRoomId ? normalizeRoomId(requestedRoomId) : secureRoomCode()
    if (!roomId) throw new Error('Room id cannot be empty.')

    if (!requestedRoomId) {
      while (this.rooms.has(roomId)) roomId = secureRoomCode()
    } else if (this.rooms.has(roomId)) {
      throw new Error('Room id is already in use.')
    }

    const room: RoomRecord = {
      roomId,
      runtime: new AuthoritativeRoom(structuredClone(initialState)),
      playerIds: new Set(initialState.players.map((player) => player.id)),
      sessionsByToken: new Map(),
      tokenByPlayerId: new Map(),
    }
    this.rooms.set(roomId, room)

    return this.claimSeat(roomId, hostPlayerId)
  }

  claimSeat(roomIdInput: string, playerId: number): ClaimedSession {
    const room = this.requireRoom(roomIdInput)
    if (!room.playerIds.has(playerId)) {
      throw new Error('Player is not a member of this room.')
    }
    if (room.tokenByPlayerId.has(playerId)) {
      throw new Error('This player seat already has a session.')
    }

    const token = secureToken()
    const session: SessionRecord = {
      token,
      playerId,
      acceptedRequests: new Map(),
    }

    room.sessionsByToken.set(token, session)
    room.tokenByPlayerId.set(playerId, token)
    this.roomIdBySessionToken.set(token, room.roomId)

    return {
      roomId: room.roomId,
      playerId,
      sessionToken: token,
      revision: room.runtime.getRevision(),
      snapshot: room.runtime.snapshotFor(playerId),
    }
  }

  resumeSession(
    roomIdInput: string,
    sessionToken: string,
    lastSeenRevision: number,
  ): ResumedSession {
    const room = this.requireRoom(roomIdInput)
    const session = room.sessionsByToken.get(sessionToken)
    if (!session) throw new Error('Invalid session token for this room.')

    const revision = room.runtime.getRevision()
    if (lastSeenRevision > revision) {
      throw new Error('Client revision is ahead of the authoritative room.')
    }

    return {
      roomId: room.roomId,
      playerId: session.playerId,
      sessionToken,
      revision,
      caughtUp: lastSeenRevision === revision,
      snapshot: room.runtime.snapshotFor(session.playerId),
    }
  }

  dispatch(
    sessionToken: string,
    command: ClientGameCommand,
  ): SessionDispatchResult {
    const { room, session } = this.requireSession(sessionToken)

    const previousAcceptance = session.acceptedRequests.get(command.requestId)
    if (previousAcceptance) {
      return {
        response: previousAcceptance,
        snapshot: room.runtime.snapshotFor(session.playerId),
        mutated: false,
        broadcasts: [],
      }
    }

    const result = room.runtime.dispatch(session.playerId, command)

    if (result.response.type === 'command.accepted') {
      session.acceptedRequests.set(command.requestId, result.response)
      return {
        response: result.response,
        snapshot: result.snapshot,
        mutated: true,
        broadcasts: this.broadcastsForRoom(room),
      }
    }

    return {
      response: result.response,
      snapshot: result.snapshot,
      mutated: false,
      broadcasts: [],
    }
  }

  snapshotForSession(sessionToken: string): ViewerGameSnapshot {
    const { room, session } = this.requireSession(sessionToken)
    return room.runtime.snapshotFor(session.playerId)
  }

  roomIdForSession(sessionToken: string): string | null {
    return this.roomIdBySessionToken.get(sessionToken) ?? null
  }

  private broadcastsForRoom(room: RoomRecord): SessionBroadcast[] {
    const revision = room.runtime.getRevision()
    return [...room.sessionsByToken.values()].map((session) => ({
      sessionToken: session.token,
      playerId: session.playerId,
      message: {
        type: 'game.snapshot',
        revision,
        snapshot: room.runtime.snapshotFor(session.playerId),
      },
    }))
  }

  private requireRoom(roomIdInput: string): RoomRecord {
    const roomId = normalizeRoomId(roomIdInput)
    const room = this.rooms.get(roomId)
    if (!room) throw new Error('Room not found.')
    return room
  }

  private requireSession(sessionToken: string): {
    room: RoomRecord
    session: SessionRecord
  } {
    const roomId = this.roomIdBySessionToken.get(sessionToken)
    if (!roomId) throw new Error('Invalid session token.')

    const room = this.rooms.get(roomId)
    const session = room?.sessionsByToken.get(sessionToken)
    if (!room || !session) throw new Error('Invalid session token.')

    return { room, session }
  }
}
