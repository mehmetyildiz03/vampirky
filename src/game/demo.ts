import { secureRandomInt } from './random'
import {
  resolveNight,
  resolveVote,
  submitNightAction,
  submitVote,
  validNightTargets,
} from './engine'
import type { GameState } from './types'
import { ROLE_DEFINITIONS } from './roles'

function randomNightTarget(state: GameState, actorId: number): number | null {
  const targets = validNightTargets(state, actorId)
  if (!targets.length) return null
  return targets[secureRandomInt(targets.length)].id
}

export function completeNightWithBots(
  state: GameState,
  humanPlayerId: number,
): GameState {
  let next = state

  const humanVampireAction = next.nightActions.find(
    (action) => action.actorId === humanPlayerId && action.type === 'attack',
  )
  let sharedVampireTarget = humanVampireAction?.targetId ?? null

  for (const player of next.players) {
    if (!player.alive || player.id === humanPlayerId) continue
    const action = ROLE_DEFINITIONS[player.secretRole].nightAction
    if (!action) continue

    let targetId: number | null

    if (action === 'attack') {
      if (sharedVampireTarget === null) {
        sharedVampireTarget = randomNightTarget(next, player.id)
      }
      targetId = sharedVampireTarget
    } else {
      targetId = randomNightTarget(next, player.id)
    }

    if (targetId !== null) {
      next = submitNightAction(next, player.id, targetId)
    }
  }

  return resolveNight(next)
}

export function completeVoteWithBots(
  state: GameState,
  humanPlayerId: number,
): GameState {
  let next = state

  for (const voter of next.players) {
    if (!voter.alive || voter.id === humanPlayerId) continue
    const targets = next.players.filter(
      (target) => target.alive && target.id !== voter.id,
    )
    if (!targets.length) continue
    const target = targets[secureRandomInt(targets.length)]
    next = submitVote(next, voter.id, target.id)
  }

  return resolveVote(next)
}
