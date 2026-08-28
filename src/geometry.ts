import type { Table, VenueDimensions, VenueFeature, VenueFeatureId, ZoneId, AisleState } from './types'

/** Fixed floor-plan scale: one foot is always this many stage units. The room
 *  grows and shrinks with its real dimensions on an endless pannable canvas —
 *  the camera (pan + zoom) lives in Canvas.tsx, never in these coordinates. */
export const UNITS_PER_FOOT = 20

/** Feet → stage units. Every size in this file is written in real-world feet
 *  and passed through here, so the whole floor plan — room, tables, chairs,
 *  amenities — is measured on one scale and stays consistent when it changes. */
export function ft(feet: number): number {
  return feet * UNITS_PER_FOOT
}

/** Stage units → feet. */
export function toFeet(units: number): number {
  return units / UNITS_PER_FOOT
}

/** Stage-space origin of the room's top-left corner. */
export const ROOM_ORIGIN = { x: 20, y: 28 }

/** Legacy fixed floor bounds — kept only for v1/v2 coordinate migrations and
 *  the WebMCP legacy-unit schema hints. */
export const ROOM = { x: 20, y: 28, w: 1200, h: 660 }

export const DEFAULT_VENUE_DIMENSIONS: VenueDimensions = { widthFt: 72, lengthFt: 46, snapFt: 1 }

/** Breathing room kept between furniture and the walls. */
export const WALL_MARGIN_FT = 0.3
export const WALL_MARGIN = ft(WALL_MARGIN_FT)

/** The room's stage rectangle: its true size in feet at the fixed scale. */
export function roomRect(dimensions: VenueDimensions) {
  return {
    x: ROOM_ORIGIN.x,
    y: ROOM_ORIGIN.y,
    w: ft(dimensions.widthFt),
    h: ft(dimensions.lengthFt),
  }
}

/** How v2 laid rooms out: aspect-fitted into the fixed ROOM bounds. Only the
 *  v2→v3 persistence migration should ever need this. */
export function legacyFittedRoomRect(dimensions: VenueDimensions) {
  const aspect = dimensions.widthFt / dimensions.lengthFt
  const maxAspect = ROOM.w / ROOM.h
  if (aspect >= maxAspect) {
    const h = ROOM.w / aspect
    return { x: ROOM.x, y: ROOM.y + (ROOM.h - h) / 2, w: ROOM.w, h }
  }
  const w = ROOM.h * aspect
  return { x: ROOM.x + (ROOM.w - w) / 2, y: ROOM.y, w, h: ROOM.h }
}

/** The stage covers the room plus its symmetric margins — everything the
 *  camera can meaningfully frame. */
export function stageSize(dimensions: VenueDimensions) {
  const room = roomRect(dimensions)
  return { w: room.x * 2 + room.w, h: room.y + room.h + 28 }
}

/** Stage-space anchor for the lounge, just below the room's bottom edge — used
 *  only to aim the agent cursor's flight path; the lounge itself renders as a
 *  fixed footer outside the stage, not at these coordinates. */
export function trayRect(dimensions: VenueDimensions) {
  const room = roomRect(dimensions)
  return { x: room.x, y: room.y + room.h + 28, w: Math.min(872, room.w), h: 139 }
}

// ---- amenities --------------------------------------------------------------

interface FeaturePlan {
  label: string
  enabled: boolean
  /** Default spot and real-world footprint, in feet from the room's top-left. */
  xFt: number
  yFt: number
  wFt: number
  hFt: number
  /** Smallest the amenity can be drawn without becoming an unreadable smudge. */
  minWFt: number
  minHFt: number
}

/**
 * Every amenity at its real-world size, laid out for the default room. Sizes
 * come from the objects themselves — a 16-foot dance floor, a 30-inch-deep
 * banquet table for the gifts — so an amenity, a table, and a wall all read
 * at one scale.
 */
