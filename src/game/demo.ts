import { secureRandomInt } from './random'
import { resolveNight, submitNightAction, validNightTargets } from './engine'
import type { GameState } from './types'
import { ROLE_DEFINITIONS } from './roles'

function randomTarget(state: GameState, actorId: number): number | null {
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

  for (const player of next.players) {
    if (!player.alive || player.id === humanPlayerId) continue
    const action = ROLE_DEFINITIONS[player.secretRole].nightAction
    if (!action) continue

    let targetId: number | null = null

    if (action === 'attack' && humanVampireAction) {
      targetId = humanVampireAction.targetId
    } else {
      targetId = randomTarget(next, player.id)
    }

    if (targetId !== null) {
      next = submitNightAction(next, player.id, targetId)
    }
  }

  return resolveNight(next)
}
