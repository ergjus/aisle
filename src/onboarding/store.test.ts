import { describe, expect, it } from 'vitest'
import { SAMPLE } from '../sample'
import { useStore } from '../store'
import type { PersonalizedDemoConfig } from '../types'

const config: PersonalizedDemoConfig = {
  venuePreset: 'ballroom',
  widthFt: 60,
  lengthFt: 33,
  tableStyle: 'round',
  seatsPerTable: 8,
  amenities: ['entrance', 'dance_floor', 'band', 'bathroom'],
  priority: 'family_harmony',
}

function reloadPersonalizedDemo() {
  const result = useStore.getState().loadPersonalizedSample(config)
  expect(result.ok).toBe(true)
  expect(useStore.getState().demoMetadata?.kind).toBe('personalized')
}

describe('personalized sample metadata', () => {
  it('clears when guests or tables are structurally added or removed', () => {
    reloadPersonalizedDemo()
    useStore.getState().addGuest({ name: 'New Guest' })
    expect(useStore.getState().demoMetadata).toBeNull()

    reloadPersonalizedDemo()
    useStore.getState().removeGuest('g-sam')
    expect(useStore.getState().demoMetadata).toBeNull()

    reloadPersonalizedDemo()
    useStore.getState().addTable({ name: 'Extra Table' })
    expect(useStore.getState().demoMetadata).toBeNull()

    reloadPersonalizedDemo()
    useStore.getState().removeTable(useStore.getState().tableOrder[0])
    expect(useStore.getState().demoMetadata).toBeNull()
  })

  it('keeps the default sample path and undo/redo behavior intact', () => {
    useStore.getState().resetAll()
    useStore.setState({ undoStack: [], redoStack: [] })

    useStore.getState().loadSample(SAMPLE)
    expect(useStore.getState().guestOrder).toHaveLength(72)
    expect(useStore.getState().demoMetadata).toBeNull()

    expect(useStore.getState().undo()).toBe(true)
    expect(useStore.getState().guestOrder).toHaveLength(0)
    expect(useStore.getState().redo()).toBe(true)
    expect(useStore.getState().guestOrder).toHaveLength(72)
  })
})