export const VENUE_PLAN: Record<VenueFeatureId, FeaturePlan> = {
  entrance: { label: 'Entrance', enabled: true, xFt: 2, yFt: 3, wFt: 8, hFt: 4, minWFt: 3, minHFt: 2.5 },
  gift_table: { label: 'Gifts & cards', enabled: false, xFt: 12, yFt: 3, wFt: 6, hFt: 2.5, minWFt: 3, minHFt: 2 },
  band: { label: 'Band & speakers', enabled: true, xFt: 58, yFt: 2, wFt: 12, hFt: 6, minWFt: 6, minHFt: 4 },
  dance_floor: { label: 'Dance floor', enabled: true, xFt: 54, yFt: 12, wFt: 16, hFt: 16, minWFt: 7.5, minHFt: 7.5 },
  buffet: { label: 'Buffet & catering', enabled: false, xFt: 2, yFt: 16, wFt: 16, hFt: 4, minWFt: 6, minHFt: 2.5 },
  bar: { label: 'Bar', enabled: false, xFt: 2, yFt: 24, wFt: 12, hFt: 4, minWFt: 5, minHFt: 2.5 },
  bathroom: { label: 'Restrooms', enabled: true, xFt: 2, yFt: 40, wFt: 6, hFt: 4, minWFt: 4, minHFt: 2.5 },
  cake_table: { label: 'Cake table', enabled: false, xFt: 22, yFt: 39, wFt: 4, hFt: 4, minWFt: 2.5, minHFt: 2.5 },
  photo_booth: { label: 'Photo booth', enabled: false, xFt: 30, yFt: 38, wFt: 8, hFt: 6, minWFt: 4, minHFt: 4 },
}

export const DEFAULT_VENUE: Record<VenueFeatureId, VenueFeature> = Object.fromEntries(
  Object.entries(VENUE_PLAN).map(([id, plan]) => [id, {
    id: id as VenueFeatureId,
    label: plan.label,
    enabled: plan.enabled,
    x: ROOM_ORIGIN.x + ft(plan.xFt),
    y: ROOM_ORIGIN.y + ft(plan.yFt),
    w: ft(plan.wFt),
    h: ft(plan.hFt),
    rotation: 0,
  }]),
) as Record<VenueFeatureId, VenueFeature>

/** Prevents labels/controls from collapsing while still allowing compact floor plans. */
export const FEATURE_MIN_SIZE: Record<VenueFeatureId, { w: number; h: number }> = Object.fromEntries(
  Object.entries(VENUE_PLAN).map(([id, plan]) => [id, { w: ft(plan.minWFt), h: ft(plan.minHFt) }]),
) as Record<VenueFeatureId, { w: number; h: number }>

export function featureMinSize(id: VenueFeatureId, _dimensions: VenueDimensions) {
  return { ...FEATURE_MIN_SIZE[id] }
}

export function freshVenue(): Record<VenueFeatureId, VenueFeature> {
  return structuredClone(DEFAULT_VENUE)
}

export function freshVenueDimensions(): VenueDimensions {
  return { ...DEFAULT_VENUE_DIMENSIONS }
}

export function stageUnitsPerFoot(_dimensions: VenueDimensions) {
  return { x: UNITS_PER_FOOT, y: UNITS_PER_FOOT }
}

export function snapStageValue(value: number, axis: 'x' | 'y', dimensions: VenueDimensions): number {
  if (dimensions.snapFt <= 0) return value
  const perFoot = stageUnitsPerFoot(dimensions)[axis]
  const room = roomRect(dimensions)
  const origin = axis === 'x' ? room.x : room.y
  const step = perFoot * dimensions.snapFt
  return origin + Math.round((value - origin) / step) * step
}

export function feetSize(w: number, h: number, dimensions: VenueDimensions) {
  const units = stageUnitsPerFoot(dimensions)
  return { w: w / units.x, h: h / units.y }
}

