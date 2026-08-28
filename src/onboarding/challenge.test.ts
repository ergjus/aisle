import { beforeEach, describe, expect, it } from 'vitest'
import { seatEveryone } from '../actions'
import { autoArrange } from '../solver'
import { getCore, useStore } from '../store'
import type { DemoPriority, PersonalizedDemoConfig } from '../types'
import {
  challengePauseReason,
  createAssistedChallengeViolation,
  getChallengeSwapPlan,
  isChallengeStepComplete,
} from './challenge'
import { planPersonalizedSample } from './planner'

const priorities: DemoPriority[] = ['family_harmony', 'dance_floor_energy', 'easy_arrivals']

function config(priority: DemoPriority): PersonalizedDemoConfig {
  return {
    venuePreset: 'ballroom',
    widthFt: 60,
    lengthFt: 33,
    tableStyle: 'round',
    seatsPerTable: 8,
    amenities: ['entrance', 'dance_floor', 'band', 'bathroom'],
    priority,
  }
}

function loadSeatedDemo(priority: DemoPriority) {
  const planned = planPersonalizedSample(config(priority))
  if (!planned.ok) throw new Error(planned.message)
  const arranged = autoArrange(planned.state, { mode: 'full' })
  useStore.setState({
    ...planned.state,
    seating: arranged.assignments,
    undoStack: [],
    redoStack: [],
    selection: null,
    draggingGuest: null,
    touched: {},
    agentLog: [],
    toast: null,
  })
  return getCore()
}

describe('guided challenge state', () => {
  beforeEach(() => localStorage.clear())

  it.each(priorities)('advances %s from actual manual store changes', (priority) => {
    const state = loadSeatedDemo(priority)
    expect(isChallengeStepComplete(state, priority, 0)).toBe(true)
    const plan = getChallengeSwapPlan(state, priority)
    expect(plan).not.toBeNull()
    if (!plan) return

    const seating = { ...state.seating }
    const moverSeat = seating[plan.mover]
    seating[plan.mover] = seating[plan.swapWith]
    seating[plan.swapWith] = moverSeat
    useStore.setState({ seating })

    expect(isChallengeStepComplete(getCore(), priority, 1)).toBe(true)
    seatEveryone('repair')
    expect(isChallengeStepComplete(getCore(), priority, 2)).toBe(true)
  })

  it.each(priorities)('creates and repairs the %s conflict with assisted actions', (priority) => {
    loadSeatedDemo(priority)
    expect(createAssistedChallengeViolation(priority).ok).toBe(true)
    expect(isChallengeStepComplete(getCore(), priority, 1)).toBe(true)
    seatEveryone('repair')
    expect(isChallengeStepComplete(getCore(), priority, 2)).toBe(true)
  })

  it('pauses safely when personalized sample entities are no longer intact', () => {
    loadSeatedDemo('family_harmony')
    useStore.setState({ demoMetadata: null })
    expect(challengePauseReason(getCore(), 'family_harmony')).toMatch(/paused/i)

    const state = getCore()
    useStore.setState({
      demoMetadata: config('family_harmony') && {
        kind: 'personalized',
        version: 1,
        config: config('family_harmony'),
      },
      guests: Object.fromEntries(Object.entries(state.guests).filter(([id]) => id !== 'g-sam')),
    })
    expect(challengePauseReason(getCore(), 'family_harmony')).toMatch(/no longer on the chart/i)
  })
})
