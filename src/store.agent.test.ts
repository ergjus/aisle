import { describe, expect, it } from 'vitest'
import { SAMPLE } from './sample'
import { getCore, useStore } from './store'

/** Fresh sample room with clean undo/proposal/checkpoint state. */
function seedRoom() {
  useStore.getState().resetAll()
  useStore.getState().loadSample(SAMPLE)
  useStore.setState({ undoStack: [], redoStack: [], proposal: null, lastProposalDecision: null, checkpoints: {} })
}

describe('agent proposals', () => {
  it('keep resolves the proposal and leaves the arrangement in place', () => {
    seedRoom()
    const before = structuredClone(getCore().seating)
    useStore.getState().seatGuest('g-sam', 't1')
    useStore.getState().beginProposal({ id: 'p1', summary: 'test', moved: 1, beforeSeating: before })
    useStore.getState().resolveProposal('keep')
    const s = useStore.getState()
    expect(s.proposal).toBeNull()
    expect(s.lastProposalDecision).toMatchObject({ id: 'p1', decision: 'keep' })
    expect(s.seating['g-sam']?.tableId).toBe('t1')
  })

  it('revert restores the pre-proposal seating, undoably', () => {
    seedRoom()
    useStore.getState().seatGuest('g-sam', 't1')
    const before = structuredClone(getCore().seating)
    useStore.getState().seatGuest('g-jordan', 't1')
    useStore.getState().beginProposal({ id: 'p2', summary: 'test', moved: 1, beforeSeating: before })
    useStore.getState().resolveProposal('revert')
    let s = useStore.getState()
    expect(s.proposal).toBeNull()
    expect(s.lastProposalDecision).toMatchObject({ id: 'p2', decision: 'revert' })
    expect(s.seating['g-sam']?.tableId).toBe('t1')
    expect(s.seating['g-jordan']).toBeUndefined()
    // The revert itself is one undo step.
    expect(useStore.getState().undo()).toBe(true)
    s = useStore.getState()
    expect(s.seating['g-jordan']?.tableId).toBe('t1')
  })

  it('any further edit adopts a pending proposal as kept', () => {
    seedRoom()
    useStore.getState().seatGuest('g-sam', 't1')
    useStore.getState().beginProposal({ id: 'p3', summary: 'test', moved: 1, beforeSeating: {} })
    useStore.getState().seatGuest('g-maya', 't2')
    const s = useStore.getState()
    expect(s.proposal).toBeNull()
    expect(s.lastProposalDecision).toMatchObject({ id: 'p3', decision: 'keep' })
    expect(s.seating['g-sam']?.tableId).toBe('t1')
    expect(s.seating['g-maya']?.tableId).toBe('t2')
  })

  it('undoing while a proposal is pending records it as reverted', () => {
    seedRoom()
    useStore.getState().seatGuest('g-sam', 't1')
    useStore.getState().beginProposal({ id: 'p4', summary: 'test', moved: 1, beforeSeating: {} })
    expect(useStore.getState().undo()).toBe(true)
    const s = useStore.getState()
    expect(s.proposal).toBeNull()
    expect(s.lastProposalDecision).toMatchObject({ id: 'p4', decision: 'revert' })
    expect(s.seating['g-sam']).toBeUndefined()
  })
})

describe('checkpoints', () => {
  it('restores a saved state, keeps the checkpoint, and stays undoable', () => {
    seedRoom()
    useStore.getState().seatGuest('g-sam', 't1')
    useStore.getState().saveCheckpoint('base')
    useStore.getState().seatGuest('g-jordan', 't1')
    useStore.getState().seatGuest('g-maya', 't2')

    const cp = useStore.getState().restoreCheckpoint('base')
    expect(cp?.name).toBe('base')
    let s = useStore.getState()
    expect(s.seating['g-sam']?.tableId).toBe('t1')
    expect(s.seating['g-jordan']).toBeUndefined()
    expect(s.seating['g-maya']).toBeUndefined()
    // The checkpoint survives its own restore.
    expect(Object.keys(s.checkpoints)).toEqual(['base'])
    // And the restore is one undo step.
    expect(useStore.getState().undo()).toBe(true)
    s = useStore.getState()
    expect(s.seating['g-jordan']?.tableId).toBe('t1')
    expect(s.seating['g-maya']?.tableId).toBe('t2')
  })

  it('returns null for an unknown checkpoint', () => {
    seedRoom()
    expect(useStore.getState().restoreCheckpoint('nope')).toBeNull()
  })
})
