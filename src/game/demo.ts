import { getRoleForPlayer, livingPlayers, resolveNight, resolveVote, validNightTargets, validVoteTargets } from './engine'
import type { GameState, NightAction, PlayerId, Vote } from './types'

function pick<T>(items: T[]): T {
  if (items.length === 0) throw new Error('Demo hedefi bulunamadı.')
  const index = Math.floor(Math.random() * items.length)
  return items[index]
}

export function resolveDemoNight(
  state: GameState,
  localPlayerId: PlayerId,
  localTargetId: PlayerId | null,
): GameState {
  const actions: NightAction[] = []
  const alive = livingPlayers(state)
  const localRole = getRoleForPlayer(state, localPlayerId)

  const vampireIds = alive.filter((p) => getRoleForPlayer(state, p.id) === 'vampire').map((p) => p.id)
  const vampireTargets = alive.filter((p) => getRoleForPlayer(state, p.id) !== 'vampire')
  const sharedVampireTarget =
    localRole === 'vampire' && localTargetId !== null
      ? localTargetId
      : pick(vampireTargets).id

  vampireIds.forEach((actorId) => {
    actions.push({ actorId, type: 'vampire-kill', targetId: sharedVampireTarget })
  })

  const seer = alive.find((p) => getRoleForPlayer(state, p.id) === 'seer')
  if (seer) {
    const targetId =
      seer.id === localPlayerId && localRole === 'seer' && localTargetId !== null
        ? localTargetId
        : pick(validNightTargets(state, seer.id)).id
    actions.push({ actorId: seer.id, type: 'investigate', targetId })
  }

  const guardian = alive.find((p) => getRoleForPlayer(state, p.id) === 'guardian')
  if (guardian) {
    const targetId =
      guardian.id === localPlayerId && localRole === 'guardian' && localTargetId !== null
        ? localTargetId
        : pick(validNightTargets(state, guardian.id)).id
    actions.push({ actorId: guardian.id, type: 'protect', targetId })
  }

  return resolveNight(state, actions)
}

export function resolveDemoVote(
  state: GameState,
  localPlayerId: PlayerId,
  localTargetId: PlayerId,
): GameState {
  const votes: Vote[] = []
  for (const voter of livingPlayers(state)) {
    const targetId =
      voter.id === localPlayerId
        ? localTargetId
        : pick(validVoteTargets(state, voter.id)).id
    votes.push({ voterId: voter.id, targetId })
  }
  return resolveVote(state, votes)
}
