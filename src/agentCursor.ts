import type { AisleState, VenueFeatureId } from './types'
import { TRAY, chipPositions, roomRect } from './geometry'

/*
 * Agent cursor choreography.
 *
 * Tool handlers mutate the store instantly; this module turns each mutation's
 * before/after diff into a small "performance" — a sequence of cursor beats —
 * that the <AgentCursor> component in the canvas plays back. For small moves
 * the chip itself is held back (via transition-delay) until the cursor reaches
 * it, so the agent visibly picks the guest up and carries them to their seat.
 */

export interface CursorStep {
  x: number
  y: number
  /** Bubble text shown while this step plays. */
  label?: string
  gesture?: 'grab' | 'carry' | 'drop' | 'point'
  durationMs?: number
  holdMs?: number
  /** cubic-bezier for the travel; defaults to a gentle ease. */
  ease?: [number, number, number, number]
  /** Keep the cursor where it is — label-only beat. */
  stay?: boolean
}

export interface CursorPerformance {
  steps: CursorStep[]
  /** Drop silently if the cursor is not currently on stage (read-only glances). */
  onlyIfVisible?: boolean
  /** Timed to match delayed chip transitions — never rushed or dropped. */
  synced?: boolean
}

// Matches --chip-move in canvas.css so a carried chip and the cursor arrive together.
export const CHIP_EASE: [number, number, number, number] = [0.23, 0.9, 0.28, 1]
export const CARRY_MS = 680
const APPROACH_MS = 420
const GRAB_HOLD_MS = 150
const DROP_HOLD_MS = 300
const POINT_MS = 460
const POINT_HOLD_MS = 700

// ---- performance queue ------------------------------------------------------

const queue: CursorPerformance[] = []
let wake: (() => void) | null = null
let playing = false

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

// In a hidden tab rAF is paused, so performances could neither play nor be
// seen — skip them, and drop any backlog when the tab goes hidden. The chips'
// own CSS choreography still tells the story when the user tabs back.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) queue.length = 0
  })
}

export function enqueuePerformance(p: CursorPerformance): void {
  if (reducedMotion() || p.steps.length === 0) return
  if (typeof document !== 'undefined' && document.hidden) return
  queue.push(p)
  // A backlog means the agent is hammering tools; keep only the freshest acts.
  while (queue.length > 4) {
    const i = queue.findIndex((q) => !q.synced)
    queue.splice(i === -1 ? 0 : i, 1)
  }
  wake?.()
}

export function nextPerformance(): CursorPerformance | undefined {
  return queue.shift()
}

export function queuedCount(): number {
  return queue.length
}

export function setCursorPlaying(v: boolean): void {
  playing = v
}

export function cursorBusy(): boolean {
  return playing || queue.length > 0
}

/** The cursor component registers here to be woken when work arrives. */
export function onPerformance(listener: () => void): () => void {
  wake = listener
  return () => {
    if (wake === listener) wake = null
  }
}

// ---- chip departure delays --------------------------------------------------

// When the cursor is on its way to pick a chip up, the chip's CSS transition
// is delayed so it doesn't leave before the cursor arrives.
const chipDelays = new Map<string, { delay: number; until: number }>()

export function agentChipDelay(id: string): number | undefined {
  const entry = chipDelays.get(id)
  if (!entry) return undefined
  if (Date.now() > entry.until) {
    chipDelays.delete(id)
    return undefined
  }
  return entry.delay
}

function setChipDelay(id: string, delay: number): void {
  chipDelays.set(id, { delay, until: Date.now() + delay + 2200 })
}

// ---- choreography -----------------------------------------------------------

