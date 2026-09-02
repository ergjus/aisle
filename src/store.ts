import { create } from 'zustand'
import type {
  AgentLogEntry,
  AisleState,
  Constraint,
  Guest,
  HumanQuestion,
  PersonalizedDemoConfig,
  RSVP,
  SeatAssignment,
  Table,
  TableShape,
  VenueFeature,
  VenueFeatureId,
  VenueDimensions,
  ZoneId,
} from './types'
import { ROOM, WALL_MARGIN, containDelta, featureBounds, findFreeSpot, freshVenue, freshVenueDimensions, legacyFittedRoomRect, roomRect, stageUnitsPerFoot, tableBounds } from './geometry'
import { planPersonalizedSample, type PersonalizedPlannerResult } from './onboarding/planner'

export function uid(): string {
  return Math.random().toString(36).slice(2, 9)
}

/** Omit that distributes over unions, so constraint variants keep their shape. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

export const CHART_STORAGE_KEY = 'aisle:v1'
const MAX_UNDO = 60

function emptyCore(): AisleState {
  return {
    layoutVersion: 3,
    guests: {},
    guestOrder: [],
    tables: {},
    tableOrder: [],
    constraints: [],
    seating: {},
    finalized: false,
    groupOrder: [],
    venue: freshVenue(),
    venueDimensions: freshVenueDimensions(),
    demoMetadata: null,
    pinned: {},
  }
}

/** A pin only means something while its guest has a seat — drop the rest. */
function prunePins(seating: Record<string, SeatAssignment>, pinned: Record<string, true> | undefined): Record<string, true> {
  const next: Record<string, true> = {}
  for (const id of Object.keys(pinned ?? {})) if (seating[id]) next[id] = true
  return next
}

function coreOf(s: StoreState): AisleState {
  return {
    layoutVersion: s.layoutVersion ?? 3,
    guests: s.guests,
    guestOrder: s.guestOrder,
    tables: s.tables,
    tableOrder: s.tableOrder,
    constraints: s.constraints,
    seating: s.seating,
    finalized: s.finalized,
    groupOrder: s.groupOrder,
    venue: s.venue,
    venueDimensions: s.venueDimensions,
    demoMetadata: s.demoMetadata,
    pinned: s.pinned ?? {},
  }
}

/** The next free "Table N", so a new table never doubles up on a name a
 *  removal left behind or the sample already claimed. */
export function nextTableName(existing: string[]): string {
  const taken = new Set(existing.map((name) => name.trim().toLowerCase()))
  for (let n = 1; ; n++) {
    const name = `Table ${n}`
    if (!taken.has(name.toLowerCase())) return name
  }
}

/** Appends `group` to `order` if it isn't already present (exact match). */
function withGroup(order: string[], group: string): string[] {
  return order.includes(group) ? order : [...order, group]
}

/** Backfills groupOrder with any guest groups it's missing, in first-appearance order. */
function reconcileGroupOrder(s: AisleState): string[] {
  let order = s.groupOrder ?? []
  for (const id of s.guestOrder) order = withGroup(order, s.guests[id].group)
  return order
}

export interface RuleHighlight {
  guestIds: string[]
  zone: ZoneId | null
}

export interface Selection {
  kind: 'guest' | 'table'
  id: string
  /** Screen coords where the editor card should appear. */
  at: { x: number; y: number }
}

export interface UndoEntry {
  state: AisleState
  /** Short name of the action this snapshot precedes, e.g. "seat guest". */
  label: string
}

/** A seating arrangement the agent has applied *as a question* — it stays on
 *  the chart under a Keep/Revert banner until the human rules on it. */
export interface Proposal {
  id: string
  /** Banner line, e.g. "a fresh arrangement for the whole room". */
  summary: string
  moved: number
  /** Seating to restore if the human reverts. */
  beforeSeating: Record<string, SeatAssignment>
  at: number
}

export interface Checkpoint {
  name: string
  state: AisleState
  at: number
}

