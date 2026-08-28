import { create } from 'zustand'
import type {
  AgentLogEntry,
  AisleState,
  Constraint,
  Guest,
  RSVP,
  SeatAssignment,
  Table,
  TableShape,
} from './types'
import { findFreeSpot } from './geometry'

export function uid(): string {
  return Math.random().toString(36).slice(2, 9)
}

/** Omit that distributes over unions, so constraint variants keep their shape. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

const STORAGE_KEY = 'aisle:v1'
const MAX_UNDO = 60

function emptyCore(): AisleState {
  return {
    guests: {},
    guestOrder: [],
    tables: {},
    tableOrder: [],
    constraints: [],
    seating: {},
    finalized: false,
  }
}

function coreOf(s: StoreState): AisleState {
  return {
    guests: s.guests,
    guestOrder: s.guestOrder,
    tables: s.tables,
    tableOrder: s.tableOrder,
    constraints: s.constraints,
    seating: s.seating,
    finalized: s.finalized,
  }
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

export interface StoreState extends AisleState {
  agentConnected: boolean
  webmcpAvailable: boolean
  toolNames: string[]
  agentLog: AgentLogEntry[]
  touched: Record<string, number>
  selection: Selection | null
  draggingGuest: string | null
  undoStack: UndoEntry[]
  redoStack: UndoEntry[]
  toast: string | null

  snapshot: (label?: string) => void
  undo: () => boolean
  redo: () => boolean

  addGuest: (fields: Partial<Guest> & { name: string }) => Guest
  updateGuest: (id: string, patch: Partial<Omit<Guest, 'id'>>) => void
  removeGuest: (id: string) => void
  importGuests: (entries: { name: string; group?: string; dietary?: string[]; rsvp?: RSVP; notes?: string }[]) => Guest[]

  addTable: (fields?: Partial<Omit<Table, 'id'>>) => Table
  updateTable: (id: string, patch: Partial<Omit<Table, 'id'>>) => { unseated: string[] }
  removeTable: (id: string) => { unseated: string[] }
  moveTable: (id: string, x: number, y: number, opts?: { snapshot?: boolean }) => void

  addConstraint: (c: DistributiveOmit<Constraint, 'id'> & { id?: string }) => Constraint
  removeConstraint: (id: string) => void

  seatGuest: (guestId: string, tableId: string, seat?: number) => { ok: boolean; seat?: number; error?: string }
  unseatGuest: (guestId: string) => void
  swapGuests: (a: string, b: string) => void
  clearSeating: () => void
  applyArrangement: (assignments: Record<string, SeatAssignment>) => void

  loadSample: (sample: { guests: Guest[]; tables: Table[]; constraints: Constraint[] }) => void
  resetAll: () => void
  setFinalized: (v: boolean) => void

  setAgentConnected: () => void
  setWebmcp: (available: boolean, toolNames: string[]) => void
  logActivity: (tool: string, summary: string, source?: 'agent' | 'you') => void
  markTouched: (ids: string[]) => void
  setSelection: (sel: Selection | null) => void
  setDraggingGuest: (id: string | null) => void
  setToast: (msg: string | null) => void
}

function loadPersisted(): AisleState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyCore()
    const parsed = JSON.parse(raw)
    return { ...emptyCore(), ...parsed }
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
  undoStack: [],
  redoStack: [],
  toast: null,

  snapshot: (label = 'change') => {
    const s = get()
    const stack = [...s.undoStack, { state: structuredClone(coreOf(s)), label }]
    if (stack.length > MAX_UNDO) stack.shift()
    set({ undoStack: stack, redoStack: [] })
  },

  undo: () => {
    const s = get()
    const prev = s.undoStack[s.undoStack.length - 1]
    if (!prev) return false
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
      finalized: false,
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
      return { guests: { ...st.guests, [id]: next }, seating, finalized: false }
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
        guestOrder: st.guestOrder.filter((g) => g !== id),
        constraints: st.constraints.filter((c) =>
          c.type === 'zone' ? c.guestId !== id : c.a !== id && c.b !== id,
        ),
        selection: st.selection?.id === id ? null : st.selection,
        finalized: false,
      }
    })
  },

  importGuests: (entries) => {
    if (entries.length === 0) return []
    get().snapshot('import guests')
    const added: Guest[] = []
    set((s) => {
      const guests = { ...s.guests }
      const order = [...s.guestOrder]
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
        added.push(g)
      }
      return { guests, guestOrder: order, finalized: false }
    })
    return added
  },

  addTable: (fields = {}) => {
    const s = get()
    s.snapshot('add table')
    const spot = fields.x !== undefined && fields.y !== undefined
      ? { x: fields.x, y: fields.y }
      : findFreeSpot(coreOf(s))
    const table: Table = {
      id: uid(),
      name: fields.name?.trim() || `Table ${s.tableOrder.length + 1}`,
      shape: (fields.shape as TableShape) ?? 'round',
      seats: Math.max(2, Math.min(16, fields.seats ?? 8)),
      x: spot.x,
      y: spot.y,
    }
    set((st) => ({
      tables: { ...st.tables, [table.id]: table },
      tableOrder: [...st.tableOrder, table.id],
      finalized: false,
    }))
    return table
  },

  updateTable: (id, patch) => {
    const s = get()
    const table = s.tables[id]
    if (!table) return { unseated: [] }
    s.snapshot('edit table')
    const unseated: string[] = []
    set((st) => {
      const next: Table = {
        ...table,
        ...patch,
        seats: patch.seats !== undefined ? Math.max(2, Math.min(16, patch.seats)) : table.seats,
        id,
      }
      const seating = { ...st.seating }
      // Shrinking a table bumps the highest seat numbers back to the lounge.
      const occupants = occupantsOf(st, id)
      for (const gid of occupants) {
        if (seating[gid].seat >= next.seats) {
          delete seating[gid]
          unseated.push(gid)
        }
      }
      return { tables: { ...st.tables, [id]: next }, seating, finalized: false }
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
        tableOrder: st.tableOrder.filter((t) => t !== id),
        selection: st.selection?.id === id ? null : st.selection,
        finalized: false,
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

  unseatGuest: (guestId) => {
    const s = get()
    if (!s.seating[guestId]) return
    s.snapshot('unseat guest')
    set((st) => {
      const seating = { ...st.seating }
      delete seating[guestId]
      return { seating, finalized: false }
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
      return { seating, finalized: false }
    })
  },

  clearSeating: () => {
    get().snapshot('clear seating')
    set({ seating: {}, finalized: false })
  },

  applyArrangement: (assignments) => {
    get().snapshot('auto-arrange')
    set({ seating: { ...assignments }, finalized: false })
  },

  loadSample: (sample) => {
    get().snapshot('load sample wedding')
    set({
      guests: Object.fromEntries(sample.guests.map((g) => [g.id, g])),
      guestOrder: sample.guests.map((g) => g.id),
      tables: Object.fromEntries(sample.tables.map((t) => [t.id, t])),
      tableOrder: sample.tables.map((t) => t.id),
      constraints: sample.constraints,
      seating: {},
      finalized: false,
      selection: null,
    })
  },

  resetAll: () => {
    get().snapshot('reset')
    set({ ...emptyCore(), selection: null })
  },

  setFinalized: (v) => set({ finalized: v }),

  setAgentConnected: () => {
    if (!get().agentConnected) set({ agentConnected: true })
  },

  setWebmcp: (available, toolNames) => set({ webmcpAvailable: available, toolNames }),

  logActivity: (tool, summary, source = 'agent') => {
    set((s) => ({
      agentLog: [{ id: uid(), time: Date.now(), tool, summary, source }, ...s.agentLog].slice(0, 80),
    }))
  },

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
  setToast: (msg) => set({ toast: msg }),
}))

// ---- persistence -----------------------------------------------------------

let saveTimer: ReturnType<typeof setTimeout> | undefined
useStore.subscribe((s) => {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(coreOf(s)))
    } catch {
      // Storage full or unavailable; the session simply won't persist.
    }
  }, 300)
})

export function getCore(): AisleState {
  return coreOf(useStore.getState())
}
