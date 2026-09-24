import { createGame } from '../game/engine'
import type { GameState, PlayerSeed } from '../game/types'
import type {
  ClientGameCommand,
  ClientLobbyCommand,
  CommandAcceptedMessage,
  CommandRejectedMessage,
  LobbySnapshot,
  LobbySnapshotMessage,
  RoomSnapshotMessage,
} from './protocol'
import { AuthoritativeRoom } from './roomRuntime'
import type { ViewerGameSnapshot } from './snapshot'

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const MIN_PLAYERS = 6
const MAX_PLAYERS = 12
const MAX_NAME_LENGTH = 20

interface SessionRecord {
  token: string
  playerId: number
  acceptedRequests: Map<string, CommandAcceptedMessage>
}

interface LobbyPlayerRecord {
  id: number
  name: string
  ready: boolean
  connected: boolean
}

interface LobbyRecord {
  hostPlayerId: number
  nextPlayerId: number
  revision: number
  players: LobbyPlayerRecord[]
}

interface RoomRecord {
  roomId: string
  runtime: AuthoritativeRoom | null
  lobby: LobbyRecord | null
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

export interface LobbySessionBootstrap {
  roomId: string
  playerId: number
  sessionToken: string
  revision: number
  snapshot: LobbySnapshot
}

export interface ResumedSession {
  roomId: string
  playerId: number
  sessionToken: string
  revision: number
  caughtUp: boolean
  message: RoomSnapshotMessage
}

export interface SessionBroadcast {
  sessionToken: string
  playerId: number
  message: RoomSnapshotMessage
}

export interface SessionDispatchResult {
  response: CommandAcceptedMessage | CommandRejectedMessage
  message: RoomSnapshotMessage
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

function normalizeName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, ' ')
  if (!trimmed) throw new Error('Player name cannot be empty.')
  if (trimmed.length > MAX_NAME_LENGTH) {
    throw new Error(`Player name cannot exceed ${MAX_NAME_LENGTH} characters.`)
  }
  return trimmed
}

function currentRevision(room: RoomRecord): number {
  return room.runtime?.getRevision() ?? room.lobby?.revision ?? 0
}

export class RoomSessionService {
  private rooms = new Map<string, RoomRecord>()
  private roomIdBySessionToken = new Map<string, string>()

  /**
   * Legacy/active-game bootstrap retained for engine and transport tests.
   * Real product rooms should start with createLobby().
   */
  createRoom(
    initialState: GameState,
    hostPlayerId: number,
    requestedRoomId?: string,
  ): ClaimedSession {
    if (!initialState.players.some((player) => player.id === hostPlayerId)) {
      throw new Error('Host player is not part of the game.')
    }

    const roomId = this.reserveRoomId(requestedRoomId)
    const room: RoomRecord = {
      roomId,
      runtime: new AuthoritativeRoom(structuredClone(initialState), 0, hostPlayerId),
      lobby: null,
      playerIds: new Set(initialState.players.map((player) => player.id)),
      sessionsByToken: new Map(),
      tokenByPlayerId: new Map(),
    }
    this.rooms.set(roomId, room)

    return this.claimSeat(roomId, hostPlayerId)
  }

  createLobby(
    hostNameInput: string,
    requestedRoomId?: string,
  ): LobbySessionBootstrap {
    const roomId = this.reserveRoomId(requestedRoomId)
    const hostName = normalizeName(hostNameInput)
    const hostPlayerId = 1
    const lobby: LobbyRecord = {
      hostPlayerId,
      nextPlayerId: 2,
      revision: 0,
      players: [{
        id: hostPlayerId,
        name: hostName,
        ready: false,
        connected: false,
      }],
    }
    const room: RoomRecord = {
      roomId,
      runtime: null,
      lobby,
      playerIds: new Set([hostPlayerId]),
      sessionsByToken: new Map(),
      tokenByPlayerId: new Map(),
    }
    this.rooms.set(roomId, room)
    const session = this.createSession(room, hostPlayerId)

    return {
      roomId,
      playerId: hostPlayerId,
      sessionToken: session.token,
      revision: lobby.revision,
      snapshot: this.lobbySnapshot(room),
    }
  }

  joinLobby(roomIdInput: string, playerNameInput: string): LobbySessionBootstrap {
    const room = this.requireRoom(roomIdInput)
    const lobby = this.requireLobby(room)
    if (lobby.players.length >= MAX_PLAYERS) throw new Error('Lobby is full.')

    const playerName = normalizeName(playerNameInput)
    const normalized = playerName.toLocaleLowerCase('tr-TR')
    if (
      lobby.players.some(
        (player) => player.name.toLocaleLowerCase('tr-TR') === normalized,
      )
    ) {
      throw new Error('Player name is already in use in this lobby.')
    }

    const playerId = lobby.nextPlayerId
    lobby.nextPlayerId += 1
    lobby.players.push({
      id: playerId,
      name: playerName,
      ready: false,
      connected: false,
    })
    lobby.revision += 1
    room.playerIds.add(playerId)
    const session = this.createSession(room, playerId)

    return {
      roomId: room.roomId,
      playerId,
      sessionToken: session.token,
      revision: lobby.revision,
      snapshot: this.lobbySnapshot(room),
    }
  }

