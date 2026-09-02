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
  /** Clockwise rotation in degrees. */
  rotation: number
}

export type ZoneId = 'dance_floor' | 'band' | 'entrance'

export type VenueFeatureId =
  | ZoneId
  | 'bathroom'
  | 'photo_booth'
  | 'bar'
  | 'buffet'
  | 'cake_table'
  | 'gift_table'

export type VenuePreset = 'ballroom' | 'garden_tent' | 'restaurant' | 'custom'

export type DemoTableStyle = 'round' | 'banquet' | 'mixed'

export type DemoPriority = 'family_harmony' | 'dance_floor_energy' | 'easy_arrivals'

export interface PersonalizedDemoConfig {
  venuePreset: VenuePreset
  widthFt: number
  lengthFt: number
  tableStyle: DemoTableStyle
  seatsPerTable: 6 | 8 | 10
  amenities: VenueFeatureId[]
  priority: DemoPriority
}

export interface PersonalizedDemoMetadata {
  kind: 'personalized'
  version: 1
  config: PersonalizedDemoConfig
}

export interface VenueFeature {
  id: VenueFeatureId
  label: string
  enabled: boolean
  x: number
  y: number
  w: number
  h: number
  /** Clockwise rotation in degrees. */
  rotation: number
}

export interface VenueDimensions {
  widthFt: number
  lengthFt: number
  /** Grid increment used while moving and resizing. */
  snapFt: number
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
  source: 'agent' | 'you'
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
  /** Persisted floor-plan coordinate model version. */
  layoutVersion: number
  guests: Record<string, Guest>
  guestOrder: string[]
  tables: Record<string, Table>
  tableOrder: string[]
  constraints: Constraint[]
  /** guestId -> seat */
  seating: Record<string, SeatAssignment>
  finalized: boolean
  /** Known group/party names, in display order. Can include groups with no guests yet. */
  groupOrder: string[]
  /** Saved, shared floor-plan amenities. Both people and WebMCP agents edit this same layout. */
  venue: Record<VenueFeatureId, VenueFeature>
  /** Real-world dimensions represented by the planning floor. */
  venueDimensions: VenueDimensions
  /** Present only while the chart is still the structurally intact personalized demo. */
  demoMetadata: PersonalizedDemoMetadata | null
  /**
   * Seats the human has pinned (guestId → true). A pinned guest stays exactly
   * where they are through auto-arrange and repair, and the agent's seating
   * tools refuse to move them — the human's hand-placed seats are law.
   */
  pinned: Record<string, true>
}

/** A question the agent has put to the human, waiting on the canvas for an answer. */
export interface HumanQuestion {
  id: string
  text: string
  /** Suggested answers, rendered as buttons. */
  options: string[]
  /** Whether a free-text reply is also accepted. */
  allowFreeText: boolean
  at: number
}
