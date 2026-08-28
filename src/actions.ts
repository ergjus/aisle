import { getCore, useStore } from './store'
import { autoArrange } from './solver'

/**
 * Run the solver from the UI — the same engine the agent's auto_arrange tool
 * uses, logged to the activity feed as the human's own action.
 */
export function seatEveryone(mode: 'full' | 'repair'): void {
  const store = useStore.getState()
  const state = getCore()
  const attending = state.guestOrder.filter((id) => state.guests[id].rsvp !== 'no')
  if (attending.length === 0) {
    store.setToast('Add guests first — the list is empty.')
    return
  }
  if (state.tableOrder.length === 0) {
    store.setToast('Add a table first — there is nowhere to sit.')
    return
  }
  const before = state.seating
  const result = autoArrange(state, { mode })
  store.applyArrangement(result.assignments)
  const touched = attending.filter(
    (id) => (before[id]?.tableId ?? '') !== (result.assignments[id]?.tableId ?? ''),
  )
  const tables = new Set(touched.map((id) => result.assignments[id]?.tableId).filter(Boolean) as string[])
  store.markTouched([...touched, ...tables])
  store.logActivity(mode === 'repair' ? 'fix broken rules' : 'seat everyone', result.explanation.split('\n')[0], 'you')
  store.setToast(result.explanation.split('\n')[0])
}
