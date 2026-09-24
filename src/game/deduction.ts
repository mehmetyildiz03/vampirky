export type DeductionMark = 'suspicious' | 'uncertain' | 'trusted'

export interface PrivatePlayerNote {
  id: number
  playerId: number
  round: number
  text: string
}

export interface PrivateGeneralNote {
  id: number
  round: number
  text: string
}

export interface PrivateDeductionState {
  ownerId: number
  marks: Record<number, DeductionMark>
  notes: Record<number, PrivatePlayerNote[]>
  generalNotes: PrivateGeneralNote[]
  nextNoteId: number
  nextGeneralNoteId: number
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
    notes: Object.fromEntries(playerIds.map((playerId) => [playerId, []])),
    generalNotes: [],
    nextNoteId: 1,
    nextGeneralNoteId: 1,
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


export function getPrivatePlayerNotes(
  state: PrivateDeductionState,
  playerId: number,
): PrivatePlayerNote[] {
  return (state.notes[playerId] ?? []).map((note) => ({ ...note }))
}

export function addPrivatePlayerNote(
  state: PrivateDeductionState,
  playerId: number,
  round: number,
  text: string,
): PrivateDeductionState {
  if (playerId === state.ownerId) return state
  if (!(playerId in state.marks)) return state

  const normalized = text.trim()
  if (!normalized) return state

  const note: PrivatePlayerNote = {
    id: state.nextNoteId,
    playerId,
    round,
    text: normalized,
  }

  return {
    ...state,
    notes: {
      ...state.notes,
      [playerId]: [...(state.notes[playerId] ?? []), note],
    },
    nextNoteId: state.nextNoteId + 1,
  }
}

export function removePrivatePlayerNote(
  state: PrivateDeductionState,
  playerId: number,
  noteId: number,
): PrivateDeductionState {
  if (!(playerId in state.notes)) return state

  return {
    ...state,
    notes: {
      ...state.notes,
      [playerId]: state.notes[playerId].filter((note) => note.id !== noteId),
    },
  }
}

export function getPrivateGeneralNotes(
  state: PrivateDeductionState,
): PrivateGeneralNote[] {
  return state.generalNotes.map((note) => ({ ...note }))
}

export function addPrivateGeneralNote(
  state: PrivateDeductionState,
  round: number,
  text: string,
): PrivateDeductionState {
  const normalized = text.trim()
  if (!normalized) return state

  return {
    ...state,
    generalNotes: [
      ...state.generalNotes,
      {
        id: state.nextGeneralNoteId,
        round,
        text: normalized,
      },
    ],
    nextGeneralNoteId: state.nextGeneralNoteId + 1,
  }
}

export function removePrivateGeneralNote(
  state: PrivateDeductionState,
  noteId: number,
): PrivateDeductionState {
  return {
    ...state,
    generalNotes: state.generalNotes.filter((note) => note.id !== noteId),
  }
}
