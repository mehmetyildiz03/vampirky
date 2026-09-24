import { createGame } from '../game/engine'
import {
  addPrivateGeneralNote,
  addPrivatePlayerNote,
  createPrivateDeductionState,
  removePrivateGeneralNote,
  removePrivatePlayerNote,
  setDeductionMark,
  type PrivateDeductionState,
} from '../game/deduction'
import {
  PHASE_DURATIONS_SECONDS,
  isValidPhaseDuration,
  type PhaseDurations,
} from '../game/timing'
import type { GameState, PlayerSeed } from '../game/types'
import type {
  ClientGameCommand,
  ClientLobbyCommand,
  ClientPrivateCommand,
  CommandAcceptedMessage,
  CommandRejectedMessage,
  LobbySnapshot,
  LobbySnapshotMessage,
  RoomSnapshotMessage,
} from './protocol'
import {
  ROOM_PERSISTENCE_VERSION,
  type PersistedRoomSessionService,
} from './persistence'
import { AuthoritativeRoom } from './roomRuntime'
import type {
  ViewerGameSnapshot,
  ViewerPrivateDeductionSnapshot,
} from './snapshot'

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const MIN_PLAYERS = 6
const MAX_PLAYERS = 12
const MAX_NAME_LENGTH = 20

export interface RoomLifecycleConfig {
  reconnectGraceMs: number
  emptyLobbyTtlMs: number
  abandonedGameTtlMs: number
  finishedGameTtlMs: number
}

export const DEFAULT_ROOM_LIFECYCLE: RoomLifecycleConfig = {
  reconnectGraceMs: 2 * 60 * 1000,
  emptyLobbyTtlMs: 15 * 60 * 1000,
  abandonedGameTtlMs: 60 * 60 * 1000,
  finishedGameTtlMs: 30 * 60 * 1000,
}

interface SessionRecord {
  token: string
  playerId: number
  acceptedRequests: Map<string, CommandAcceptedMessage>
  privateDeduction: PrivateDeductionState | null
  connected: boolean
  disconnectedAt: number | null
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
  settingsRevision: number
  phaseDurations: PhaseDurations
  players: LobbyPlayerRecord[]
}

interface RoomRecord {
  roomId: string
  runtime: AuthoritativeRoom | null
  lobby: LobbyRecord | null
  playerIds: Set<number>
  sessionsByToken: Map<string, SessionRecord>
  tokenByPlayerId: Map<number, string>
  createdAt: number
  lastActivityAt: number
  allDisconnectedSince: number | null
  endedAt: number | null
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

export interface SessionTickResult {
  broadcasts: SessionBroadcast[]
  expiredSessionTokens: string[]
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
  private readonly lifecycle: RoomLifecycleConfig
  private persistenceListener:
    | ((state: PersistedRoomSessionService) => void)
    | null = null

  constructor(lifecycle: Partial<RoomLifecycleConfig> = {}) {
    this.lifecycle = {
      ...DEFAULT_ROOM_LIFECYCLE,
      ...lifecycle,
    }
    for (const [key, value] of Object.entries(this.lifecycle)) {
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(`Invalid room lifecycle value for ${key}.`)
      }
    }
  }

  setPersistenceListener(
    listener: ((state: PersistedRoomSessionService) => void) | null,
  ): void {
    this.persistenceListener = listener
  }

  exportPersistedState(): PersistedRoomSessionService {
    return {
      version: ROOM_PERSISTENCE_VERSION,
      savedAt: new Date().toISOString(),
      rooms: [...this.rooms.values()].map((room) => ({
        roomId: room.roomId,
        createdAt: room.createdAt,
        lastActivityAt: room.lastActivityAt,
        endedAt: room.endedAt,
        runtime: room.runtime?.exportPersistedState() ?? null,
        lobby: room.lobby
          ? {
              hostPlayerId: room.lobby.hostPlayerId,
              nextPlayerId: room.lobby.nextPlayerId,
              revision: room.lobby.revision,
              settingsRevision: room.lobby.settingsRevision,
              phaseDurations: { ...room.lobby.phaseDurations },
              players: room.lobby.players.map((player) => ({
                id: player.id,
                name: player.name,
                ready: player.ready,
              })),
            }
          : null,
        playerIds: [...room.playerIds],
        sessions: [...room.sessionsByToken.values()].map((session) => ({
          token: session.token,
          playerId: session.playerId,
          acceptedRequests: [...session.acceptedRequests.values()].map(
            (accepted) => ({ ...accepted }),
          ),
          privateDeduction: session.privateDeduction
            ? structuredClone(session.privateDeduction)
            : null,
        })),
      })),
    }
  }