  claimSeat(roomIdInput: string, playerId: number): ClaimedSession {
    const room = this.requireRoom(roomIdInput)
    if (!room.runtime) throw new Error('Seat claiming is only available after game bootstrap.')
    if (!room.playerIds.has(playerId)) {
      throw new Error('Player is not a member of this room.')
    }
    if (room.tokenByPlayerId.has(playerId)) {
      throw new Error('This player seat already has a session.')
    }

    const session = this.createSession(room, playerId)
    return {
      roomId: room.roomId,
      playerId,
      sessionToken: session.token,
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

    const revision = currentRevision(room)
    if (lastSeenRevision > revision) {
      throw new Error('Client revision is ahead of the authoritative room.')
    }

    return {
      roomId: room.roomId,
      playerId: session.playerId,
      sessionToken,
      revision,
      caughtUp: lastSeenRevision === revision,
      message: this.messageForRoomPlayer(room, session.playerId),
    }
  }

  dispatch(
    sessionToken: string,
    command: ClientGameCommand,
  ): {
    response: CommandAcceptedMessage | CommandRejectedMessage
    snapshot: ViewerGameSnapshot
    mutated: boolean
    broadcasts: SessionBroadcast[]
  } {
    const result = this.dispatchGame(sessionToken, command)
    if (result.message.type !== 'game.snapshot') {
      throw new Error('Game snapshot expected.')
    }
    return {
      response: result.response,
      snapshot: result.message.snapshot,
      mutated: result.mutated,
      broadcasts: result.broadcasts,
    }
  }

  dispatchGame(
    sessionToken: string,
    command: ClientGameCommand,
  ): SessionDispatchResult {
    const { room, session } = this.requireSession(sessionToken)
    if (!room.runtime) {
      return this.rejectRoomCommand(
        room,
        session,
        command.requestId,
        'invalid_phase',
        'Game commands are unavailable while the room is in the lobby.',
      )
    }

    const duplicate = session.acceptedRequests.get(command.requestId)
    if (duplicate) {
      return {
        response: duplicate,
        message: this.messageForRoomPlayer(room, session.playerId),
        mutated: false,
        broadcasts: [],
      }
    }

    const result = room.runtime.dispatch(session.playerId, command)
    if (result.response.type === 'command.accepted') {
      session.acceptedRequests.set(command.requestId, result.response)
      return {
        response: result.response,
        message: this.messageForRoomPlayer(room, session.playerId),
        mutated: true,
        broadcasts: this.broadcastsForRoom(room),
      }
    }

    return {
      response: result.response,
      message: this.messageForRoomPlayer(room, session.playerId),
      mutated: false,
      broadcasts: [],
    }
  }

  dispatchLobby(
    sessionToken: string,
    command: ClientLobbyCommand,
  ): SessionDispatchResult {
    const { room, session } = this.requireSession(sessionToken)
    const lobby = room.lobby
    if (!lobby || room.runtime) {
      return this.rejectRoomCommand(
        room,
        session,
        command.requestId,
        'invalid_phase',
        'Lobby commands are unavailable after the game starts.',
      )
    }

    const duplicate = session.acceptedRequests.get(command.requestId)
    if (duplicate) {
      return {
        response: duplicate,
        message: this.messageForRoomPlayer(room, session.playerId),
        mutated: false,
        broadcasts: [],
      }
    }

    if (command.baseRevision > lobby.revision) {
      return this.rejectRoomCommand(
        room,
        session,
        command.requestId,
        'stale_revision',
        'Client revision is ahead of the authoritative lobby.',
      )
    }

    if (command.type === 'lobby.ready') {
      const player = lobby.players.find((candidate) => candidate.id === session.playerId)!
      player.ready = command.ready
      lobby.revision += 1
      const accepted = this.accept(command.requestId, lobby.revision)
      session.acceptedRequests.set(command.requestId, accepted)
      return {
        response: accepted,
        message: this.messageForRoomPlayer(room, session.playerId),
        mutated: true,
        broadcasts: this.broadcastsForRoom(room),
      }
    }

    if (session.playerId !== lobby.hostPlayerId) {
      return this.rejectRoomCommand(
        room,
        session,
        command.requestId,
        'not_authorized',
        'Only the host can start the game.',
      )
    }
    if (lobby.players.length < MIN_PLAYERS) {
      return this.rejectRoomCommand(
        room,
        session,
        command.requestId,
        'invalid_payload',
        `At least ${MIN_PLAYERS} players are required to start.`,
      )
    }
    if (lobby.players.some((player) => !player.ready)) {
      return this.rejectRoomCommand(
        room,
        session,
        command.requestId,
        'invalid_payload',
        'Every player must be ready before the host starts the game.',
      )
    }

    const startRevision = lobby.revision + 1
    const seeds: PlayerSeed[] = lobby.players.map(({ id, name }) => ({ id, name }))
    room.runtime = new AuthoritativeRoom(
      createGame(seeds),
      startRevision,
      lobby.hostPlayerId,
    )
    room.lobby = null
    const accepted = this.accept(command.requestId, startRevision)
    session.acceptedRequests.set(command.requestId, accepted)

    return {
      response: accepted,
      message: this.messageForRoomPlayer(room, session.playerId),
      mutated: true,
      broadcasts: this.broadcastsForRoom(room),
    }
  }

  setSessionConnected(
    sessionToken: string,
    connected: boolean,
  ): SessionBroadcast[] {
    const { room, session } = this.requireSession(sessionToken)
    if (!room.lobby) return []

    const player = room.lobby.players.find(
      (candidate) => candidate.id === session.playerId,
    )
    if (!player || player.connected === connected) return []
    player.connected = connected
    return this.broadcastsForRoom(room)
  }

  snapshotForSession(sessionToken: string): ViewerGameSnapshot {
    const { room, session } = this.requireSession(sessionToken)
    if (!room.runtime) throw new Error('Game has not started.')
    return room.runtime.snapshotFor(session.playerId)
  }

  messageForSession(sessionToken: string): RoomSnapshotMessage {
    const { room, session } = this.requireSession(sessionToken)
    return this.messageForRoomPlayer(room, session.playerId)
  }

  broadcastsForRoomId(roomIdInput: string): SessionBroadcast[] {
    return this.broadcastsForRoom(this.requireRoom(roomIdInput))
  }

  tick(now = Date.now()): SessionBroadcast[] {
    const broadcasts: SessionBroadcast[] = []
    for (const room of this.rooms.values()) {
      if (room.runtime?.advanceExpired(now)) {
        broadcasts.push(...this.broadcastsForRoom(room))
      }
    }
    return broadcasts
  }

  roomIdForSession(sessionToken: string): string | null {
    return this.roomIdBySessionToken.get(sessionToken) ?? null
  }

  private lobbySnapshot(room: RoomRecord): LobbySnapshot {
    const lobby = this.requireLobby(room)
    const canStart =
      lobby.players.length >= MIN_PLAYERS &&
      lobby.players.every((player) => player.ready)

    return {
      roomId: room.roomId,
      revision: lobby.revision,
      phase: 'lobby',
      hostPlayerId: lobby.hostPlayerId,
      minPlayers: MIN_PLAYERS,
      maxPlayers: MAX_PLAYERS,
      canStart,
      players: lobby.players.map((player) => ({
        id: player.id,
        name: player.name,
        ready: player.ready,
        connected: player.connected,
        isHost: player.id === lobby.hostPlayerId,
      })),
    }
  }

  private messageForRoomPlayer(
    room: RoomRecord,
    playerId: number,
  ): RoomSnapshotMessage {
    if (room.runtime) {
      const revision = room.runtime.getRevision()
      return {
        type: 'game.snapshot',
        revision,
        snapshot: room.runtime.snapshotFor(playerId),
      }
    }

    const snapshot = this.lobbySnapshot(room)
    const message: LobbySnapshotMessage = {
      type: 'lobby.snapshot',
      revision: snapshot.revision,
      snapshot,
    }
    return message
  }

  private broadcastsForRoom(room: RoomRecord): SessionBroadcast[] {
    return [...room.sessionsByToken.values()].map((session) => ({
      sessionToken: session.token,
      playerId: session.playerId,
      message: this.messageForRoomPlayer(room, session.playerId),
    }))
  }

  private accept(
    requestId: string,
    revision: number,
  ): CommandAcceptedMessage {
    return {
      type: 'command.accepted',
      requestId,
      revision,
    }
  }

  private rejectRoomCommand(
    room: RoomRecord,
    session: SessionRecord,
    requestId: string,
    code: CommandRejectedMessage['code'],
    message: string,
  ): SessionDispatchResult {
    return {
      response: {
        type: 'command.rejected',
        requestId,
        code,
        message,
        revision: currentRevision(room),
      },
      message: this.messageForRoomPlayer(room, session.playerId),
      mutated: false,
      broadcasts: [],
    }
  }

  private createSession(
    room: RoomRecord,
    playerId: number,
  ): SessionRecord {
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
    return session
  }

  private reserveRoomId(requestedRoomId?: string): string {
    let roomId = requestedRoomId
      ? normalizeRoomId(requestedRoomId)
      : secureRoomCode()
    if (!roomId) throw new Error('Room id cannot be empty.')

    if (!requestedRoomId) {
      while (this.rooms.has(roomId)) roomId = secureRoomCode()
    } else if (this.rooms.has(roomId)) {
      throw new Error('Room id is already in use.')
    }
    return roomId
  }

  private requireLobby(room: RoomRecord): LobbyRecord {
    if (!room.lobby || room.runtime) throw new Error('Room is not in lobby phase.')
    return room.lobby
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
