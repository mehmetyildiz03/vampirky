import type { Faction, RoleId } from './types'

export interface RoleDefinition {
  id: RoleId
  name: string
  faction: Faction
  nightAction: 'attack' | 'protect' | 'investigate' | null
  singletonClaim: boolean
}

export const ROLE_DEFINITIONS: Record<RoleId, RoleDefinition> = {
  vampire: {
    id: 'vampire',
    name: 'Vampir',
    faction: 'vampire',
    nightAction: 'attack',
    singletonClaim: false,
  },
  villager: {
    id: 'villager',
    name: 'Köylü',
    faction: 'village',
    nightAction: null,
    singletonClaim: false,
  },
  seer: {
    id: 'seer',
    name: 'Kâhin',
    faction: 'village',
    nightAction: 'investigate',
    singletonClaim: true,
  },
  protector: {
    id: 'protector',
    name: 'Koruyucu',
    faction: 'village',
    nightAction: 'protect',
    singletonClaim: true,
  },
}

export function buildRolePack(playerCount: number): RoleId[] {
  if (!Number.isInteger(playerCount) || playerCount < 6 || playerCount > 12) {
    throw new Error('Vampir Köylü P1 supports 6 to 12 players.')
  }

  const vampireCount = playerCount >= 11 ? 3 : playerCount >= 8 ? 2 : 1
  const fixed: RoleId[] = [
    ...Array<RoleId>(vampireCount).fill('vampire'),
    'seer',
    'protector',
  ]
  const villagers = Array<RoleId>(playerCount - fixed.length).fill('villager')
  return [...fixed, ...villagers]
}

export function countRoles(pack: readonly RoleId[]): Record<RoleId, number> {
  return pack.reduce<Record<RoleId, number>>(
    (acc, role) => {
      acc[role] += 1
      return acc
    },
    { vampire: 0, villager: 0, seer: 0, protector: 0 },
  )
}
