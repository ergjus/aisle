import type { Table, Zone, ZoneId, AisleState } from './types'

/** Logical stage size; the canvas scales to fit the viewport. */
export const STAGE_W = 1240
export const STAGE_H = 860

/** The lounge strip at the bottom where unseated guests wait. */
export const TRAY = { x: 20, y: 706, w: 1200, h: 138 }

export const ZONES: Record<ZoneId, Zone> = {
  entrance: { id: 'entrance', label: 'Entrance', x: 50, y: 56, w: 170, h: 84 },
  band: { id: 'band', label: 'Band & speakers', x: 950, y: 56, w: 250, h: 128 },
  dance_floor: { id: 'dance_floor', label: 'Dance floor', x: 890, y: 232, w: 310, h: 320 },
}

export function zoneCenter(zone: Zone) {
  return { x: zone.x + zone.w / 2, y: zone.y + zone.h / 2 }
}

export const CHIP_R = 15

export function tableRadius(table: Table): number {
  if (table.shape === 'rect') return 0
  return Math.max(40, 30 + table.seats * 2.6)
}

export function rectTableSize(table: Table): { w: number; h: number } {
  const perSide = Math.ceil((table.seats - 2) / 2)
  return { w: Math.max(100, perSide * 40 + 36), h: 62 }
}

/** Position of seat i around a table, in stage coordinates. */
export function seatPos(table: Table, i: number): { x: number; y: number } {
  if (table.shape === 'round') {
    const ring = tableRadius(table) + CHIP_R + 6
    const angle = (i / table.seats) * Math.PI * 2 - Math.PI / 2
    return { x: table.x + Math.cos(angle) * ring, y: table.y + Math.sin(angle) * ring }
  }
  // Rect: two long sides, then the two ends.
  const { w, h } = rectTableSize(table)
  const perSide = Math.ceil((table.seats - 2) / 2)
  const gap = w / (perSide + 1)
  if (i < perSide) {
    return { x: table.x - w / 2 + gap * (i + 1), y: table.y - h / 2 - CHIP_R - 6 }
  }
  if (i < perSide * 2) {
    const j = i - perSide
    return { x: table.x - w / 2 + gap * (j + 1), y: table.y + h / 2 + CHIP_R + 6 }
  }
  const end = i - perSide * 2
  return {
    x: end === 0 ? table.x - w / 2 - CHIP_R - 6 : table.x + w / 2 + CHIP_R + 6,
    y: table.y,
  }
}

/** Footprint radius used for collision checks and drop targets. */
export function tableFootprint(table: Table): number {
  if (table.shape === 'round') return tableRadius(table) + CHIP_R * 2 + 10
  const { w } = rectTableSize(table)
  return w / 2 + CHIP_R * 2 + 10
}

export function trayPos(index: number): { x: number; y: number } {
  const perRow = Math.floor((TRAY.w - 56) / 38)
  const col = index % perRow
  const row = Math.floor(index / perRow)
  return { x: TRAY.x + 40 + col * 38, y: TRAY.y + 40 + row * 37 }
}

export function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/**
 * Distance-band test for zone constraints, relative to the room's other
 * tables so it stays meaningful when tables move: "near" means within the
 * closest ~third of the distance range, "far" the farthest ~third.
 */
export function zoneBands(state: AisleState, zoneId: ZoneId) {
  const zc = zoneCenter(ZONES[zoneId])
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
  for (let y = 240; y <= 640; y += 95) {
    for (let x = 140; x <= 800; x += 120) {
      candidates.push({ x, y })
    }
  }
  for (const c of candidates) {
    const clash = state.tableOrder.some(
      (id) => dist(state.tables[id], c) < tableFootprint(state.tables[id]) + 78,
    )
    if (!clash) return c
  }
  // Room is crowded: stack politely near the middle with slight offsets.
  const n = state.tableOrder.length
  return { x: 200 + (n % 5) * 60, y: 300 + (n % 7) * 40 }
}
