import type { PrivateDeductionState } from '../game/deduction'
import type { PhaseDurations } from '../game/timing'
import type { GameState } from '../game/types'
import type { CommandAcceptedMessage } from './protocol'

export const ROOM_PERSISTENCE_VERSION = 1 as const

export interface PersistedAuthoritativeRoom {
  state: GameState
  revision: number
  hostPlayerId: number
  phaseReadyPlayerIds: number[]
  phaseDeadlineAt: number | null
  phaseDurationSeconds: number | null
  phaseDurations: PhaseDurations
}

export interface PersistedLobbyPlayer {
  id: number
  name: string
  ready: boolean
}

export interface PersistedLobby {
  hostPlayerId: number
  nextPlayerId: number
  revision: number
  settingsRevision: number
  phaseDurations: PhaseDurations
  players: PersistedLobbyPlayer[]
}

export interface PersistedSession {
  token: string
  playerId: number
  acceptedRequests: CommandAcceptedMessage[]
  privateDeduction: PrivateDeductionState | null
}

export interface PersistedRoom {
  roomId: string
  runtime: PersistedAuthoritativeRoom | null
  lobby: PersistedLobby | null
  playerIds: number[]
  sessions: PersistedSession[]
}

export interface PersistedRoomSessionService {
  version: typeof ROOM_PERSISTENCE_VERSION
  savedAt: string
  rooms: PersistedRoom[]
}
