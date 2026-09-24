import { describe, expect, it } from 'vitest'
import { createGame } from './engine'
import {
  addPrivateGeneralNote,
  addPrivatePlayerNote,
  createPrivateDeductionState,
  getDeductionMark,
  getPrivateGeneralNotes,
  getPrivatePlayerNotes,
  removePrivateGeneralNote,
  removePrivatePlayerNote,
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


describe('private player notes', () => {
  it('stores notes by player and preserves the round they were written', () => {
    let state = createPrivateDeductionState(1, [1, 2, 3])
    state = addPrivatePlayerNote(state, 2, 2, 'Rol iddiasını değiştirdi.')

    expect(getPrivatePlayerNotes(state, 2)).toEqual([
      {
        id: 1,
        playerId: 2,
        round: 2,
        text: 'Rol iddiasını değiştirdi.',
      },
    ])
    expect(getPrivatePlayerNotes(state, 3)).toEqual([])
  })

  it('trims text and ignores empty notes', () => {
    let state = createPrivateDeductionState(1, [1, 2])
    state = addPrivatePlayerNote(state, 2, 1, '  Geç oy verdi.  ')
    state = addPrivatePlayerNote(state, 2, 1, '   ')

    expect(getPrivatePlayerNotes(state, 2)).toHaveLength(1)
    expect(getPrivatePlayerNotes(state, 2)[0].text).toBe('Geç oy verdi.')
  })

  it('removes one note without changing the other notes', () => {
    let state = createPrivateDeductionState(1, [1, 2])
    state = addPrivatePlayerNote(state, 2, 1, 'İlk not')
    state = addPrivatePlayerNote(state, 2, 2, 'İkinci not')
    state = removePrivatePlayerNote(state, 2, 1)

    expect(getPrivatePlayerNotes(state, 2).map((note) => note.text)).toEqual([
      'İkinci not',
    ])
  })

  it('does not create private notes for the owner', () => {
    let state = createPrivateDeductionState(1, [1, 2])
    state = addPrivatePlayerNote(state, 1, 1, 'Kendim hakkında not')

    expect(getPrivatePlayerNotes(state, 1)).toEqual([])
  })
})


describe('private general notes', () => {
  it('stores round-scoped match notes independently from player notes', () => {
    let state = createPrivateDeductionState(1, [1, 2, 3])
    state = addPrivateGeneralNote(state, 2, 'İki kişi aynı rolü iddia etti.')

    expect(getPrivateGeneralNotes(state)).toEqual([
      {
        id: 1,
        round: 2,
        text: 'İki kişi aynı rolü iddia etti.',
      },
    ])
    expect(getPrivatePlayerNotes(state, 2)).toEqual([])
  })

  it('removes one general private note without mutating others', () => {
    let state = createPrivateDeductionState(1, [1, 2])
    state = addPrivateGeneralNote(state, 1, 'İlk genel not')
    state = addPrivateGeneralNote(state, 2, 'İkinci genel not')
    state = removePrivateGeneralNote(state, 1)

    expect(getPrivateGeneralNotes(state).map((note) => note.text))
      .toEqual(['İkinci genel not'])
  })
})