  restorePersistedState(state: PersistedRoomSessionService): void {
    if (state.version !== ROOM_PERSISTENCE_VERSION) {
      throw new Error(
        `Unsupported room persistence version: ${String(state.version)}.`,
      )
    }

    const rooms = new Map<string, RoomRecord>()
    const roomIdBySessionToken = new Map<string, string>()

    for (const persistedRoom of state.rooms) {
      const roomId = normalizeRoomId(persistedRoom.roomId)
      if (!roomId || rooms.has(roomId)) {
        throw new Error('Persisted state contains an invalid or duplicate room id.')
      }

      const playerIds = new Set(persistedRoom.playerIds)
      const sessionsByToken = new Map<string, SessionRecord>()
      const tokenByPlayerId = new Map<number, string>()

      for (const persistedSession of persistedRoom.sessions) {
        if (!playerIds.has(persistedSession.playerId)) {
          throw new Error('Persisted session references an unknown player.')
        }
        if (sessionsByToken.has(persistedSession.token)) {
          throw new Error('Persisted room contains a duplicate session token.')
        }
        if (tokenByPlayerId.has(persistedSession.playerId)) {
          throw new Error('Persisted room contains duplicate player sessions.')
        }
        if (roomIdBySessionToken.has(persistedSession.token)) {
          throw new Error('Persisted state reuses a session token across rooms.')
        }

        const acceptedRequests = new Map<string, CommandAcceptedMessage>()
        for (const accepted of persistedSession.acceptedRequests) {
          if (acceptedRequests.has(accepted.requestId)) {
            throw new Error('Persisted session contains duplicate request ids.')
          }
          acceptedRequests.set(accepted.requestId, { ...accepted })
        }

        const session: SessionRecord = {
          token: persistedSession.token,
          playerId: persistedSession.playerId,
          acceptedRequests,
          privateDeduction: persistedSession.privateDeduction
            ? structuredClone(persistedSession.privateDeduction)
            : null,
          connected: false,
          disconnectedAt: Date.now(),
        }
        sessionsByToken.set(session.token, session)
        tokenByPlayerId.set(session.playerId, session.token)
        roomIdBySessionToken.set(session.token, roomId)
      }

      const lobby: LobbyRecord | null = persistedRoom.lobby
        ? {
            hostPlayerId: persistedRoom.lobby.hostPlayerId,
            nextPlayerId: persistedRoom.lobby.nextPlayerId,
            revision: persistedRoom.lobby.revision,
            settingsRevision: persistedRoom.lobby.settingsRevision,
            phaseDurations: { ...persistedRoom.lobby.phaseDurations },
            players: persistedRoom.lobby.players.map((player) => ({
              ...player,
              connected: false,
            })),
          }
        : null
      const runtime = persistedRoom.runtime
        ? AuthoritativeRoom.restore(persistedRoom.runtime)
        : null

      if (Boolean(runtime) === Boolean(lobby)) {
        throw new Error(
          'Persisted room must contain exactly one lobby or active runtime.',
        )
      }

      const restoredAt = Date.now()
      const savedAt = Number.isFinite(Date.parse(state.savedAt))
        ? Date.parse(state.savedAt)
        : restoredAt
      rooms.set(roomId, {
        roomId,
        runtime,
        lobby,
        playerIds,
        sessionsByToken,
        tokenByPlayerId,
        createdAt: persistedRoom.createdAt ?? savedAt,
        lastActivityAt: persistedRoom.lastActivityAt ?? savedAt,
        allDisconnectedSince: restoredAt,
        endedAt:
          persistedRoom.endedAt ??
          (runtime?.getPhase() === 'ended' ? savedAt : null),
      })
    }

    this.rooms = rooms
    this.roomIdBySessionToken = roomIdBySessionToken
  }

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
    const createdAt = Date.now()
    const room: RoomRecord = {
      roomId,
      runtime: new AuthoritativeRoom(structuredClone(initialState), 0, hostPlayerId),
      lobby: null,
      playerIds: new Set(initialState.players.map((player) => player.id)),
      sessionsByToken: new Map(),
      tokenByPlayerId: new Map(),
      createdAt,
      lastActivityAt: createdAt,
      allDisconnectedSince: createdAt,
      endedAt: initialState.phase === 'ended' ? createdAt : null,
    }
    this.rooms.set(roomId, room)