function clip(text: string, max = 58): string {
  const line = text.split('\n')[0]
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

function seatName(state: AisleState, id: string): string {
  const seat = state.seating[id]
  return seat ? state.tables[seat.tableId]?.name ?? 'a table' : 'the lounge'
}

/** Center of a touched table or venue feature, if the id is one. */
function placeCenter(state: AisleState, id: string): { x: number; y: number; label: string } | null {
  // Room recalibration has no single spot — gesture at the middle of the floor.
  if (id === 'venue-dimensions') {
    const room = roomRect(state.venueDimensions)
    return { x: room.x + room.w / 2, y: room.y + room.h / 2, label: 'Room' }
  }
  const table = state.tables[id]
  if (table) return { x: table.x, y: table.y, label: table.name }
  const feature = state.venue[id as VenueFeatureId]
  if (feature && typeof feature === 'object' && 'label' in feature) {
    return { x: feature.x + feature.w / 2, y: feature.y + feature.h / 2, label: feature.label }
  }
  return null
}

/**
 * Build and enqueue the cursor performance for one mutating tool call.
 * `touched` is the tool's own list of affected ids; guest moves are derived
 * from the seating diff so side effects (bumped guests, cleared rooms) count.
 */
export function choreograph(opts: {
  tool: string
  summary: string
  before: AisleState
  after: AisleState
  touched: string[]
}): void {
  if (reducedMotion() || (typeof document !== 'undefined' && document.hidden)) return
  const { before, after, touched } = opts
  const summary = clip(opts.summary)
  const posBefore = chipPositions(before)
  const posAfter = chipPositions(after)

  const seatOf = (s: AisleState, id: string) =>
    s.seating[id] ? `${s.seating[id].tableId}:${s.seating[id].seat}` : ''
  const moved = after.guestOrder.filter(
    (id) => before.guests[id] && posBefore[id] && posAfter[id] && seatOf(before, id) !== seatOf(after, id),
  )

  const steps: CursorStep[] = []
  const visitedTables = new Set<string>()
  let escorted = false

  if (moved.length > 0 && moved.length <= 2 && !cursorBusy()) {
    escorted = true
    // Pick each guest up and carry them to their seat, chip in tow.
    let t = 0
    for (const id of moved) {
      const from = posBefore[id]
      const to = posAfter[id]
      const name = after.guests[id].name
      steps.push({
        x: from.x + 8,
        y: from.y + 8,
        label: name,
        gesture: 'grab',
        durationMs: APPROACH_MS,
        holdMs: GRAB_HOLD_MS,
      })
      t += APPROACH_MS + GRAB_HOLD_MS
      setChipDelay(id, t)
      steps.push({
        x: to.x + 8,
        y: to.y + 8,
        label: `${name} → ${seatName(after, id)}`,
        gesture: 'carry',
        durationMs: CARRY_MS,
        ease: CHIP_EASE,
      })
      steps.push({ x: to.x, y: to.y, stay: true, gesture: 'drop', holdMs: DROP_HOLD_MS })
      t += CARRY_MS + DROP_HOLD_MS
      if (after.seating[id]) visitedTables.add(after.seating[id].tableId)
    }
    enqueuePerformance({ steps, synced: true })
  } else if (moved.length > 2) {
    escorted = true
    // Too many to escort one by one — sweep across the destinations like a
    // conductor while the chips' own staggered glide plays underneath.
    const destTables = [...new Set(moved.map((id) => after.seating[id]?.tableId).filter(Boolean))] as string[]
    const stops = destTables.slice(0, 3).map((tid) => after.tables[tid]).filter(Boolean)
    if (stops.length === 0) {
      // Everyone headed to the lounge.
      steps.push({
        x: TRAY.x + TRAY.w / 2,
        y: TRAY.y + TRAY.h / 2,
        label: summary,
        gesture: 'point',
        durationMs: POINT_MS,
        holdMs: POINT_HOLD_MS,
      })
    } else {
      stops.forEach((table, i) => {
        steps.push({
          x: table.x,
          y: table.y,
          label: i === 0 ? summary : undefined,
          gesture: 'point',
          durationMs: i === 0 ? POINT_MS : 520,
          holdMs: i === stops.length - 1 ? POINT_HOLD_MS : 260,
        })
        visitedTables.add(table.id)
      })
    }
    enqueuePerformance({ steps })
  }

  // Remaining touched things: new guests in the lounge, tables, venue
  // features, rule endpoints — fly over and point at them.
  if (!escorted) {
    // Tables that vanished aren't in `touched` — point at where they stood.
    const removedTables = before.tableOrder.filter((id) => !after.tables[id])
    const targets = [...new Set([...touched, ...removedTables])]
    const extra: CursorStep[] = []
    for (const id of targets) {
      if (extra.length >= 3) break
      const guest = after.guests[id] ?? before.guests[id]
      if (guest) {
        const p = posAfter[id] ?? posBefore[id]
        if (p) extra.push({ x: p.x + 8, y: p.y + 8, gesture: 'point', durationMs: POINT_MS, holdMs: 320 })
        continue
      }
      const place = placeCenter(after, id) ?? placeCenter(before, id)
      if (place && !visitedTables.has(id)) {
        extra.push({ x: place.x, y: place.y, gesture: 'point', durationMs: POINT_MS, holdMs: 320 })
      }
    }
    if (extra.length > 0) {
      extra[0].label = summary
      extra[extra.length - 1].holdMs = POINT_HOLD_MS
      enqueuePerformance({ steps: extra })
    }
  }
}

/** A label-only beat where the cursor already is — used for read-only tools. */
export function glance(label: string): void {
  enqueuePerformance({
    steps: [{ x: 0, y: 0, stay: true, label, gesture: 'point', holdMs: 1000 }],
    onlyIfVisible: true,
  })
}