export function formatFeet(value: number): string {
  const rounded = Math.round(value * 2) / 2
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}′`
}

export function zoneCenter(zone: VenueFeature) {
  return { x: zone.x + zone.w / 2, y: zone.y + zone.h / 2 }
}

// ---- tables and chairs ------------------------------------------------------

/** A chair chip is an 18-inch seat. */
export const CHIP_R = ft(0.75)

/** Gap between the tabletop edge and the chair pulled up to it. */
const SEAT_GAP = ft(0.3)

/** How far the outside edge of a chair reaches past the tabletop. */
const SEAT_REACH = CHIP_R * 2 + SEAT_GAP

/** Circumference one place setting needs on a round — the caterer's 24 inches. */
const ROUND_FEET_PER_SEAT = 2
/** Smallest round we draw: a 42-inch cocktail table. */
const MIN_ROUND_DIAMETER_FT = 3.5
/** A banquet chair gets more elbow room than a curved one: 30 inches. */
const BANQUET_FEET_PER_SEAT = 2.5
/** Banquet tables come 30 inches deep, in whole-foot lengths. */
const BANQUET_DEPTH_FT = 2.5
const MIN_BANQUET_LENGTH_FT = 4

/** Seats down each long side of a banquet table; the last two take the ends. */
function banquetPerSide(seats: number): number {
  return Math.ceil((seats - 2) / 2)
}

/** Tabletop radius: enough circumference to give every seat its 24 inches. */
export function tableRadius(table: Table, _dimensions: VenueDimensions = DEFAULT_VENUE_DIMENSIONS): number {
  if (table.shape === 'rect') return 0
  return ft(Math.max(MIN_ROUND_DIAMETER_FT, (table.seats * ROUND_FEET_PER_SEAT) / Math.PI) / 2)
}

export function rectTableSize(table: Table, _dimensions: VenueDimensions = DEFAULT_VENUE_DIMENSIONS): { w: number; h: number } {
  const lengthFt = Math.max(MIN_BANQUET_LENGTH_FT, banquetPerSide(table.seats) * BANQUET_FEET_PER_SEAT)
  return { w: ft(lengthFt), h: ft(BANQUET_DEPTH_FT) }
}

/** The tabletop's own footprint, whatever its shape. */
export function tableSize(table: Table, dimensions: VenueDimensions = DEFAULT_VENUE_DIMENSIONS): { w: number; h: number } {
  if (table.shape !== 'round') return rectTableSize(table, dimensions)
  const diameter = tableRadius(table, dimensions) * 2
  return { w: diameter, h: diameter }
}

/** Position of seat i around a table, in stage coordinates. */
export function seatPos(table: Table, i: number, dimensions: VenueDimensions = DEFAULT_VENUE_DIMENSIONS): { x: number; y: number } {
  const rotation = ((table.rotation ?? 0) * Math.PI) / 180
  const rotate = (x: number, y: number) => ({
    x: table.x + x * Math.cos(rotation) - y * Math.sin(rotation),
    y: table.y + x * Math.sin(rotation) + y * Math.cos(rotation),
  })
  if (table.shape === 'round') {
    const ring = tableRadius(table, dimensions) + CHIP_R + SEAT_GAP
    const angle = (i / table.seats) * Math.PI * 2 - Math.PI / 2
    return rotate(Math.cos(angle) * ring, Math.sin(angle) * ring)
  }
  // Rect: two long sides, then the two ends.
  const { w, h } = rectTableSize(table, dimensions)
  const perSide = banquetPerSide(table.seats)
  const gap = w / (perSide + 1)
  if (i < perSide) {
    return rotate(-w / 2 + gap * (i + 1), -h / 2 - CHIP_R - SEAT_GAP)
  }
  if (i < perSide * 2) {
    const j = i - perSide
    return rotate(-w / 2 + gap * (j + 1), h / 2 + CHIP_R + SEAT_GAP)
  }
  const end = i - perSide * 2
  return rotate(end === 0 ? -w / 2 - CHIP_R - SEAT_GAP : w / 2 + CHIP_R + SEAT_GAP, 0)
}

export interface Bounds { left: number; top: number; right: number; bottom: number }

function rotatedHalfExtents(w: number, h: number, rotation = 0) {
  const r = (rotation * Math.PI) / 180
  return {
    x: Math.abs(Math.cos(r)) * w / 2 + Math.abs(Math.sin(r)) * h / 2,
    y: Math.abs(Math.sin(r)) * w / 2 + Math.abs(Math.cos(r)) * h / 2,
  }
}

/**
 * Full table-and-chairs footprint — the floor the table actually occupies,
 * and so the shape that has to fit between the walls. Measuring the tabletop
 * alone would let a table park with its far chairs out in the car park.
 */
export function tableBounds(table: Table, dimensions: VenueDimensions = DEFAULT_VENUE_DIMENSIONS): Bounds {
  if (table.shape === 'round') {
    const half = tableRadius(table, dimensions) + SEAT_REACH
    return { left: table.x - half, top: table.y - half, right: table.x + half, bottom: table.y + half }
  }
  const size = rectTableSize(table, dimensions)
  const half = rotatedHalfExtents(size.w + SEAT_REACH * 2, size.h + SEAT_REACH * 2, table.rotation ?? 0)
  return { left: table.x - half.x, top: table.y - half.y, right: table.x + half.x, bottom: table.y + half.y }
}

export function featureBounds(feature: VenueFeature): Bounds {
  const half = rotatedHalfExtents(feature.w, feature.h, feature.rotation ?? 0)
  const cx = feature.x + feature.w / 2
  const cy = feature.y + feature.h / 2
  return { left: cx - half.x, top: cy - half.y, right: cx + half.x, bottom: cy + half.y }
}

// ---- footprints and overlap -------------------------------------------------

export interface Point { x: number; y: number }

/**
 * The floor a piece of furniture actually covers. A round table's chairs
 * sweep a circle, so its footprint is a disc — testing the square around that
 * disc counted its four empty corners as occupied, which is why two tables
 * set diagonally from each other warned about overlapping when a guest could
 * walk between them. Rectangular pieces keep their orientation instead of
 * being flattened to an axis-aligned box, for the same reason.
 */
export type Footprint =
  | { kind: 'disc'; center: Point; radius: number }
  /** A rotated rectangle grown by `pad` in every direction (rounded corners). */
  | { kind: 'box'; corners: Point[]; pad: number }

function obbCorners(center: Point, w: number, h: number, rotation = 0): Point[] {
  const r = (rotation * Math.PI) / 180
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  return [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ].map(([x, y]) => ({ x: center.x + x * cos - y * sin, y: center.y + x * sin + y * cos }))
}

/** Shortest distance from `p` to segment `a`–`b`. */
function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSq = dx * dx + dy * dy
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** True when `p` is inside the convex polygon (given in consistent winding). */
function pointInPolygon(p: Point, poly: Point[]): boolean {
  let sign = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
    if (cross === 0) continue
    const next = cross > 0 ? 1 : -1
    if (sign !== 0 && next !== sign) return false
    sign = next
  }
  return true
}

function pointPolygonDistance(p: Point, poly: Point[]): number {
  if (pointInPolygon(p, poly)) return 0
  let best = Infinity
  for (let i = 0; i < poly.length; i++) {
    best = Math.min(best, pointSegmentDistance(p, poly[i], poly[(i + 1) % poly.length]))
  }
  return best
}

/** Separating-axis test over both polygons' edge normals. */
function polygonsIntersect(a: Point[], b: Point[]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]
      const q = poly[(i + 1) % poly.length]
      const axis = { x: -(q.y - p.y), y: q.x - p.x }
      const project = (points: Point[]) => {
        let min = Infinity
        let max = -Infinity
        for (const point of points) {
          const value = point.x * axis.x + point.y * axis.y
          min = Math.min(min, value)
          max = Math.max(max, value)
        }
        return { min, max }
      }
      const pa = project(a)
      const pb = project(b)
      if (pa.max < pb.min || pb.max < pa.min) return false
    }
  }
  return true
}

function polygonDistance(a: Point[], b: Point[]): number {
  if (polygonsIntersect(a, b)) return 0
  let best = Infinity
  for (const [from, to] of [[a, b], [b, a]] as const) {
    for (const p of from) best = Math.min(best, pointPolygonDistance(p, to))
  }
  return best
}

/**
 * Clear floor between two footprints, in stage units. Zero when they touch,
 * negative by however much they overlap.
 */
export function footprintGap(a: Footprint, b: Footprint): number {
  if (a.kind === 'disc' && b.kind === 'disc') {
    return dist(a.center, b.center) - a.radius - b.radius
  }
  if (b.kind === 'disc') return footprintGap(b, a)
  if (a.kind === 'disc') return pointPolygonDistance(a.center, b.corners) - a.radius - b.pad
  return polygonDistance(a.corners, b.corners) - a.pad - b.pad
}

/**
 * Whether two footprints clash. `inset` is the overlap tolerated before it
 * counts — a small positive value keeps pieces set flush against each other
 * from warning, and a negative one demands that much clear floor between them.
 */
export function footprintsOverlap(a: Footprint, b: Footprint, inset = 2): boolean {
  return footprintGap(a, b) < -inset
}

/** The floor a table and its pulled-up chairs cover. */
export function tableFootprint(table: Table, dimensions: VenueDimensions = DEFAULT_VENUE_DIMENSIONS): Footprint {
  if (table.shape === 'round') {
    return { kind: 'disc', center: { x: table.x, y: table.y }, radius: tableRadius(table, dimensions) + SEAT_REACH }
  }
  const size = rectTableSize(table, dimensions)
  return { kind: 'box', corners: obbCorners(table, size.w, size.h, table.rotation ?? 0), pad: SEAT_REACH }
}

/** The floor an amenity covers — no chairs, so no padding. */
export function featureFootprint(feature: VenueFeature): Footprint {
  const center = { x: feature.x + feature.w / 2, y: feature.y + feature.h / 2 }
  return { kind: 'box', corners: obbCorners(center, feature.w, feature.h, feature.rotation ?? 0), pad: 0 }
}

// ---- staying inside the walls -----------------------------------------------

export interface RoomRect { x: number; y: number; w: number; h: number }

/**
 * The nudge that brings `bounds` back inside the room, or {0,0} when it is
 * already in. Every mover — drag, agent tool, room resize, rehydration —
 * routes through this, so "inside the room" means one thing everywhere.
 */
export function containDelta(bounds: Bounds, room: RoomRect, margin = WALL_MARGIN): { dx: number; dy: number } {
  return {
    dx: Math.max(room.x + margin - bounds.left, Math.min(room.x + room.w - margin - bounds.right, 0)),
    dy: Math.max(room.y + margin - bounds.top, Math.min(room.y + room.h - margin - bounds.bottom, 0)),
  }
}

/** How far past the walls `bounds` reaches, in feet (0 when fully inside). */
export function overhangFeet(bounds: Bounds, room: RoomRect): number {
  const over = Math.max(
    room.x - bounds.left,
    room.y - bounds.top,
    bounds.right - (room.x + room.w),
    bounds.bottom - (room.y + room.h),
  )
  return over > 0 ? toFeet(over) : 0
}

export interface OutOfRoomItem {
  kind: 'table' | 'feature'
  id: string
  label: string
  /** Largest overhang past any wall, in feet. */
  overhangFt: number
}

/**
 * Furniture whose footprint crosses a wall — a table whose chairs would sit
 * outside the room, an amenity hanging off the edge. Tiny overhangs are
 * ignored so a piece parked flush against a wall isn't nagged about.
 */
export function outOfRoomItems(state: AisleState): OutOfRoomItem[] {
  const room = roomRect(state.venueDimensions)
  const tolerance = 0.25
  const out: OutOfRoomItem[] = []
  for (const id of state.tableOrder) {
    const table = state.tables[id]
    const overhangFt = overhangFeet(tableBounds(table, state.venueDimensions), room)
    if (overhangFt > tolerance) out.push({ kind: 'table', id, label: table.name, overhangFt })
  }
  for (const feature of Object.values(state.venue)) {
    if (!feature.enabled) continue
    const overhangFt = overhangFeet(featureBounds(feature), room)
    if (overhangFt > tolerance) out.push({ kind: 'feature', id: feature.id, label: feature.label, overhangFt })
  }
  return out
}

export interface LayoutConflict {
  aKind: 'table' | 'feature'
  aId: string
  aLabel: string
  bKind: 'table' | 'feature'
  bId: string
  bLabel: string
}

/**
 * Every pair of overlapping furniture pieces — table×table, table×amenity,
 * amenity×amenity (hidden amenities exempt). The canvas badges these and the
 * agent tools report them, from this single source of truth.
 */
export function layoutConflicts(state: AisleState): LayoutConflict[] {
  const out: LayoutConflict[] = []
  const tables = state.tableOrder.map((id) => state.tables[id])
  const features = Object.values(state.venue).filter((feature) => feature.enabled)
  const tableShapes = tables.map((table) => tableFootprint(table, state.venueDimensions))
  const featureShapes = features.map(featureFootprint)
  for (let i = 0; i < tables.length; i++) {
    for (let j = i + 1; j < tables.length; j++) {
      if (!footprintsOverlap(tableShapes[i], tableShapes[j])) continue
      out.push({ aKind: 'table', aId: tables[i].id, aLabel: tables[i].name, bKind: 'table', bId: tables[j].id, bLabel: tables[j].name })
    }
    for (let f = 0; f < features.length; f++) {
      if (!footprintsOverlap(tableShapes[i], featureShapes[f])) continue
      out.push({ aKind: 'table', aId: tables[i].id, aLabel: tables[i].name, bKind: 'feature', bId: features[f].id, bLabel: features[f].label })
    }
  }
  for (let i = 0; i < features.length; i++) {
    for (let j = i + 1; j < features.length; j++) {
      if (!footprintsOverlap(featureShapes[i], featureShapes[j])) continue
      out.push({ aKind: 'feature', aId: features[i].id, aLabel: features[i].label, bKind: 'feature', bId: features[j].id, bLabel: features[j].label })
    }
  }
  return out
}

/** How close a dragged chip has to get before a table claims it. */
export function tableDropRadius(table: Table, dimensions: VenueDimensions = DEFAULT_VENUE_DIMENSIONS): number {
  if (table.shape === 'round') return tableRadius(table, dimensions) + SEAT_REACH
  const { w } = rectTableSize(table, dimensions)
  return w / 2 + SEAT_REACH
}

export function trayPos(index: number, dimensions: VenueDimensions = DEFAULT_VENUE_DIMENSIONS): { x: number; y: number } {
  const tray = trayRect(dimensions)
  const perRow = Math.max(1, Math.floor((tray.w - 50) / 34))
  const col = index % perRow
  const row = Math.floor(index / perRow)
  return { x: tray.x + 36 + col * 34, y: tray.y + 38 + row * 32 }
}

export function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/**
 * Stage position of every attending guest chip — seated ones at their seat,
 * the rest flowing into the lounge tray. The canvas and the agent cursor both
 * use this, so choreography lands exactly where chips render.
 */
export function chipPositions(state: AisleState): Record<string, { x: number; y: number }> {
  const pos: Record<string, { x: number; y: number }> = {}
  let trayIndex = 0
  for (const id of state.guestOrder) {
    if (state.guests[id].rsvp === 'no') continue
    const seat = state.seating[id]
    if (seat && state.tables[seat.tableId]) pos[id] = seatPos(state.tables[seat.tableId], seat.seat, state.venueDimensions)
    else pos[id] = trayPos(trayIndex++, state.venueDimensions)
  }
  return pos
}

/**
 * Distance-band test for zone constraints, relative to the room's other
 * tables so it stays meaningful when tables move: "near" means within the
 * closest ~third of the distance range, "far" the farthest ~third.
 */
export function zoneBands(state: AisleState, zoneId: ZoneId) {
  const feature = state.venue[zoneId]
  if (!feature?.enabled) return { nearMax: Infinity, farMin: 0, byTable: {} as Record<string, number> }
  const zc = zoneCenter(feature)
  const ds = state.tableOrder.map((id) => dist(state.tables[id], zc))
  if (ds.length === 0) return { nearMax: Infinity, farMin: 0, byTable: {} as Record<string, number> }
  const min = Math.min(...ds)
  const max = Math.max(...ds)
  const range = Math.max(1, max - min)
  const byTable: Record<string, number> = {}
  state.tableOrder.forEach((id, i) => (byTable[id] = ds[i]))
  return { nearMax: min + range * 0.4, farMin: min + range * 0.6, byTable }
}

/** Find an open spot for a new table, avoiding zones, the tray and other tables. */
export function findFreeSpot(state: AisleState, table?: Table): { x: number; y: number } {
  const room = roomRect(state.venueDimensions)
  const probe = table ?? { id: '', name: '', shape: 'round' as const, seats: 8, x: 0, y: 0, rotation: 0 }
  const atOrigin = tableBounds({ ...probe, x: 0, y: 0 }, state.venueDimensions)
  const halfX = Math.max(Math.abs(atOrigin.left), Math.abs(atOrigin.right))
  const halfY = Math.max(Math.abs(atOrigin.top), Math.abs(atOrigin.bottom))
  const stepX = ft(3)
  const stepY = ft(2.5)
  const clearance = ft(1)
  const taken = [
    ...state.tableOrder.map((id) => tableFootprint(state.tables[id], state.venueDimensions)),
    ...Object.values(state.venue).filter((feature) => feature.enabled).map(featureFootprint),
  ]
  for (let y = room.y + halfY + WALL_MARGIN; y <= room.y + room.h - halfY - WALL_MARGIN; y += stepY) {
    for (let x = room.x + halfX + WALL_MARGIN; x <= room.x + room.w - halfX - WALL_MARGIN; x += stepX) {
      const shape = tableFootprint({ ...probe, x, y }, state.venueDimensions)
      if (taken.every((other) => !footprintsOverlap(shape, other, -clearance))) return { x, y }
    }
  }
  // Room is crowded: stack politely near the middle with slight offsets.
  const n = state.tableOrder.length
  return { x: room.x + room.w / 2 + (n % 5) * ft(1), y: room.y + room.h / 2 + (n % 7) * ft(0.75) }
}
