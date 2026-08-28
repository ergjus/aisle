import type { AisleState, VenueFeatureId } from './types'
import { chipPositions, roomRect, trayRect } from './geometry'

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
  /** Timed to match delayed chip transitions — never rushed or dropped. */
  synced?: boolean
  /** Resolves the enqueuer's promise once played (or dropped/skipped). */
  done?: () => void
}

// Matches --chip-move in canvas.css so a carried chip and the cursor arrive together.
export const CHIP_EASE: [number, number, number, number] = [0.23, 0.9, 0.28, 1]
export const CARRY_MS = 680
const APPROACH_MS = 420
const GRAB_HOLD_MS = 150
const DROP_HOLD_MS = 300
const POINT_MS = 460
const POINT_HOLD_MS = 700
/** Escort guests one by one up to this many moves; beyond it, stage table by table. */
const ESCORT_MAX = 4
/** Rough ceiling for a staged multi-table performance. */
const STAGED_TOTAL_MS = 14000

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
    if (document.hidden) {
      for (const p of queue) p.done?.()
      queue.length = 0
    }
  })
}

function perfDuration(p: CursorPerformance): number {
  return p.steps.reduce((ms, s) => ms + (s.stay ? 0 : s.durationMs ?? 420) + (s.holdMs ?? 0), 0)
}

// Estimated end of the performance currently on stage, for backlog math.
let playingUntil = 0

/**
 * Milliseconds of cursor work already committed (queued plus what remains of
 * the current act). Chip delays are set relative to now, so choreography adds
 * this lead to keep chips from leaving before the cursor can get to them.
 */
export function estimatedBacklogMs(): number {
  const queued = queue.reduce((ms, p) => ms + perfDuration(p), 0)
  return queued + (playing ? Math.max(0, playingUntil - Date.now()) : 0)
}

/** Resolves when the performance has played — or immediately if it can't. */
export function enqueuePerformance(p: CursorPerformance): Promise<void> {
  if (reducedMotion() || p.steps.length === 0) return Promise.resolve()
  if (typeof document !== 'undefined' && document.hidden) return Promise.resolve()
  return new Promise((resolve) => {
    p.done = resolve
    queue.push(p)
    // A backlog means the agent is hammering tools; keep only the freshest acts.
    while (queue.length > 4) {
      const i = queue.findIndex((q) => !q.synced)
      const [dropped] = queue.splice(i === -1 ? 0 : i, 1)
      dropped.done?.()
    }
    wake?.()
  })
}

export function nextPerformance(): CursorPerformance | undefined {
  const p = queue.shift()
  if (p) playingUntil = Date.now() + perfDuration(p)
  return p
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

// ---- agent session ----------------------------------------------------------

/** How long after the last tool call the agent's turn is considered over. */
const SESSION_IDLE_MS = 60_000

let sessionUntil = 0

/**
 * Every tool call — reads included — keeps the agent's session alive. The
 * cursor stays parked on stage between actions for the whole turn and only
 * bows out once the tools have gone quiet this long; the next prompt's first
 * tool call brings it back.
 */
export function touchAgentSession(): void {
  sessionUntil = Date.now() + SESSION_IDLE_MS
  wake?.()
}

export function sessionRemainingMs(): number {
  return Math.max(0, sessionUntil - Date.now())
}

/**
 * The agent said it is finished (wrap_up): end the session as soon as the
 * queued performances have played, instead of waiting out the idle window.
 * Call only after any farewell glance is already enqueued — the wake makes
 * the cursor play what is queued and then bow out.
 */
export function endAgentSession(): void {
  sessionUntil = 0
  wake?.()
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
 * Resolves once the performance has fully played, so tool handlers can hold
 * their reply until the human has seen the change happen.
 */
export function choreograph(opts: {
  tool: string
  summary: string
  before: AisleState
  after: AisleState
  touched: string[]
}): Promise<void> {
  if (reducedMotion() || (typeof document !== 'undefined' && document.hidden)) return Promise.resolve()
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
  const waits: Promise<void>[] = []
  // Chip delays are relative to now; if the cursor is mid-act, push them out.
  const lead = estimatedBacklogMs()
  let escorted = false

  if (moved.length > 0 && moved.length <= ESCORT_MAX) {
    escorted = true
    // Pick each guest up and carry them to their seat, chip in tow.
    let t = lead
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
    waits.push(enqueuePerformance({ steps, synced: true }))
  } else if (moved.length > ESCORT_MAX) {
    escorted = true
    // Too many to carry one by one — walk the room table by table instead.
    // The cursor stops at each destination and that table's chips lift off as
    // it arrives, so the human watches the arrangement assemble in order.
    const groups: { x: number; y: number; label: string; ids: string[] }[] = []
    for (const tid of after.tableOrder) {
      const table = after.tables[tid]
      const ids = moved.filter((id) => after.seating[id]?.tableId === tid)
      if (!table || ids.length === 0) continue
      groups.push({ x: table.x, y: table.y, label: `Seating ${table.name}`, ids })
      visitedTables.add(tid)
    }
    const toLounge = moved.filter((id) => !after.seating[id])
    if (toLounge.length) {
      const tray = trayRect(after.venueDimensions)
      groups.push({ x: tray.x + tray.w / 2, y: tray.y - 26, label: 'Back to the lounge', ids: toLounge })
    }
    const perStop = Math.min(1500, Math.max(700, STAGED_TOTAL_MS / groups.length))
    const fly = Math.round(perStop * 0.45)
    const hold = Math.round(perStop * 0.55)
    let t = lead
    for (const g of groups) {
      steps.push({
        x: g.x,
        y: g.y,
        label: `${g.label} · ${g.ids.length}`,
        gesture: 'point',
        durationMs: fly,
        holdMs: hold,
      })
      t += fly
      const stagger = Math.min(90, Math.round(hold / g.ids.length))
      g.ids.forEach((id, j) => setChipDelay(id, t + j * stagger))
      t += hold
    }
    waits.push(enqueuePerformance({ steps, synced: true }))
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
      waits.push(enqueuePerformance({ steps: extra }))
    }
  }

  return Promise.all(waits).then(() => undefined)
}

/** A label-only beat where the cursor stands (materializing it if needed) —
 *  read-only tools and narration speak through this, so thinking is visible
 *  too. Resolves when the beat has played. */
export function glance(label: string): Promise<void> {
  return enqueuePerformance({
    steps: [{ x: 0, y: 0, stay: true, label, gesture: 'point', holdMs: 1200 }],
  })
}
