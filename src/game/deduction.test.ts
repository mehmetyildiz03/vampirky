import { describe, expect, it } from 'vitest'
import { createGame } from './engine'
import {
  createPrivateDeductionState,
  getDeductionMark,
  setDeductionMark,
} from './deduction'

describe('private deduction state', () => {
  it('defaults every player to uncertain', () => {
    const state = createPrivateDeductionState(1, [1, 2, 3])

    expect(getDeductionMark(state, 1)).toBe('uncertain')
    expect(getDeductionMark(state, 2)).toBe('uncertain')
    expect(getDeductionMark(state, 3)).toBe('uncertain')
  })

  it('updates one private mark without mutating the previous state', () => {
    const state = createPrivateDeductionState(1, [1, 2, 3])
    const next = setDeductionMark(state, 2, 'suspicious')

    expect(getDeductionMark(state, 2)).toBe('uncertain')
    expect(getDeductionMark(next, 2)).toBe('suspicious')
    expect(getDeductionMark(next, 3)).toBe('uncertain')
  })

  it('stays outside the authoritative public game state', () => {
    const game = createGame(
      Array.from({ length: 6 }, (_, index) => ({
        id: index + 1,
        name: `Oyuncu ${index + 1}`,
      })),
    )

    expect('deduction' in game).toBe(false)
    expect('marks' in game).toBe(false)
  })
})


it('keeps the owner unmarked', () => {
  const state = createPrivateDeductionState(1, [1, 2, 3])
  const next = setDeductionMark(state, 1, 'trusted')

  expect(getDeductionMark(next, 1)).toBe('uncertain')
})
