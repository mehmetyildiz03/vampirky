export type RoleId = 'vampire' | 'villager' | 'seer' | 'protector'

export type Faction = 'vampire' | 'village'
export type GamePhase =
  | 'lobby'
  | 'role_reveal'
  | 'night'
  | 'dawn'
  | 'discussion'
  | 'voting'
  | 'resolution'
  | 'ended'

export type Winner = Faction | null

export interface PlayerSeed {
  id: number
  name: string
}

export interface GamePlayer extends PlayerSeed {
  alive: boolean
  secretRole: RoleId
}

export interface PublicPlayer extends PlayerSeed {
  alive: boolean
}

export interface RoleClaim {
  id: number
  claimantId: number
  role: RoleId
  quote?: string
  round: number
}

export type NightActionType = 'attack' | 'protect' | 'investigate'

export interface NightAction {
  actorId: number
  targetId: number
  type: NightActionType
}

export interface SeerIntel {
  round: number
  targetId: number
  isVampire: boolean
}

export interface NightResolution {
  round: number
  attackedId: number | null
  victimId: number | null
  protectedIds: number[]
}

export interface VoteResolution {
  round: number
  eliminatedId: number | null
  tied: boolean
}

export interface GameEvent {
  id: number
  round: number
  type: 'night' | 'day' | 'system'
  text: string
}

export interface GameState {
  id: string
  phase: GamePhase
  round: number
  players: GamePlayer[]
  claims: RoleClaim[]
  nightActions: NightAction[]
  dayVotes: Record<number, number>
  privateIntel: Record<number, SeerIntel[]>
  lastNight: NightResolution | null
  lastVote: VoteResolution | null
  winner: Winner
  nextClaimId: number
  nextEventId: number
  events: GameEvent[]
}

export interface PrivatePlayerView {
  publicPlayers: PublicPlayer[]
  selfRole: RoleId
  knownVampireIds: number[]
  intel: SeerIntel[]
  phase: GamePhase
  round: number
  winner: Winner
}
