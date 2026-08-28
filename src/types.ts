export type RSVP = 'yes' | 'no' | 'pending'

export interface Guest {
  id: string
  name: string
  /** Party/side, e.g. "Bride's family", "College friends" */
  group: string
  dietary: string[]
  rsvp: RSVP
  notes?: string
}

export type TableShape = 'round' | 'rect'

export interface Table {
  id: string
  name: string
  shape: TableShape
  seats: number
  x: number
  y: number
}

export type ZoneId = 'dance_floor' | 'band' | 'entrance'

export interface Zone {
  id: ZoneId
  label: string
  x: number
  y: number
  w: number
  h: number
}

export type Constraint =
  | { id: string; type: 'together'; a: string; b: string; note?: string }
  | { id: string; type: 'apart'; a: string; b: string; note?: string }
  | {
      id: string
      type: 'zone'
      guestId: string
      zone: ZoneId
      preference: 'near' | 'far'
      note?: string
    }

export interface SeatAssignment {
  tableId: string
  seat: number
}

export interface AgentLogEntry {
  id: string
  time: number
  tool: string
  summary: string
}

export type Violation =
  | {
      kind: 'together' | 'apart'
      constraintId: string
      a: string
      b: string
      text: string
    }
  | {
      kind: 'zone'
      constraintId: string
      guestId: string
      zone: ZoneId
      preference: 'near' | 'far'
      text: string
    }
  | {
      kind: 'overfull'
      tableId: string
      text: string
    }

export interface AisleState {
  guests: Record<string, Guest>
  guestOrder: string[]
  tables: Record<string, Table>
  tableOrder: string[]
  constraints: Constraint[]
  /** guestId -> seat */
  seating: Record<string, SeatAssignment>
  finalized: boolean
}