    return this.claimSeat(roomId, hostPlayerId)
  }

  createLobby(
    hostNameInput: string,
    requestedRoomId?: string,
  ): LobbySessionBootstrap {
    const roomId = this.reserveRoomId(requestedRoomId)
    const createdAt = Date.now()
    const hostName = normalizeName(hostNameInput)
    const hostPlayerId = 1
    const lobby: LobbyRecord = {
      hostPlayerId,
      nextPlayerId: 2,
      revision: 0,
      settingsRevision: 0,
      phaseDurations: { ...PHASE_DURATIONS_SECONDS },
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
      createdAt,
      lastActivityAt: createdAt,
      allDisconnectedSince: createdAt,
      endedAt: null,
    }
    this.rooms.set(roomId, room)
    const session = this.createSession(room, hostPlayerId)
    this.notifyPersistentChange()

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
    this.markRoomActivity(room)
    if (!this.hasConnectedSessions(room)) room.allDisconnectedSince = Date.now()
    this.notifyPersistentChange()

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
    this.markRoomActivity(room)
    if (!this.hasConnectedSessions(room)) room.allDisconnectedSince = Date.now()
    this.notifyPersistentChange()
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
      this.markRoomActivity(room)
      this.captureEndedAt(room)
      this.notifyPersistentChange()
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
      if (command.baseRevision < lobby.settingsRevision) {
        return this.rejectRoomCommand(
          room,
          session,
          command.requestId,
          'stale_revision',
          'Lobby settings changed. Confirm readiness again from the latest snapshot.',
        )
      }
      const player = lobby.players.find((candidate) => candidate.id === session.playerId)!
      player.ready = command.ready
      lobby.revision += 1
      const accepted = this.accept(command.requestId, lobby.revision)
      session.acceptedRequests.set(command.requestId, accepted)
      this.markRoomActivity(room)
      this.notifyPersistentChange()
      return {
        response: accepted,
        message: this.messageForRoomPlayer(room, session.playerId),
        mutated: true,
        broadcasts: this.broadcastsForRoom(room),
      }
    }

    if (command.type === 'lobby.duration') {
      if (session.playerId !== lobby.hostPlayerId) {
        return this.rejectRoomCommand(
          room,
          session,
          command.requestId,
          'not_authorized',
          'Only the host can change lobby timing.',
        )
      }
      if (!isValidPhaseDuration(command.key, command.seconds)) {
        return this.rejectRoomCommand(
          room,
          session,
          command.requestId,
          'invalid_payload',
          'Invalid phase duration.',
        )
      }

      lobby.phaseDurations = {
        ...lobby.phaseDurations,
        [command.key]: command.seconds,
      }
      lobby.players = lobby.players.map((player) => ({
        ...player,
        ready: false,
      }))
      lobby.revision += 1
      lobby.settingsRevision = lobby.revision
      const accepted = this.accept(command.requestId, lobby.revision)
      session.acceptedRequests.set(command.requestId, accepted)
      this.markRoomActivity(room)
      this.notifyPersistentChange()
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
      Date.now(),
      lobby.phaseDurations,
    )
    for (const roomSession of room.sessionsByToken.values()) {
      roomSession.privateDeduction = createPrivateDeductionState(
        roomSession.playerId,
        seeds.map((seed) => seed.id),
      )
    }
    room.lobby = null
    room.endedAt = null
    const accepted = this.accept(command.requestId, startRevision)
    session.acceptedRequests.set(command.requestId, accepted)
    this.markRoomActivity(room)
    this.captureEndedAt(room)
    this.notifyPersistentChange()

    return {
      response: accepted,
      message: this.messageForRoomPlayer(room, session.playerId),
      mutated: true,
      broadcasts: this.broadcastsForRoom(room),
    }
  }

  dispatchPrivate(
    sessionToken: string,
    command: ClientPrivateCommand,
  ): SessionDispatchResult {
    const { room, session } = this.requireSession(sessionToken)
    if (!room.runtime || !session.privateDeduction) {
      return this.rejectRoomCommand(
        room,
        session,
        command.requestId,
        'invalid_phase',
        'Private deductions are available only during an active game.',
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

    if (command.baseRevision > currentRevision(room)) {
      return this.rejectRoomCommand(
        room,
        session,
        command.requestId,
        'stale_revision',
        'Client revision is ahead of the authoritative room.',
      )
    }

    const playerIds = room.playerIds
    if (
      'targetId' in command &&
      (!playerIds.has(command.targetId) || command.targetId === session.playerId)
    ) {
      return this.rejectRoomCommand(
        room,
        session,
        command.requestId,
        'invalid_target',
        'Invalid private deduction target.',
      )
    }

    if (command.type === 'deduction.mark') {
      session.privateDeduction = setDeductionMark(
        session.privateDeduction,
        command.targetId,
        command.mark,
      )
    } else if (command.type === 'deduction.note.add') {
      const normalized = command.text.trim()
      if (!normalized || normalized.length > 220) {
        return this.rejectRoomCommand(
          room,
          session,
          command.requestId,
          'invalid_payload',
          'Private notes must contain 1 to 220 characters.',
        )
      }
      session.privateDeduction = addPrivatePlayerNote(
        session.privateDeduction,
        command.targetId,
        room.runtime.snapshotFor(session.playerId).round,
        normalized,
      )
    } else if (command.type === 'deduction.note.remove') {
      session.privateDeduction = removePrivatePlayerNote(
        session.privateDeduction,
        command.targetId,
        command.noteId,
      )
    } else if (command.type === 'deduction.general.add') {
      const normalized = command.text.trim()
      if (!normalized || normalized.length > 240) {
        return this.rejectRoomCommand(
          room,
          session,
          command.requestId,
          'invalid_payload',
          'General private notes must contain 1 to 240 characters.',
        )
      }
      session.privateDeduction = addPrivateGeneralNote(
        session.privateDeduction,
        room.runtime.snapshotFor(session.playerId).round,
        normalized,
      )
    } else {
      session.privateDeduction = removePrivateGeneralNote(
        session.privateDeduction,
        command.noteId,
      )
    }

    const accepted = this.accept(command.requestId, currentRevision(room))
    session.acceptedRequests.set(command.requestId, accepted)
    this.notifyPersistentChange()
    return {
      response: accepted,
      message: this.messageForRoomPlayer(room, session.playerId),
      mutated: true,
      broadcasts: [{
        sessionToken: session.token,
        playerId: session.playerId,
        message: this.messageForRoomPlayer(room, session.playerId),
      }],
    }
  }

  setSessionConnected(
    sessionToken: string,
    connected: boolean,
    now = Date.now(),
  ): SessionBroadcast[] {
    const { room, session } = this.requireSession(sessionToken)
    if (session.connected === connected) return []

    session.connected = connected
    session.disconnectedAt = connected ? null : now
    room.lastActivityAt = now

    if (room.lobby) {
      const player = room.lobby.players.find(
        (candidate) => candidate.id === session.playerId,
      )
      if (player) player.connected = connected
    }

    if (this.hasConnectedSessions(room)) {
      room.allDisconnectedSince = null
    } else {
      room.allDisconnectedSince ??= now
    }

    this.notifyPersistentChange()
    return room.lobby ? this.broadcastsForRoom(room) : []
  }

  snapshotForSession(sessionToken: string): ViewerGameSnapshot {
    const { room, session } = this.requireSession(sessionToken)
    if (!room.runtime) throw new Error('Game has not started.')
    return this.withPrivateDeduction(
      room.runtime.snapshotFor(session.playerId),
      session.privateDeduction,
    )
  }

  messageForSession(sessionToken: string): RoomSnapshotMessage {
    const { room, session } = this.requireSession(sessionToken)
    return this.messageForRoomPlayer(room, session.playerId)
  }

  broadcastsForRoomId(roomIdInput: string): SessionBroadcast[] {
    return this.broadcastsForRoom(this.requireRoom(roomIdInput))
  }

  tick(now = Date.now()): SessionTickResult {
    const broadcasts: SessionBroadcast[] = []
    const expiredSessionTokens: string[] = []
    let changed = false

    for (const room of [...this.rooms.values()]) {
      if (room.runtime?.advanceExpired(now)) {
        changed = true
        this.markRoomActivity(room, now)
        this.captureEndedAt(room, now)
        broadcasts.push(...this.broadcastsForRoom(room))
      }

      if (room.lobby && this.evictExpiredLobbyGuests(room, now)) {
        changed = true
        broadcasts.push(...this.broadcastsForRoom(room))
      }

      if (this.shouldExpireRoom(room, now)) {
        changed = true
        expiredSessionTokens.push(...this.deleteRoom(room))
      }
    }

    if (changed) this.notifyPersistentChange()
    return { broadcasts, expiredSessionTokens }
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
      phaseDurations: { ...lobby.phaseDurations },
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
        snapshot: this.withPrivateDeduction(
          room.runtime.snapshotFor(playerId),
          room.sessionsByToken.get(room.tokenByPlayerId.get(playerId) ?? '')?.privateDeduction ?? null,
        ),
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
      privateDeduction: room.runtime
        ? createPrivateDeductionState(playerId, [...room.playerIds])
        : null,
      connected: false,
      disconnectedAt: Date.now(),
    }
    room.sessionsByToken.set(token, session)
    room.tokenByPlayerId.set(playerId, token)
    this.roomIdBySessionToken.set(token, room.roomId)
    return session
  }

  private withPrivateDeduction(
    snapshot: ViewerGameSnapshot,
    state: PrivateDeductionState | null,
  ): ViewerGameSnapshot {
    const privateDeduction: ViewerPrivateDeductionSnapshot = state
      ? {
          marks: { ...state.marks },
          notes: Object.fromEntries(
            Object.entries(state.notes).map(([playerId, notes]) => [
              Number(playerId),
              notes.map((note) => ({ ...note })),
            ]),
          ),
          generalNotes: state.generalNotes.map((note) => ({ ...note })),
        }
      : { marks: {}, notes: {}, generalNotes: [] }

    return {
      ...snapshot,
      privateDeduction,
    }
  }

  private markRoomActivity(room: RoomRecord, now = Date.now()): void {
    room.lastActivityAt = now
  }

  private captureEndedAt(room: RoomRecord, now = Date.now()): void {
    if (room.runtime?.getPhase() === 'ended') {
      room.endedAt ??= now
    }
  }

  private hasConnectedSessions(room: RoomRecord): boolean {
    return [...room.sessionsByToken.values()].some((session) => session.connected)
  }

  private evictExpiredLobbyGuests(room: RoomRecord, now: number): boolean {
    const lobby = room.lobby
    if (!lobby) return false

    const expired = [...room.sessionsByToken.values()].filter(
      (session) =>
        session.playerId !== lobby.hostPlayerId &&
        !session.connected &&
        session.disconnectedAt !== null &&
        now - session.disconnectedAt >= this.lifecycle.reconnectGraceMs,
    )
    if (expired.length === 0) return false

    const expiredIds = new Set(expired.map((session) => session.playerId))
    for (const session of expired) {
      room.sessionsByToken.delete(session.token)
      room.tokenByPlayerId.delete(session.playerId)
      room.playerIds.delete(session.playerId)
      this.roomIdBySessionToken.delete(session.token)
    }
    lobby.players = lobby.players.filter((player) => !expiredIds.has(player.id))
    lobby.revision += 1
    room.lastActivityAt = now
    return true
  }

  private shouldExpireRoom(room: RoomRecord, now: number): boolean {
    if (room.lobby) {
      return (
        room.allDisconnectedSince !== null &&
        now - room.allDisconnectedSince >= this.lifecycle.emptyLobbyTtlMs
      )
    }

    if (!room.runtime) return true
    if (room.runtime.getPhase() === 'ended') {
      const endedAt = room.endedAt ?? room.lastActivityAt
      return now - endedAt >= this.lifecycle.finishedGameTtlMs
    }

    return (
      room.allDisconnectedSince !== null &&
      now - room.allDisconnectedSince >= this.lifecycle.abandonedGameTtlMs
    )
  }

  private deleteRoom(room: RoomRecord): string[] {
    const tokens = [...room.sessionsByToken.keys()]
    for (const token of tokens) this.roomIdBySessionToken.delete(token)
    this.rooms.delete(room.roomId)
    return tokens
  }

  private notifyPersistentChange(): void {
    this.persistenceListener?.(this.exportPersistedState())
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