export interface StoreState extends AisleState {
  agentConnected: boolean
  webmcpAvailable: boolean
  toolNames: string[]
  agentLog: AgentLogEntry[]
  touched: Record<string, number>
  selection: Selection | null
  draggingGuest: string | null
  /** Rule the user is hovering in the sidebar — the canvas spotlights the guests and zone involved. */
  ruleHighlight: RuleHighlight | null
  undoStack: UndoEntry[]
  redoStack: UndoEntry[]
  toast: string | null
  /** Whether the export composer dialog is open. */
  exportOpen: boolean
  /** Bumped on every requestExport, so an already-open dialog reloads its options. */
  exportRequest: number
  /** The agent proposal currently awaiting the human's Keep/Revert, if any. */
  proposal: Proposal | null
  /** How the last proposal ended — lets a waiting tool call read the outcome. */
  lastProposalDecision: { id: string; decision: 'keep' | 'revert'; at: number } | null
  /** Named session-only save points (agent- or console-created). */
  checkpoints: Record<string, Checkpoint>
  /** A question the agent has asked; it sits on the canvas until answered. */
  question: HumanQuestion | null
  /** How the last question was answered — lets the waiting tool call read the reply. */
  lastAnswer: { id: string; answer: string; at: number } | null

  snapshot: (label?: string) => void
  undo: () => boolean
  redo: () => boolean

  addGuest: (fields: Partial<Guest> & { name: string }) => Guest
  updateGuest: (id: string, patch: Partial<Omit<Guest, 'id'>>) => void
  removeGuest: (id: string) => void
  importGuests: (entries: { name: string; group?: string; dietary?: string[]; rsvp?: RSVP; notes?: string }[]) => Guest[]

  /** Creates a group with no guests yet (or returns the existing name if one already matches, case-insensitively). */
  addGroup: (name: string) => string | null
  /** Removes a group that has no guests in it. No-op otherwise. */
  removeGroup: (name: string) => void

  addTable: (fields?: Partial<Omit<Table, 'id'>>, opts?: { snapshot?: boolean }) => Table
  updateTable: (id: string, patch: Partial<Omit<Table, 'id'>>, opts?: { snapshot?: boolean }) => { unseated: string[] }
  removeTable: (id: string) => { unseated: string[] }
  moveTable: (id: string, x: number, y: number, opts?: { snapshot?: boolean }) => void
  updateVenueFeature: (
    id: VenueFeatureId,
    patch: Partial<Omit<VenueFeature, 'id'>>,
    opts?: { snapshot?: boolean },
  ) => void
  updateVenueDimensions: (patch: Partial<VenueDimensions>, opts?: { snapshot?: boolean }) => void

  addConstraint: (c: DistributiveOmit<Constraint, 'id'> & { id?: string }) => Constraint
  removeConstraint: (id: string) => void

  seatGuest: (guestId: string, tableId: string, seat?: number) => { ok: boolean; seat?: number; error?: string }
  /** Pin (or unpin) a seated guest so the solver and the agent leave them where they are. */
  pinGuest: (guestId: string, pinned: boolean) => boolean
  unseatGuest: (guestId: string) => void
  swapGuests: (a: string, b: string) => void
  clearSeating: () => void
  applyArrangement: (assignments: Record<string, SeatAssignment>) => void

  loadSample: (sample: { guests: Guest[]; tables: Table[]; constraints: Constraint[] }) => void
  loadPersonalizedSample: (config: PersonalizedDemoConfig) => PersonalizedPlannerResult
  resetAll: () => void
  setFinalized: (v: boolean) => void

  /** Open the export composer (used by the header button and the agent's export_chart tool). */
  requestExport: () => void
  setExportOpen: (v: boolean) => void

  beginProposal: (p: Omit<Proposal, 'at'>) => void
  /** The human's verdict on the pending proposal; 'revert' restores the seating it replaced. */
  resolveProposal: (decision: 'keep' | 'revert', source?: 'agent' | 'you') => void
  saveCheckpoint: (name: string) => Checkpoint
  restoreCheckpoint: (name: string) => Checkpoint | null

  /** The agent puts a question to the human; it appears as a card on the canvas. */
  askHuman: (q: Omit<HumanQuestion, 'at'>) => void
  /** The human's reply (an empty string means they skipped it). */
  answerQuestion: (id: string, answer: string) => void

