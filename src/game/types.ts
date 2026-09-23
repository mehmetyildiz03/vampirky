export type PlayerId = number

export type RoleId = 'vampire' | 'seer' | 'guardian' | 'villager'
export type TeamId = 'vampire' | 'village'
export type GamePhase = 'role-reveal' | 'night' | 'dawn' | 'day' | 'vote' | 'verdict' | 'ended'
export type Winner = TeamId | null

export type PublicPlayer = {
  id: PlayerId
  name: string
  alive: boolean
}

export type Investigation = {
  day: number
  targetId: PlayerId
  team: TeamId
}

export type VoteRecord = {
  day: number
  votes: Record<PlayerId, PlayerId>
  eliminatedPlayerId: PlayerId | null
  tied: boolean
}

export type NightSummary = {
  day: number
  killedPlayerId: PlayerId | null
}

export type PublicGameState = {
  phase: GamePhase
  day: number
  players: PublicPlayer[]
  voteHistory: VoteRecord[]
  lastNight: NightSummary | null
  lastEliminatedPlayerId: PlayerId | null
  winner: Winner
}

export type SecretGameState = {
  roles: Record<PlayerId, RoleId>
  investigations: Record<PlayerId, Investigation[]>
}

export type GameState = {
  public: PublicGameState
  secret: SecretGameState
}

export type NightAction =
  | { actorId: PlayerId; type: 'vampire-kill'; targetId: PlayerId }
  | { actorId: PlayerId; type: 'protect'; targetId: PlayerId }
  | { actorId: PlayerId; type: 'investigate'; targetId: PlayerId }

export type Vote = {
  voterId: PlayerId
  targetId: PlayerId
}

export type RandomSource = () => number
