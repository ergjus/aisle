import { computeViolations, constraintStatus } from '../constraints'
import { occupantsOf, useStore } from '../store'
import type { AisleState, Constraint, DemoPriority } from '../types'
import { zoneBands } from '../geometry'
import type { ChallengeStep } from './storage'

export const CHALLENGE_CONSTRAINT_IDS: Record<DemoPriority, string> = {
  family_harmony: 'c2',
  dance_floor_energy: 'c13',
  easy_arrivals: 'c16',
}

export const CHALLENGE_GUEST_IDS: Record<DemoPriority, string> = {
  family_harmony: 'g-sam',
  dance_floor_energy: 'g-priya',
  easy_arrivals: 'g-dot',
}

export function challengeConstraint(
  state: AisleState,
  priority: DemoPriority,
): Constraint | undefined {
  return state.constraints.find((constraint) => constraint.id === CHALLENGE_CONSTRAINT_IDS[priority])
}

export function challengePauseReason(state: AisleState, priority: DemoPriority): string | null {
  if (state.demoMetadata?.kind !== 'personalized') {
    return 'The personalized sample changed, so assisted challenge actions are paused. Your chart is safe.'
  }
  const requiredGuests = priority === 'family_harmony'
    ? ['g-sam', 'g-jordan']
    : [CHALLENGE_GUEST_IDS[priority]]
  if (requiredGuests.some((id) => !state.guests[id])) {
    return 'A guest needed for this challenge is no longer on the chart. The guide is paused.'
  }
  if (!challengeConstraint(state, priority)) {
    return 'The sample rule needed for this challenge was removed. The guide is paused.'
  }
  if (state.tableOrder.length === 0) {
    return 'The sample tables were removed. Add or restore tables before continuing the challenge.'
  }
  return null
}

export function isChallengeStepComplete(
  state: AisleState,
  priority: DemoPriority,
  step: ChallengeStep,
): boolean {
  const attendees = state.guestOrder.filter((id) => state.guests[id]?.rsvp !== 'no')
  if (step === 0) return attendees.length > 0 && attendees.every((id) => Boolean(state.seating[id]))
  const constraint = challengeConstraint(state, priority)
  if (!constraint) return false
  if (step === 1) return constraintStatus(state, constraint) === 'violated'
  return constraintStatus(state, constraint) === 'ok' && computeViolations(state).length === 0
}

export interface ChallengeSwapPlan {
  mover: string
  swapWith: string
  targetTableId: string
}

function occupantForSwap(state: AisleState, tableId: string, excluded: Set<string>): string | null {
  return occupantsOf(state, tableId).find((id) => !excluded.has(id)) ?? null
}

export function getChallengeSwapPlan(
  state: AisleState,
  priority: DemoPriority,
): ChallengeSwapPlan | null {
  const mover = CHALLENGE_GUEST_IDS[priority]
  const moverSeat = state.seating[mover]
  if (!moverSeat) return null

  if (priority === 'family_harmony') {
    const jordanSeat = state.seating['g-jordan']
    if (!jordanSeat) return null
    if (jordanSeat.tableId === moverSeat.tableId) return null
    const swapWith = occupantForSwap(state, jordanSeat.tableId, new Set([mover, 'g-jordan']))
    return swapWith ? { mover, swapWith, targetTableId: jordanSeat.tableId } : null
  }

  const constraint = challengeConstraint(state, priority)
  if (!constraint || constraint.type !== 'zone') return null
  const bands = zoneBands(state, constraint.zone)
  const candidates = state.tableOrder
    .filter((tableId) => tableId !== moverSeat.tableId && (bands.byTable[tableId] ?? 0) > bands.nearMax)
    .sort((a, b) => (bands.byTable[b] ?? 0) - (bands.byTable[a] ?? 0) || a.localeCompare(b))
  for (const targetTableId of candidates) {
    const swapWith = occupantForSwap(state, targetTableId, new Set([mover]))
    if (swapWith) return { mover, swapWith, targetTableId }
  }
  return null
}

export function createAssistedChallengeViolation(priority: DemoPriority): { ok: boolean; message: string } {
  const store = useStore.getState()
  const constraint = challengeConstraint(store, priority)
  if (constraint && constraintStatus(store, constraint) === 'violated') {
    return { ok: true, message: 'The intended rule is already broken.' }
  }
  const plan = getChallengeSwapPlan(store, priority)
  if (!plan) {
    return { ok: false, message: 'Seat everyone first, then try the assisted move again.' }
  }
  store.swapGuests(plan.mover, plan.swapWith)
  store.markTouched([plan.mover, plan.swapWith, plan.targetTableId])
  const moverName = store.guests[plan.mover]?.name ?? 'Guest'
  store.logActivity('challenge', `Moved ${moverName} with an unconstrained seat swap.`, 'you')
  return { ok: true, message: `Moved ${moverName} to create the challenge conflict.` }
}
