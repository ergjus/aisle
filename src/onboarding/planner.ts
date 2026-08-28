import {
  DEFAULT_VENUE,
  DEFAULT_VENUE_DIMENSIONS,
  WALL_MARGIN,
  featureBounds,
  featureFootprint,
  footprintGap,
  footprintsOverlap,
  ft,
  layoutConflicts,
  roomRect,
  tableBounds,
  tableFootprint,
} from '../geometry'
import { SAMPLE_CONSTRAINTS, SAMPLE_GUESTS } from '../sample'
import type {
  AisleState,
  DemoPriority,
  PersonalizedDemoConfig,
  Table,
  VenueDimensions,
  VenueFeature,
  VenueFeatureId,
  VenuePreset,
} from '../types'

export const VENUE_FEATURE_IDS: VenueFeatureId[] = [
  'entrance',
  'dance_floor',
  'band',
  'bathroom',
  'photo_booth',
  'bar',
  'buffet',
  'cake_table',
  'gift_table',
]

export interface VenuePresetDefaults {
  widthFt: number
  lengthFt: number
  amenities: VenueFeatureId[]
}

/**
 * Room sizes are the real thing a venue of that kind books for this guest
 * list, with enough floor that every amenity on the next question still fits
 * — the defaults should never come back asking for a bigger room.
 */
export const VENUE_PRESET_DEFAULTS: Record<VenuePreset, VenuePresetDefaults> = {
  ballroom: {
    widthFt: DEFAULT_VENUE_DIMENSIONS.widthFt,
    lengthFt: DEFAULT_VENUE_DIMENSIONS.lengthFt,
    amenities: ['entrance', 'dance_floor', 'band', 'bathroom'],
  },
  garden_tent: {
    widthFt: 90,
    lengthFt: 60,
    amenities: ['entrance', 'dance_floor', 'band', 'bathroom', 'bar', 'buffet'],
  },
  restaurant: {
    widthFt: 62,
    lengthFt: 42,
    amenities: ['entrance', 'bathroom', 'bar'],
  },
  custom: {
    widthFt: DEFAULT_VENUE_DIMENSIONS.widthFt,
    lengthFt: DEFAULT_VENUE_DIMENSIONS.lengthFt,
    amenities: [],
  },
}

export function expandVenuePreset(preset: VenuePreset): VenuePresetDefaults {
  const defaults = VENUE_PRESET_DEFAULTS[preset]
  return { ...defaults, amenities: [...defaults.amenities] }
}

export interface DimensionErrors {
  widthFt?: string
  lengthFt?: string
}

export function validateDimensions(widthFt: number, lengthFt: number): DimensionErrors {
  const errors: DimensionErrors = {}
  if (!Number.isFinite(widthFt) || widthFt < 20 || widthFt > 300) {
    errors.widthFt = 'Width must be between 20 and 300 feet.'
  }
  if (!Number.isFinite(lengthFt) || lengthFt < 15 || lengthFt > 200) {
    errors.lengthFt = 'Length must be between 15 and 200 feet.'
  }
  return errors
}

export function amenitiesForPriority(
  amenities: VenueFeatureId[],
  priority: DemoPriority,
): VenueFeatureId[] {
  const required = priority === 'dance_floor_energy'
    ? 'dance_floor'
    : priority === 'easy_arrivals'
      ? 'entrance'
      : null
  const enabled = new Set(amenities)
  if (required) enabled.add(required)
  return VENUE_FEATURE_IDS.filter((id) => enabled.has(id))
}

export function attendingSampleGuests(): number {
  return SAMPLE_GUESTS.filter((guest) => guest.rsvp !== 'no').length
}

/** Keep at least one table's worth of unclaimed seats for direct challenge moves. */
export function personalizedCapacityTarget(config: PersonalizedDemoConfig): number {
  return attendingSampleGuests() + Math.max(10, config.seatsPerTable)
}

export function buildTablePlan(config: PersonalizedDemoConfig): Table[] {
  const target = personalizedCapacityTarget(config)
  const tables: Table[] = []

  if (config.tableStyle === 'mixed') {
    tables.push({
      id: 'demo-head-table',
      name: 'Head Table',
      shape: 'rect',
      seats: 10,
      x: 0,
      y: 0,
      rotation: 0,
    })
  }

  const alreadyPlanned = tables.reduce((sum, table) => sum + table.seats, 0)
  const remaining = Math.max(0, target - alreadyPlanned)
  const additional = Math.ceil(remaining / config.seatsPerTable)
  for (let index = 0; index < additional; index++) {
    const number = index + 1
    tables.push({
      id: `demo-table-${number}`,
      name: `Table ${number}`,
      shape: config.tableStyle === 'banquet' ? 'rect' : 'round',
      seats: config.seatsPerTable,
      x: 0,
      y: 0,
      rotation: 0,
    })
  }
  return tables
}