  setAgentConnected: () => void
  setWebmcp: (available: boolean, toolNames: string[]) => void
  logActivity: (tool: string, summary: string, source?: 'agent' | 'you') => void
  clearActivity: () => void
  markTouched: (ids: string[]) => void
  setSelection: (sel: Selection | null) => void
  setDraggingGuest: (id: string | null) => void
  setRuleHighlight: (h: RuleHighlight | null) => void
  setToast: (msg: string | null) => void
}

function loadPersisted(): AisleState {
  try {
    const raw = localStorage.getItem(CHART_STORAGE_KEY)
    if (!raw) return emptyCore()
    const parsed = JSON.parse(raw)
    const sourceLayoutVersion = Number(parsed.layoutVersion ?? 1)
    const defaults = emptyCore()
    let merged = {
      ...defaults,
      ...parsed,
      layoutVersion: 3,
      venue: Object.fromEntries(
        Object.entries(defaults.venue).map(([id, feature]) => [id, { ...feature, ...(parsed.venue?.[id] ?? {}), rotation: parsed.venue?.[id]?.rotation ?? 0 }]),
      ) as AisleState['venue'],
      venueDimensions: { ...defaults.venueDimensions, ...(parsed.venueDimensions ?? {}) },
      demoMetadata: parsed.demoMetadata ?? null,
      tables: Object.fromEntries(
        Object.entries(parsed.tables ?? {}).map(([id, table]) => [id, { ...(table as Table), rotation: (table as Table).rotation ?? 0 }]),
      ),
    }
    const dimensions = merged.venueDimensions
    const room = roomRect(dimensions)
    const units = stageUnitsPerFoot(dimensions)

    // Older layouts projected the room into a fixed abstract rectangle —
    // v1 stretched it, v2 aspect-fitted it. v3 draws the room at its true
    // size (a fixed scale per foot), so reproject saved coordinates once,
    // from whichever projection they were stored in.
    if (sourceLayoutVersion < 3) {
      const oldRoom = sourceLayoutVersion < 2 ? ROOM : legacyFittedRoomRect(dimensions)
      const oldUnits = { x: oldRoom.w / dimensions.widthFt, y: oldRoom.h / dimensions.lengthFt }
      merged = {
        ...merged,
        tables: Object.fromEntries(
          Object.entries(merged.tables as Record<string, Table>).map(([id, table]) => [id, {
            ...table,
            x: room.x + ((table.x - oldRoom.x) / oldUnits.x) * units.x,
            y: room.y + ((table.y - oldRoom.y) / oldUnits.y) * units.y,
          }]),
        ) as AisleState['tables'],
        venue: Object.fromEntries(
          Object.entries(merged.venue as Record<VenueFeatureId, VenueFeature>).map(([id, feature]) => [id, {
            ...feature,
            x: room.x + ((feature.x - oldRoom.x) / oldUnits.x) * units.x,
            y: room.y + ((feature.y - oldRoom.y) / oldUnits.y) * units.y,
            w: (feature.w / oldUnits.x) * units.x,
            h: (feature.h / oldUnits.y) * units.y,
          }]),
        ) as AisleState['venue'],
      }
    }

    // Keep every persisted item recoverable even if a room was made smaller.
    merged.tables = Object.fromEntries(
      Object.entries(merged.tables as Record<string, Table>).map(([id, table]) => {
        const { dx, dy } = containDelta(tableBounds(table, dimensions), room)
        return [id, { ...table, x: table.x + dx, y: table.y + dy }]
      }),
    ) as AisleState['tables']
    merged.venue = Object.fromEntries(
      Object.entries(merged.venue as Record<VenueFeatureId, VenueFeature>).map(([id, feature]) => {
        const resized = { ...feature, w: Math.min(feature.w, room.w - WALL_MARGIN * 2), h: Math.min(feature.h, room.h - WALL_MARGIN * 2) }
        const { dx, dy } = containDelta(featureBounds(resized), room)
        return [id, { ...resized, x: resized.x + dx, y: resized.y + dy }]
      }),
    ) as AisleState['venue']
    return { ...merged, groupOrder: reconcileGroupOrder(merged), pinned: prunePins(merged.seating, merged.pinned) }
  } catch {
    return emptyCore()
  }
}

