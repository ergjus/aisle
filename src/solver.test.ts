import { describe, expect, it } from 'vitest'
import { SAMPLE } from './sample'
import { autoArrange } from './solver'
import type { AisleState } from './types'
import { freshVenue, freshVenueDimensions } from './geometry'

function sampleState(): AisleState {
  let groupOrder: string[] = []
  for (const g of SAMPLE.guests) if (!groupOrder.includes(g.group)) groupOrder.push(g.group)
  return {
    layoutVersion: 3,
    guests: Object.fromEntries(SAMPLE.guests.map((g) => [g.id, g])),
    guestOrder: SAMPLE.guests.map((g) => g.id),
    tables: Object.fromEntries(SAMPLE.tables.map((t) => [t.id, t])),
    tableOrder: SAMPLE.tables.map((t) => t.id),
    constraints: SAMPLE.constraints,
    seating: {},
    finalized: false,
    groupOrder,
    venue: freshVenue(),
    venueDimensions: freshVenueDimensions(),
    demoMetadata: null,
    pinned: {},
  }
}

describe('pinned seats', () => {
  it('a full re-arrangement leaves a pinned guest in the exact seat the human chose', () => {
    const state = sampleState()
    // Rosa is pinned at Table 3, seat 5 — a seat the solver would never pick on its own.
    state.seating = { 'g-rosa': { tableId: 't3', seat: 5 } }
    state.pinned = { 'g-rosa': true }
    const result = autoArrange(state, { mode: 'full' })
    expect(result.assignments['g-rosa']).toEqual({ tableId: 't3', seat: 5 })
    expect(result.explanation).toMatch(/pinned/i)
  })

  it('brings a pinned guest’s sit-together partner to the pinned table', () => {
    const state = sampleState()
    state.seating = { 'g-rosa': { tableId: 't3', seat: 0 } }
    state.pinned = { 'g-rosa': true }
    const result = autoArrange(state, { mode: 'full' })
    // Bianca "looks after" Rosa (rule c4) — she should follow the pin.
    expect(result.assignments['g-bianca']?.tableId).toBe('t3')
  })

  it('repair mode never moves a pinned guest, even to fix the rule they break', () => {
    const state = sampleState()
    const full = autoArrange(state, { mode: 'full' })
    state.seating = { ...full.assignments }
    // Put the two exes together and pin Sam — the repair has to move Jordan instead.
    const samSeat = state.seating['g-sam']
    state.seating['g-jordan'] = { tableId: samSeat.tableId, seat: 7 }
    state.pinned = { 'g-sam': true }
    const repaired = autoArrange(state, { mode: 'repair' })
    expect(repaired.assignments['g-sam']).toEqual(samSeat)
    expect(repaired.assignments['g-jordan']?.tableId).not.toBe(samSeat.tableId)
  })

  it('ignores a pin whose table no longer exists', () => {
    const state = sampleState()
    state.seating = { 'g-rosa': { tableId: 'gone', seat: 0 } }
    state.pinned = { 'g-rosa': true }
    const result = autoArrange(state, { mode: 'full' })
    expect(state.tables[result.assignments['g-rosa'].tableId]).toBeDefined()
  })
})