/** Aisle left between two amenities so they read as separate pieces. */
const AMENITY_GAP = ft(0.25)
/** Clear floor kept between a table's chairs and its neighbours. */
const TABLE_CLEARANCE = ft(0.2)

function hasGap(a: VenueFeature, b: VenueFeature, gap = AMENITY_GAP): boolean {
  return footprintGap(featureFootprint(a), featureFootprint(b)) >= gap
}

function insideRoom(
  bounds: ReturnType<typeof featureBounds>,
  room: ReturnType<typeof roomRect>,
  margin = WALL_MARGIN,
): boolean {
  return (
    bounds.left >= room.x + margin &&
    bounds.top >= room.y + margin &&
    bounds.right <= room.x + room.w - margin &&
    bounds.bottom <= room.y + room.h - margin
  )
}

const FEATURE_PLACEMENT_ORDER: VenueFeatureId[] = [
  'dance_floor',
  'band',
  'entrance',
  'bathroom',
  'buffet',
  'bar',
  'photo_booth',
  'cake_table',
  'gift_table',
]

function featureCandidates(feature: VenueFeature, dimensions: VenueDimensions): VenueFeature[] {
  const room = roomRect(dimensions)
  const step = Math.max(ft(0.4), Math.min(ft(1), Math.min(room.w / 35, room.h / 24)))
  const candidates: VenueFeature[] = [feature]
  for (let y = room.y + WALL_MARGIN; y <= room.y + room.h - feature.h - WALL_MARGIN; y += step) {
    for (let x = room.x + WALL_MARGIN; x <= room.x + room.w - feature.w - WALL_MARGIN; x += step) {
      candidates.push({ ...feature, x, y })
    }
  }
  const preferredCenter = { x: feature.x + feature.w / 2, y: feature.y + feature.h / 2 }
  return candidates.sort((a, b) => {
    const da = Math.hypot(a.x + a.w / 2 - preferredCenter.x, a.y + a.h / 2 - preferredCenter.y)
    const db = Math.hypot(b.x + b.w / 2 - preferredCenter.x, b.y + b.h / 2 - preferredCenter.y)
    return da - db || a.y - b.y || a.x - b.x
  })
}

function placeVenueFeatures(
  dimensions: VenueDimensions,
  enabledIds: VenueFeatureId[],
): Record<VenueFeatureId, VenueFeature> | null {
  const enabled = new Set(enabledIds)
  // Amenities keep their real-world footprint whatever the room's size — the
  // floor plan is drawn at a fixed scale, so only their placement is planned.
  const venue = Object.fromEntries(
    VENUE_FEATURE_IDS.map((id) => [id, { ...DEFAULT_VENUE[id], enabled: enabled.has(id) }]),
  ) as Record<VenueFeatureId, VenueFeature>
  const room = roomRect(dimensions)
  const placed: VenueFeature[] = []

  for (const id of FEATURE_PLACEMENT_ORDER) {
    if (!enabled.has(id)) continue
    const projected = venue[id]
    if (projected.w > room.w - WALL_MARGIN * 2 || projected.h > room.h - WALL_MARGIN * 2) return null
    const candidate = featureCandidates(projected, dimensions).find((next) => {
      return insideRoom(featureBounds(next), room) && placed.every((other) => hasGap(next, other))
    })
    if (!candidate) return null
    venue[id] = candidate
    placed.push(candidate)
  }
  return venue
}

type ScanPattern = 'rows' | 'columns' | 'rows-reverse' | 'columns-reverse'

function tableCandidates(
  table: Table,
  dimensions: VenueDimensions,
  pattern: ScanPattern,
): Table[] {
  const room = roomRect(dimensions)
  const atOrigin = tableBounds({ ...table, x: 0, y: 0 }, dimensions)
  const halfX = Math.max(Math.abs(atOrigin.left), Math.abs(atOrigin.right))
  const halfY = Math.max(Math.abs(atOrigin.top), Math.abs(atOrigin.bottom))
  const step = Math.max(ft(0.4), Math.min(ft(0.9), Math.min(room.w / 48, room.h / 32)))
  const xs: number[] = []
  const ys: number[] = []
  for (let x = room.x + halfX + WALL_MARGIN; x <= room.x + room.w - halfX - WALL_MARGIN; x += step) xs.push(x)
  for (let y = room.y + halfY + WALL_MARGIN; y <= room.y + room.h - halfY - WALL_MARGIN; y += step) ys.push(y)
  if (pattern.endsWith('reverse')) xs.reverse()
  const coordinates: { x: number; y: number }[] = []
  if (pattern.startsWith('columns')) {
    for (const x of xs) for (const y of ys) coordinates.push({ x, y })
  } else {
    for (const y of ys) for (const x of xs) coordinates.push({ x, y })
  }
  return coordinates.map(({ x, y }) => ({ ...table, x, y }))
}

