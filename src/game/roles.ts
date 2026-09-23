import type { RoleId, TeamId } from './types'

export type RoleDefinition = {
  id: RoleId
  name: string
  icon: string
  team: TeamId
  nightAction: 'vampire-kill' | 'protect' | 'investigate' | null
  short: string
  description: string
}

export const ROLE_DEFINITIONS: Record<RoleId, RoleDefinition> = {
  vampire: {
    id: 'vampire',
    name: 'Vampir',
    icon: '🦇',
    team: 'vampire',
    nightAction: 'vampire-kill',
    short: 'Karanlığın tarafındasın.',
    description: 'Diğer vampirlerle birlikte geceleri bir köylüyü hedef alırsın.',
  },
  seer: {
    id: 'seer',
    name: 'Kâhin',
    icon: '◉',
    team: 'village',
    nightAction: 'investigate',
    short: 'Gerçeği geceleri görürsün.',
    description: 'Her gece yaşayan bir oyuncunun hangi tarafta olduğunu gizlice öğrenirsin.',
  },
  guardian: {
    id: 'guardian',
    name: 'Koruyucu',
    icon: '⬟',
    team: 'village',
    nightAction: 'protect',
    short: 'Bir hayatı koruyabilirsin.',
    description: 'Her gece yaşayan bir oyuncuyu vampir saldırısından korursun.',
  },
  villager: {
    id: 'villager',
    name: 'Köylü',
    icon: '♙',
    team: 'village',
    nightAction: null,
    short: 'Silahın sözlerin ve oyun.',
    description: 'Gece yeteneğin yok. İddiaları, oyları ve davranışları okuyarak vampirleri bulursun.',
  },
}

export function roleTeam(role: RoleId): TeamId {
  return ROLE_DEFINITIONS[role].team
}
