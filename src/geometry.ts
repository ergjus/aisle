import type { Table, VenueDimensions, VenueFeature, VenueFeatureId, ZoneId, AisleState } from './types'

/** Logical stage size; the canvas scales to fit the viewport. It covers the
 *  zoomable room only — the lounge is a fixed footer rendered outside it, so
 *  zooming the room can never move or resize the lounge. */
export const STAGE_W = 1240
export const STAGE_H = 716

/** The actual venue floor. */
export const ROOM = { x: 20, y: 28, w: 1200, h: 660 }

/** Nominal stage-space anchor for the lounge, at the room's bottom edge — used
 *  only to aim the agent cursor's flight path; the lounge itself now renders
 *  as a fixed footer below the stage, not at these coordinates. */
export const TRAY = { x: 20, y: 716, w: 872, h: 139 }

export const DEFAULT_VENUE_DIMENSIONS: VenueDimensions = { widthFt: 60, lengthFt: 33, snapFt: 1 }

/** Fits the true room aspect ratio inside the planning floor's maximum bounds. */
export function roomRect(dimensions: VenueDimensions) {
  const aspect = dimensions.widthFt / dimensions.lengthFt
  const maxAspect = ROOM.w / ROOM.h
  if (aspect >= maxAspect) {
    const h = ROOM.w / aspect
    return { x: ROOM.x, y: ROOM.y + (ROOM.h - h) / 2, w: ROOM.w, h }
  }
  const w = ROOM.h * aspect
  return { x: ROOM.x + (ROOM.w - w) / 2, y: ROOM.y, w, h: ROOM.h }
}

export const DEFAULT_VENUE: Record<VenueFeatureId, VenueFeature> = {
  entrance: { id: 'entrance', label: 'Entrance', enabled: true, x: 50, y: 72, w: 150, h: 72, rotation: 0 },
  band: { id: 'band', label: 'Band & speakers', enabled: true, x: 938, y: 64, w: 244, h: 110, rotation: 0 },
  dance_floor: { id: 'dance_floor', label: 'Dance floor', enabled: true, x: 898, y: 248, w: 284, h: 282, rotation: 0 },
  bathroom: { id: 'bathroom', label: 'Restrooms', enabled: true, x: 48, y: 574, w: 118, h: 78, rotation: 0 },
  photo_booth: { id: 'photo_booth', label: 'Photo booth', enabled: false, x: 978, y: 574, w: 204, h: 78, rotation: 0 },
  bar: { id: 'bar', label: 'Bar', enabled: false, x: 950, y: 315, w: 230, h: 82, rotation: 0 },
  buffet: { id: 'buffet', label: 'Buffet & catering', enabled: false, x: 50, y: 315, w: 250, h: 82, rotation: 0 },
  cake_table: { id: 'cake_table', label: 'Cake table', enabled: false, x: 545, y: 540, w: 150, h: 104, rotation: 0 },
  gift_table: { id: 'gift_table', label: 'Gifts & cards', enabled: false, x: 240, y: 72, w: 185, h: 72, rotation: 0 },
}

/** Prevents labels/controls from collapsing while still allowing compact floor plans. */
export const FEATURE_MIN_SIZE: Record<VenueFeatureId, { w: number; h: number }> = {
  entrance: { w: 105, h: 58 },
  band: { w: 170, h: 82 },
  dance_floor: { w: 150, h: 150 },
  bathroom: { w: 110, h: 64 },
  photo_booth: { w: 135, h: 68 },
  bar: { w: 120, h: 64 },
  buffet: { w: 165, h: 64 },
  cake_table: { w: 110, h: 76 },
  gift_table: { w: 125, h: 60 },
}

/** Keeps tables at a stable physical footprint when a room represents more or fewer feet. */
export function tableVisualScale(dimensions: VenueDimensions = DEFAULT_VENUE_DIMENSIONS): number {
  return Math.max(
    0.28,
    Math.min(
      2.2,
      DEFAULT_VENUE_DIMENSIONS.widthFt / dimensions.widthFt,
      DEFAULT_VENUE_DIMENSIONS.lengthFt / dimensions.lengthFt,
    ),
  )
}