/** Lowest free seat index at a table, or -1 when full. */
export function freeSeatAt(state: AisleState, tableId: string, taken?: Set<number>): number {
  const table = state.tables[tableId]
  if (!table) return -1
  const used = taken ?? new Set(
    Object.values(state.seating)
      .filter((s) => s.tableId === tableId)
      .map((s) => s.seat),
  )
  for (let i = 0; i < table.seats; i++) if (!used.has(i)) return i
  return -1
}

export function occupantsOf(state: AisleState, tableId: string): string[] {
  return Object.keys(state.seating)
    .filter((gid) => state.seating[gid].tableId === tableId)
    .sort((a, b) => state.seating[a].seat - state.seating[b].seat)
}

export const useStore = create<StoreState>((set, get) => ({
  ...loadPersisted(),
  agentConnected: false,
  webmcpAvailable: false,
  toolNames: [],
  agentLog: [],
  touched: {},
  selection: null,
  draggingGuest: null,
  ruleHighlight: null,
  undoStack: [],
  redoStack: [],
  toast: null,
  exportOpen: false,
  exportRequest: 0,
  proposal: null,
  lastProposalDecision: null,
  checkpoints: {},
  question: null,
  lastAnswer: null,

  snapshot: (label = 'change') => {
    const s = get()
    // A new action while an agent proposal is pending builds on top of it —
    // that adopts the proposal as the new baseline, so record it as kept.
    if (s.proposal) {
      set({
        proposal: null,
        lastProposalDecision: { id: s.proposal.id, decision: 'keep', at: Date.now() },
      })
    }
    const stack = [...s.undoStack, { state: structuredClone(coreOf(s)), label }]
    if (stack.length > MAX_UNDO) stack.shift()
    set({ undoStack: stack, redoStack: [] })
  },

  undo: () => {
    const s = get()
    const prev = s.undoStack[s.undoStack.length - 1]
    if (!prev) return false
    // Undoing while a proposal is pending IS the human's verdict: revert.
    if (s.proposal) {
      set({
        proposal: null,
        lastProposalDecision: { id: s.proposal.id, decision: 'revert', at: Date.now() },
      })
    }
    set({
      ...prev.state,
      undoStack: s.undoStack.slice(0, -1),
      redoStack: [...s.redoStack, { state: structuredClone(coreOf(s)), label: prev.label }],
      selection: null,
    })
    get().logActivity('undo', `Undid: ${prev.label}.`, 'you')
    return true
  },

  redo: () => {
    const s = get()
    const next = s.redoStack[s.redoStack.length - 1]
    if (!next) return false
    set({
      ...next.state,
      redoStack: s.redoStack.slice(0, -1),
      undoStack: [...s.undoStack, { state: structuredClone(coreOf(s)), label: next.label }],
      selection: null,
    })
    get().logActivity('redo', `Redid: ${next.label}.`, 'you')
    return true
  },

  addGuest: (fields) => {
    get().snapshot('add guest')
    const guest: Guest = {
      id: uid(),
      name: fields.name.trim(),
      group: (fields.group ?? 'Guests').trim() || 'Guests',
      dietary: fields.dietary ?? [],
      rsvp: fields.rsvp ?? 'yes',
      notes: fields.notes,
    }
    set((s) => ({
      guests: { ...s.guests, [guest.id]: guest },
      guestOrder: [...s.guestOrder, guest.id],
      groupOrder: withGroup(s.groupOrder, guest.group),
      finalized: false,
      demoMetadata: null,
    }))
    return guest
  },

  updateGuest: (id, patch) => {
    const s = get()
    if (!s.guests[id]) return
    s.snapshot('edit guest')
    set((st) => {
      const next: Guest = { ...st.guests[id], ...patch, id }
      const seating = { ...st.seating }
      // A guest who declined gives up their seat.
      if (next.rsvp === 'no' && seating[id]) delete seating[id]
      return {
        guests: { ...st.guests, [id]: next },
        seating,
        pinned: prunePins(seating, st.pinned),
        groupOrder: withGroup(st.groupOrder, next.group),
        finalized: false,
      }
    })
  },

  removeGuest: (id) => {
    const s = get()
    if (!s.guests[id]) return
    s.snapshot('remove guest')
    set((st) => {
      const guests = { ...st.guests }
      delete guests[id]
      const seating = { ...st.seating }
      delete seating[id]
      return {
        guests,
        seating,
        pinned: prunePins(seating, st.pinned),
        guestOrder: st.guestOrder.filter((g) => g !== id),
        constraints: st.constraints.filter((c) =>
          c.type === 'zone' ? c.guestId !== id : c.a !== id && c.b !== id,
        ),
        selection: st.selection?.id === id ? null : st.selection,
        finalized: false,
        demoMetadata: null,
      }
    })
  },

  addGroup: (name) => {
    const trimmed = name.trim()
    if (!trimmed) return null
    const s = get()
    const existing = s.groupOrder.find((g) => g.toLowerCase() === trimmed.toLowerCase())
    if (existing) return existing
    s.snapshot('add group')
    set((st) => ({ groupOrder: [...st.groupOrder, trimmed] }))
    return trimmed
  },

  removeGroup: (name) => {
    const s = get()
    if (!s.groupOrder.includes(name)) return
    if (s.guestOrder.some((id) => s.guests[id].group === name)) return
    s.snapshot('remove group')
    set((st) => ({ groupOrder: st.groupOrder.filter((g) => g !== name) }))
  },

  importGuests: (entries) => {
    if (entries.length === 0) return []
    get().snapshot('import guests')
    const added: Guest[] = []
    set((s) => {
      const guests = { ...s.guests }
      const order = [...s.guestOrder]
      let groupOrder = s.groupOrder
      const existing = new Set(Object.values(s.guests).map((g) => g.name.toLowerCase()))
      for (const e of entries) {
        const name = e.name.trim()
        if (!name || existing.has(name.toLowerCase())) continue
        existing.add(name.toLowerCase())
        const g: Guest = {
          id: uid(),
          name,
          group: (e.group ?? 'Guests').trim() || 'Guests',
          dietary: e.dietary ?? [],
          rsvp: e.rsvp ?? 'yes',
          notes: e.notes,
        }
        guests[g.id] = g
        order.push(g.id)
        groupOrder = withGroup(groupOrder, g.group)
        added.push(g)
      }
      return { guests, guestOrder: order, groupOrder, finalized: false, demoMetadata: added.length > 0 ? null : s.demoMetadata }
    })
    return added
  },

  addTable: (fields = {}, opts) => {
    const s = get()
    // Adding a row of tables at once is one action to undo, not one per table.
    if (opts?.snapshot !== false) s.snapshot('add table')
    const draft: Table = {
      id: uid(),
      name: fields.name?.trim() || nextTableName(s.tableOrder.map((id) => s.tables[id].name)),
      shape: (fields.shape as TableShape) ?? 'round',
      seats: Math.max(2, Math.min(16, fields.seats ?? 8)),
      x: 0,
      y: 0,
      rotation: fields.rotation ?? 0,
    }
    // An open spot has to fit *this* table's chairs, so the search knows its size.
    const spot = fields.x !== undefined && fields.y !== undefined
      ? { x: fields.x, y: fields.y }
      : findFreeSpot(coreOf(s), draft)
    const room = roomRect(s.venueDimensions)
    const placed = { ...draft, x: spot.x, y: spot.y }
    const { dx, dy } = containDelta(tableBounds(placed, s.venueDimensions), room)
    const table: Table = { ...placed, x: placed.x + dx, y: placed.y + dy }
    set((st) => ({
      tables: { ...st.tables, [table.id]: table },
      tableOrder: [...st.tableOrder, table.id],
      finalized: false,
      demoMetadata: null,
    }))
    return table
  },

  updateTable: (id, patch, opts) => {
    const s = get()
    const table = s.tables[id]
    if (!table) return { unseated: [] }
    if (opts?.snapshot !== false) s.snapshot('edit table')
    const unseated: string[] = []
    set((st) => {
      let next: Table = {
        ...table,
        ...patch,
        seats: patch.seats !== undefined ? Math.max(2, Math.min(16, patch.seats)) : table.seats,
        id,
      }
      const room = roomRect(st.venueDimensions)
      // A table that grew a seat can outgrow its corner — walk it back in.
      const { dx, dy } = containDelta(tableBounds(next, st.venueDimensions), room)
      next = { ...next, x: next.x + dx, y: next.y + dy }
      const seating = { ...st.seating }
      // Shrinking a table bumps the highest seat numbers back to the lounge.
      const occupants = occupantsOf(st, id)
      for (const gid of occupants) {
        if (seating[gid].seat >= next.seats) {
          delete seating[gid]
          unseated.push(gid)
        }
      }
      return { tables: { ...st.tables, [id]: next }, seating, pinned: prunePins(seating, st.pinned), finalized: false }
    })
    return { unseated }
  },

  removeTable: (id) => {
    const s = get()
    if (!s.tables[id]) return { unseated: [] }
    s.snapshot('remove table')
    const unseated = occupantsOf(s, id)
    set((st) => {
      const tables = { ...st.tables }
      delete tables[id]
      const seating = { ...st.seating }
      for (const gid of unseated) delete seating[gid]
      return {
        tables,
        seating,
        pinned: prunePins(seating, st.pinned),
        tableOrder: st.tableOrder.filter((t) => t !== id),
        selection: st.selection?.id === id ? null : st.selection,
        finalized: false,
        demoMetadata: null,
      }
    })
    return { unseated }
  },

  moveTable: (id, x, y, opts) => {
    const s = get()
    if (!s.tables[id]) return
    if (opts?.snapshot) s.snapshot('move table')
    set((st) => ({
      tables: { ...st.tables, [id]: { ...st.tables[id], x, y } },
    }))
  },

  updateVenueFeature: (id, patch, opts) => {
    const s = get()
    if (!s.venue[id]) return
    if (opts?.snapshot !== false) s.snapshot(patch.enabled === undefined ? 'move venue feature' : 'update venue')
    set((st) => {
      const room = roomRect(st.venueDimensions)
      let next = { ...st.venue[id], ...patch, id }
      const { dx, dy } = containDelta(featureBounds(next), room)
      next = { ...next, x: next.x + dx, y: next.y + dy }
      return { venue: { ...st.venue, [id]: next }, finalized: false }
    })
  },

  updateVenueDimensions: (patch, opts) => {
    const current = get()
    const nextDimensions: VenueDimensions = {
      widthFt: Math.max(20, Math.min(300, patch.widthFt ?? current.venueDimensions.widthFt)),
      lengthFt: Math.max(15, Math.min(200, patch.lengthFt ?? current.venueDimensions.lengthFt)),
      snapFt: Math.max(0, Math.min(10, patch.snapFt ?? current.venueDimensions.snapFt)),
    }
    if (
      nextDimensions.widthFt === current.venueDimensions.widthFt &&
      nextDimensions.lengthFt === current.venueDimensions.lengthFt &&
      nextDimensions.snapFt === current.venueDimensions.snapFt
    ) return
    if (opts?.snapshot !== false) current.snapshot('update venue dimensions')
    set((st) => {
      // The floor-plan scale is fixed, so resizing the room adds or removes
      // floor space around the furniture rather than stretching the layout.
      // Anything a shrink would strand outside the walls gets nudged back in.
      const nextRoom = roomRect(nextDimensions)
      const tables = Object.fromEntries(
        Object.entries(st.tables).map(([id, table]) => {
          const { dx, dy } = containDelta(tableBounds(table, nextDimensions), nextRoom)
          return [id, { ...table, x: table.x + dx, y: table.y + dy }]
        }),
      ) as AisleState['tables']
      const venue = Object.fromEntries(
        Object.entries(st.venue).map(([id, feature]) => {
          let next = {
            ...feature,
            w: Math.min(feature.w, nextRoom.w - WALL_MARGIN * 2),
            h: Math.min(feature.h, nextRoom.h - WALL_MARGIN * 2),
          }
          const { dx, dy } = containDelta(featureBounds(next), nextRoom)
          next = { ...next, x: next.x + dx, y: next.y + dy }
          return [id, next]
        }),
      ) as AisleState['venue']
      return { venueDimensions: nextDimensions, tables, venue, finalized: false }
    })
  },

  addConstraint: (c) => {
    get().snapshot('add rule')
    const full = { ...c, id: c.id ?? uid() } as Constraint
    set((s) => ({ constraints: [...s.constraints, full], finalized: false }))
    return full
  },

  removeConstraint: (id) => {
    get().snapshot('remove rule')
    set((s) => ({ constraints: s.constraints.filter((c) => c.id !== id), finalized: false }))
  },

  seatGuest: (guestId, tableId, seat) => {
    const s = get()
    if (!s.guests[guestId]) return { ok: false, error: 'Unknown guest' }
    const table = s.tables[tableId]
    if (!table) return { ok: false, error: 'Unknown table' }
    let target = seat
    const taken = new Set(
      Object.entries(s.seating)
        .filter(([gid, a]) => a.tableId === tableId && gid !== guestId)
        .map(([, a]) => a.seat),
    )
    if (target === undefined || target < 0 || target >= table.seats || taken.has(target)) {
      target = freeSeatAt(coreOf(s), tableId, taken)
    }
    if (target === -1) return { ok: false, error: `${table.name} is full (${table.seats} seats)` }
    s.snapshot('seat guest')
    set((st) => ({
      seating: { ...st.seating, [guestId]: { tableId, seat: target! } },
      finalized: false,
    }))
    return { ok: true, seat: target }
  },

  pinGuest: (guestId, pinned) => {
    const s = get()
    if (!s.guests[guestId]) return false
    // Only a seat can be pinned — a pin means "keep them exactly here".
    if (pinned && !s.seating[guestId]) return false
    if (Boolean(s.pinned[guestId]) === pinned) return true
    s.snapshot(pinned ? 'pin seat' : 'unpin seat')
    set((st) => {
      const next = { ...st.pinned }
      if (pinned) next[guestId] = true
      else delete next[guestId]
      return { pinned: next, finalized: false }
    })
    return true
  },

  unseatGuest: (guestId) => {
    const s = get()
    if (!s.seating[guestId]) return
    s.snapshot('unseat guest')
    set((st) => {
      const seating = { ...st.seating }
      delete seating[guestId]
      return { seating, pinned: prunePins(seating, st.pinned), finalized: false }
    })
  },

  swapGuests: (a, b) => {
    const s = get()
    const sa = s.seating[a]
    const sb = s.seating[b]
    if (!sa && !sb) return
    s.snapshot('swap guests')
    set((st) => {
      const seating = { ...st.seating }
      if (sa) seating[b] = sa
      else delete seating[b]
      if (sb) seating[a] = sb
      else delete seating[a]
      return { seating, pinned: prunePins(seating, st.pinned), finalized: false }
    })
  },

  clearSeating: () => {
    get().snapshot('clear seating')
    set({ seating: {}, pinned: {}, finalized: false })
  },

  applyArrangement: (assignments) => {
    get().snapshot('auto-arrange')
    set((st) => ({ seating: { ...assignments }, pinned: prunePins(assignments, st.pinned), finalized: false }))
  },

  loadSample: (sample) => {
    get().snapshot('load sample wedding')
    let groupOrder: string[] = []
    for (const g of sample.guests) groupOrder = withGroup(groupOrder, g.group)
    set({
      guests: Object.fromEntries(sample.guests.map((g) => [g.id, g])),
      guestOrder: sample.guests.map((g) => g.id),
      tables: Object.fromEntries(sample.tables.map((t) => [t.id, t])),
      tableOrder: sample.tables.map((t) => t.id),
      constraints: sample.constraints,
      seating: {},
      pinned: {},
      finalized: false,
      selection: null,
      groupOrder,
      venue: freshVenue(),
      venueDimensions: freshVenueDimensions(),
      demoMetadata: null,
    })
  },

  loadPersonalizedSample: (config) => {
    const result = planPersonalizedSample(config)
    if (!result.ok) return result
    get().snapshot('load personalized sample')
    set({
      ...result.state,
      selection: null,
      draggingGuest: null,
    })
    return result
  },

  resetAll: () => {
    get().snapshot('reset')
    set({ ...emptyCore(), selection: null })
  },

  setFinalized: (v) => set({ finalized: v }),

  requestExport: () => set((s) => ({ exportOpen: true, exportRequest: s.exportRequest + 1 })),
  setExportOpen: (v) => set({ exportOpen: v }),

  beginProposal: (p) => set({ proposal: { ...p, at: Date.now() }, lastProposalDecision: null }),

  resolveProposal: (decision, source = 'you') => {
    const s = get()
    const p = s.proposal
    if (!p) return
    // Clear first, so a revert's own snapshot can't auto-adopt the proposal.
    set({ proposal: null, lastProposalDecision: { id: p.id, decision, at: Date.now() } })
    if (decision === 'revert') {
      get().snapshot('revert proposal')
      const restored = structuredClone(p.beforeSeating)
      const current = get().seating
      const seatKey = (a?: SeatAssignment) => (a ? `${a.tableId}:${a.seat}` : '')
      const moved = get().guestOrder.filter((id) => seatKey(current[id]) !== seatKey(restored[id]))
      const tables = new Set(
        moved.flatMap((id) => [current[id]?.tableId, restored[id]?.tableId]).filter(Boolean) as string[],
      )
      set((st) => ({ seating: restored, pinned: prunePins(restored, st.pinned), finalized: false }))
      get().markTouched([...moved, ...tables])
      get().logActivity('proposal', 'Reverted the agent’s proposal — the room is back how it was.', source)
    } else {
      get().logActivity('proposal', `Kept the agent’s proposal (${p.moved} move${p.moved === 1 ? '' : 's'}).`, source)
    }
  },

  saveCheckpoint: (name) => {
    const cp: Checkpoint = { name, state: structuredClone(coreOf(get())), at: Date.now() }
    set((s) => ({ checkpoints: { ...s.checkpoints, [name]: cp } }))
    return cp
  },

  restoreCheckpoint: (name) => {
    const cp = get().checkpoints[name]
    if (!cp) return null
    get().snapshot(`restore checkpoint "${name}"`)
    set({ ...structuredClone(cp.state), selection: null })
    return cp
  },

  askHuman: (q) => set({ question: { ...q, at: Date.now() }, lastAnswer: null }),

  answerQuestion: (id, answer) => {
    const q = get().question
    if (!q || q.id !== id) return
    set({ question: null, lastAnswer: { id, answer, at: Date.now() } })
    get().logActivity(
      'answer',
      answer.trim() ? `Answered the agent: “${answer.trim()}”` : 'Skipped the agent’s question.',
      'you',
    )
  },

  setAgentConnected: () => {
    if (!get().agentConnected) set({ agentConnected: true })
  },

  setWebmcp: (available, toolNames) => set({ webmcpAvailable: available, toolNames }),

  logActivity: (tool, summary, source = 'agent') => {
    set((s) => ({
      agentLog: [{ id: uid(), time: Date.now(), tool, summary, source }, ...s.agentLog].slice(0, 80),
    }))
  },

  clearActivity: () => set({ agentLog: [] }),

  markTouched: (ids) => {
    if (ids.length === 0) return
    const now = Date.now()
    set((s) => {
      const touched = { ...s.touched }
      for (const id of ids) touched[id] = now
      return { touched }
    })
  },

  setSelection: (sel) => set({ selection: sel }),
  setDraggingGuest: (id) => set({ draggingGuest: id }),
  setRuleHighlight: (h) => set({ ruleHighlight: h }),
  setToast: (msg) => set({ toast: msg }),
}))

// ---- persistence -----------------------------------------------------------

let saveTimer: ReturnType<typeof setTimeout> | undefined
useStore.subscribe((s) => {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(CHART_STORAGE_KEY, JSON.stringify(coreOf(s)))
    } catch {
      // Storage full or unavailable; the session simply won't persist.
    }
  }, 300)
})

export function getCore(): AisleState {
  return coreOf(useStore.getState())
}
