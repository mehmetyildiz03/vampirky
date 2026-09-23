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

export type ClaimKind = 'role' | 'information' | 'action' | 'accusation' | 'defense'
export type ClaimStatus = 'active' | 'withdrawn'

export interface ClaimBase {
  id: number
  claimantId: number
  kind: ClaimKind
  round: number
  status: ClaimStatus
  quote?: string
}

export interface RoleClaim extends ClaimBase {
  kind: 'role'
  role: RoleId
}

export interface InformationClaim extends ClaimBase {
  kind: 'information'
  targetId: number
  statement: string
}

export interface ActionClaim extends ClaimBase {
  kind: 'action'
  targetId: number
  action: 'protected' | 'investigated' | 'visited'
}

export interface AccusationClaim extends ClaimBase {
  kind: 'accusation'
  targetId: number
  suspectedRole?: RoleId
}

export interface DefenseClaim extends ClaimBase {
  kind: 'defense'
  targetId: number
}

export type StructuredClaim =
  | RoleClaim
  | InformationClaim
  | ActionClaim
  | AccusationClaim
  | DefenseClaim

export interface RoleClaimGroup {
  role: RoleId
  claims: RoleClaim[]
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

export interface VoteRecord {
  round: number
  voterId: number
  targetId: number
}

export type PlayerTimelineEntry =
  | {
      key: string
      round: number
      kind: 'claim'
      claim: StructuredClaim
    }
  | {
      key: string
      round: number
      kind: 'vote'
      vote: VoteRecord
    }

export type ChatChannel = 'village' | 'vampire' | 'ghost'

export interface ChatMessage {
  id: number
  round: number
  phase: GamePhase
  channel: ChatChannel
  authorId: number
  text: string
}

export interface ChatAccess {
  readable: ChatChannel[]
  writable: ChatChannel[]
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
  claims: StructuredClaim[]
  chatMessages: ChatMessage[]
  nightActions: NightAction[]
  dayVotes: Record<number, number>
  voteHistory: VoteRecord[]
  privateIntel: Record<number, SeerIntel[]>
  lastNight: NightResolution | null
  lastVote: VoteResolution | null
  winner: Winner
  nextClaimId: number
  nextChatMessageId: number
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