export function featureMinSize(id: VenueFeatureId, dimensions: VenueDimensions) {
  const units = stageUnitsPerFoot(dimensions)
  const baseUnits = stageUnitsPerFoot(DEFAULT_VENUE_DIMENSIONS)
  return {
    w: Math.max(42, FEATURE_MIN_SIZE[id].w * units.x / baseUnits.x),
    h: Math.max(36, FEATURE_MIN_SIZE[id].h * units.y / baseUnits.y),
  }
}

export function freshVenue(): Record<VenueFeatureId, VenueFeature> {
  return structuredClone(DEFAULT_VENUE)
}

export function freshVenueDimensions(): VenueDimensions {
  return { ...DEFAULT_VENUE_DIMENSIONS }
}

export function stageUnitsPerFoot(dimensions: VenueDimensions) {
  const room = roomRect(dimensions)
  return { x: room.w / dimensions.widthFt, y: room.h / dimensions.lengthFt }
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

export const CHIP_R = 15

export function tableRadius(table: Table, dimensions: VenueDimensions = DEFAULT_VENUE_DIMENSIONS): number {
  if (table.shape === 'rect') return 0
  return Math.max(40, 30 + table.seats * 2.6) * tableVisualScale(dimensions)
}

export function rectTableSize(table: Table, dimensions: VenueDimensions = DEFAULT_VENUE_DIMENSIONS): { w: number; h: number } {
  const scale = tableVisualScale(dimensions)
  const perSide = Math.ceil((table.seats - 2) / 2)
  return { w: Math.max(100, perSide * 40 + 36) * scale, h: 62 * scale }
}

/** Position of seat i around a table, in stage coordinates. */
export function seatPos(table: Table, i: number, dimensions: VenueDimensions = DEFAULT_VENUE_DIMENSIONS): { x: number; y: number } {
  const rotation = ((table.rotation ?? 0) * Math.PI) / 180
  const rotate = (x: number, y: number) => ({
    x: table.x + x * Math.cos(rotation) - y * Math.sin(rotation),
    y: table.y + x * Math.sin(rotation) + y * Math.cos(rotation),
  })
  if (table.shape === 'round') {
    const ring = tableRadius(table, dimensions) + CHIP_R + 6
    const angle = (i / table.seats) * Math.PI * 2 - Math.PI / 2
    return rotate(Math.cos(angle) * ring, Math.sin(angle) * ring)
  }
  // Rect: two long sides, then the two ends.
  const { w, h } = rectTableSize(table, dimensions)
  const perSide = Math.ceil((table.seats - 2) / 2)
  const gap = w / (perSide + 1)
  if (i < perSide) {
    return rotate(-w / 2 + gap * (i + 1), -h / 2 - CHIP_R - 6)
  }
  if (i < perSide * 2) {
    const j = i - perSide
    return rotate(-w / 2 + gap * (j + 1), h / 2 + CHIP_R + 6)
  }
  const end = i - perSide * 2
  return rotate(end === 0 ? -w / 2 - CHIP_R - 6 : w / 2 + CHIP_R + 6, 0)
}

export interface Bounds { left: number; top: number; right: number; bottom: number }

function rotatedHalfExtents(w: number, h: number, rotation = 0) {
  const r = (rotation * Math.PI) / 180
  return {
    x: Math.abs(Math.cos(r)) * w / 2 + Math.abs(Math.sin(r)) * h / 2,
    y: Math.abs(Math.sin(r)) * w / 2 + Math.abs(Math.cos(r)) * h / 2,
  }
}

/** Bounds used for keeping the furniture itself in-room while allowing seats near the wall. */
export function tableBodyBounds(table: Table, dimensions: VenueDimensions = DEFAULT_VENUE_DIMENSIONS): Bounds {
  const size = table.shape === 'round'
    ? { w: tableRadius(table, dimensions) * 2, h: tableRadius(table, dimensions) * 2 }
    : rectTableSize(table, dimensions)
  const half = rotatedHalfExtents(size.w, size.h, table.rotation ?? 0)
  return { left: table.x - half.x, top: table.y - half.y, right: table.x + half.x, bottom: table.y + half.y }
}

/** Full table-and-chairs footprint used for overlap warnings. */
export function tableBounds(table: Table, dimensions: VenueDimensions = DEFAULT_VENUE_DIMENSIONS): Bounds {
  if (table.shape === 'round') {
    const half = tableRadius(table, dimensions) + CHIP_R + 19
    return { left: table.x - half, top: table.y - half, right: table.x + half, bottom: table.y + half }
  }
  const size = rectTableSize(table, dimensions)
  const half = rotatedHalfExtents(size.w + 72, size.h + 72, table.rotation ?? 0)
  return { left: table.x - half.x, top: table.y - half.y, right: table.x + half.x, bottom: table.y + half.y }
}

export function featureBounds(feature: VenueFeature): Bounds {
  const half = rotatedHalfExtents(feature.w, feature.h, feature.rotation ?? 0)
  const cx = feature.x + feature.w / 2
  const cy = feature.y + feature.h / 2
  return { left: cx - half.x, top: cy - half.y, right: cx + half.x, bottom: cy + half.y }
}

export function boundsOverlap(a: Bounds, b: Bounds, inset = 2): boolean {
  return a.left + inset < b.right && a.right - inset > b.left && a.top + inset < b.bottom && a.bottom - inset > b.top
}

/** Footprint radius used for collision checks and drop targets. */
export function tableFootprint(table: Table, dimensions: VenueDimensions = DEFAULT_VENUE_DIMENSIONS): number {
  if (table.shape === 'round') return tableRadius(table, dimensions) + CHIP_R * 2 + 10
  const { w } = rectTableSize(table, dimensions)
  return w / 2 + CHIP_R * 2 + 10
}

export function trayPos(index: number): { x: number; y: number } {
  const perRow = Math.floor((TRAY.w - 50) / 34)
  const col = index % perRow
  const row = Math.floor(index / perRow)
  return { x: TRAY.x + 36 + col * 34, y: TRAY.y + 38 + row * 32 }
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
    else pos[id] = trayPos(trayIndex++)
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
export function findFreeSpot(state: AisleState): { x: number; y: number } {
  const candidates: { x: number; y: number }[] = []
  const room = roomRect(state.venueDimensions)
  const furnitureScale = tableVisualScale(state.venueDimensions)
  const gapX = Math.max(72, 120 * furnitureScale)
  const gapY = Math.max(68, 95 * furnitureScale)
  for (let y = room.y + 100; y <= room.y + room.h - 55; y += gapY) {
    for (let x = room.x + 90; x <= room.x + room.w - 75; x += gapX) {
      candidates.push({ x, y })
    }
  }
  for (const c of candidates) {
    const tableClash = state.tableOrder.some(
      (id) => dist(state.tables[id], c) < tableFootprint(state.tables[id], state.venueDimensions) + 64 * furnitureScale,
    )
    const featureMargin = Math.max(45, 85 * furnitureScale)
    const featureClash = Object.values(state.venue).some(
      (feature) =>
        feature.enabled &&
        c.x > feature.x - featureMargin && c.x < feature.x + feature.w + featureMargin &&
        c.y > feature.y - featureMargin && c.y < feature.y + feature.h + featureMargin,
    )
    if (!tableClash && !featureClash) return c
  }
  // Room is crowded: stack politely near the middle with slight offsets.
  const n = state.tableOrder.length
  return { x: 200 + (n % 5) * 60, y: 300 + (n % 7) * 40 }
}