function placeTables(
  templates: Table[],
  dimensions: VenueDimensions,
  venue: Record<VenueFeatureId, VenueFeature>,
): Table[] | null {
  const patterns: ScanPattern[] = ['rows', 'columns', 'rows-reverse', 'columns-reverse']
  const room = roomRect(dimensions)
  const enabledFeatures = Object.values(venue).filter((feature) => feature.enabled)

  for (let attempt = 0; attempt < patterns.length * 2; attempt++) {
    const pattern = patterns[attempt % patterns.length]
    const rotateBanquets = attempt >= patterns.length
    const placed: Table[] = []
    let failed = false

    for (let index = 0; index < templates.length; index++) {
      let template = templates[index]
      if (template.shape === 'rect' && rotateBanquets) {
        template = { ...template, rotation: index % 2 === 0 ? 90 : 0 }
      }
      let candidates = tableCandidates(template, dimensions, pattern)
      if (template.id === 'demo-head-table') {
        const desired = { x: room.x + room.w / 2, y: room.y + room.h * 0.82 }
        candidates = candidates.sort((a, b) => (
          Math.hypot(a.x - desired.x, a.y - desired.y) - Math.hypot(b.x - desired.x, b.y - desired.y)
        ))
      }
      const candidate = candidates.find((next) => {
        if (!insideRoom(tableBounds(next, dimensions), room)) return false
        const shape = tableFootprint(next, dimensions)
        if (enabledFeatures.some((feature) => footprintsOverlap(shape, featureFootprint(feature), -TABLE_CLEARANCE))) return false
        return placed.every((table) => !footprintsOverlap(shape, tableFootprint(table, dimensions), -TABLE_CLEARANCE))
      })
      if (!candidate) {
        failed = true
        break
      }
      placed.push(candidate)
    }
    if (!failed) return placed
  }
  return null
}

export type PersonalizedPlannerResult =
  | {
      ok: true
      state: AisleState
      attendingCount: number
      totalCapacity: number
    }
  | {
      ok: false
      question: 'dimensions' | 'amenities'
      message: string
    }

export function planPersonalizedSample(config: PersonalizedDemoConfig): PersonalizedPlannerResult {
  const dimensionErrors = validateDimensions(config.widthFt, config.lengthFt)
  if (dimensionErrors.widthFt || dimensionErrors.lengthFt) {
    return {
      ok: false,
      question: 'dimensions',
      message: dimensionErrors.widthFt ?? dimensionErrors.lengthFt!,
    }
  }

  const venueDimensions: VenueDimensions = {
    widthFt: config.widthFt,
    lengthFt: config.lengthFt,
    snapFt: 1,
  }
  const enabledAmenities = amenitiesForPriority(config.amenities, config.priority)
  const venue = placeVenueFeatures(venueDimensions, enabledAmenities)
  if (!venue) {
    return {
      ok: false,
      question: 'amenities',
      message: 'Those amenities cannot fit without overlapping in this room. Remove one or choose a larger room.',
    }
  }

  const tableTemplates = buildTablePlan(config)
  const tables = placeTables(tableTemplates, venueDimensions, venue)
  if (!tables) {
    return {
      ok: false,
      question: 'dimensions',
      message: 'The selected tables and amenities need a larger room. Increase either room dimension and try again.',
    }
  }

  let groupOrder: string[] = []
  for (const guest of SAMPLE_GUESTS) {
    if (!groupOrder.includes(guest.group)) groupOrder.push(guest.group)
  }
  const state: AisleState = {
    layoutVersion: 3,
    guests: Object.fromEntries(SAMPLE_GUESTS.map((guest) => [guest.id, structuredClone(guest)])),
    guestOrder: SAMPLE_GUESTS.map((guest) => guest.id),
    tables: Object.fromEntries(tables.map((table) => [table.id, table])),
    tableOrder: tables.map((table) => table.id),
    constraints: structuredClone(SAMPLE_CONSTRAINTS),
    seating: {},
    finalized: false,
    groupOrder,
    venue,
    venueDimensions,
    demoMetadata: {
      kind: 'personalized',
      version: 1,
      config: { ...config, amenities: enabledAmenities },
    },
  }

  if (layoutConflicts(state).length > 0) {
    return {
      ok: false,
      question: 'dimensions',
      message: 'The room is too crowded for a collision-free demo. Increase either room dimension and try again.',
    }
  }

  return {
    ok: true,
    state,
    attendingCount: attendingSampleGuests(),
    totalCapacity: tables.reduce((sum, table) => sum + table.seats, 0),
  }
}
