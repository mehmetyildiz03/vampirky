export type DeductionMark = 'suspicious' | 'uncertain' | 'trusted'

export interface PrivateDeductionState {
  ownerId: number
  marks: Record<number, DeductionMark>
}

export function createPrivateDeductionState(
  ownerId: number,
  playerIds: readonly number[],
): PrivateDeductionState {
  return {
    ownerId,
    marks: Object.fromEntries(
      playerIds.map((playerId) => [playerId, 'uncertain' as DeductionMark]),
    ),
  }
}

export function getDeductionMark(
  state: PrivateDeductionState,
  playerId: number,
): DeductionMark {
  return state.marks[playerId] ?? 'uncertain'
}

export function setDeductionMark(
  state: PrivateDeductionState,
  playerId: number,
  mark: DeductionMark,
): PrivateDeductionState {
  if (playerId === state.ownerId) return state

  return {
    ...state,
    marks: {
      ...state.marks,
      [playerId]: mark,
    },
  }
}
