import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VENUE,
  featureFootprint,
  footprintGap,
  footprintsOverlap,
  tableFootprint,
  UNITS_PER_FOOT,
  containDelta,
  featureBounds,
  freshVenue,
  freshVenueDimensions,
  ft,
  layoutConflicts,
  outOfRoomItems,
  rectTableSize,
  roomRect,
  seatPos,
  tableBounds,
  tableRadius,
  toFeet,
} from './geometry'
import { SAMPLE } from './sample'
import { nextTableName } from './store'
import type { AisleState, Table, VenueDimensions } from './types'

const dimensions: VenueDimensions = { widthFt: 72, lengthFt: 46, snapFt: 1 }

function table(patch: Partial<Table> = {}): Table {
  return { id: 't', name: 'Table', shape: 'round', seats: 8, x: 0, y: 0, rotation: 0, ...patch }
}

function stateWith(tables: Table[], venueDimensions = dimensions): AisleState {
  return {
    layoutVersion: 3,
    guests: {},
    guestOrder: [],
    tables: Object.fromEntries(tables.map((t) => [t.id, t])),
    tableOrder: tables.map((t) => t.id),
    constraints: [],
    seating: {},
    finalized: false,
    groupOrder: [],
    venue: freshVenue(),
    venueDimensions,
    demoMetadata: null,
  }
}

describe('real-world sizing', () => {
  it('gives every seat its two feet of table edge', () => {
    for (const seats of [6, 8, 10, 12]) {
      const circumference = 2 * Math.PI * toFeet(tableRadius(table({ seats })))
      expect(circumference / seats).toBeCloseTo(2, 5)
    }
  })

  it('never draws a round table smaller than a cocktail table', () => {
    expect(toFeet(tableRadius(table({ seats: 2 })) * 2)).toBeCloseTo(3.5, 5)
  })

  it('sizes banquet tables at a standard 30-inch depth and 30 inches per place', () => {
    const eight = rectTableSize(table({ shape: 'rect', seats: 8 }))
    expect(toFeet(eight.h)).toBeCloseTo(2.5, 5)
    expect(toFeet(eight.w)).toBeCloseTo(7.5, 5)
    expect(toFeet(rectTableSize(table({ shape: 'rect', seats: 10 })).w)).toBeCloseTo(10, 5)
  })

  it('measures amenities in whole feet at the same scale as the room', () => {
    for (const feature of Object.values(DEFAULT_VENUE)) {
      expect(toFeet(feature.w) % 0.5).toBe(0)
      expect(toFeet(feature.h) % 0.5).toBe(0)
    }
    expect(toFeet(DEFAULT_VENUE.dance_floor.w)).toBe(16)
    expect(roomRect(dimensions).w).toBe(72 * UNITS_PER_FOOT)
  })

  it('leaves room for the chair between the tabletop and the seat chip', () => {
    const round = table({ seats: 8 })
    const seat = seatPos(round, 0)
    const reach = Math.hypot(seat.x - round.x, seat.y - round.y)
    expect(reach).toBeGreaterThan(tableRadius(round))
    // The chip's far edge is exactly where the table's footprint ends.
    expect(tableBounds(round).right - round.x).toBeCloseTo(reach + ft(0.75), 5)
  })
})

describe('spotting furniture that really clashes', () => {
  const round = (x: number, y: number, id = 'r') => tableFootprint(table({ id, x, y }), dimensions)
  const banquet = (x: number, y: number, rotation = 0) =>
    tableFootprint(table({ shape: 'rect', seats: 10, x, y, rotation }), dimensions)

  it('leaves two round tables set corner to corner alone', () => {
    // Their square bounding boxes clip, but a guest can walk between the
    // chairs — the gap is real, so neither table should be badged.
    expect(footprintGap(round(0, 0, 'a'), round(130, 130, 'b'))).toBeGreaterThan(0)
    expect(footprintsOverlap(round(0, 0, 'a'), round(130, 130, 'b'))).toBe(false)
  })

  it('leaves a banquet table set diagonally below a round one alone', () => {
    expect(footprintsOverlap(round(0, 0), banquet(210, 140))).toBe(false)
  })

  it('still catches round tables whose chairs would share a seat', () => {
    expect(footprintsOverlap(round(0, 0, 'a'), round(100, 0, 'b'))).toBe(true)
  })

  it('still catches a banquet table pushed into a round one', () => {
    expect(footprintsOverlap(round(0, 0), banquet(150, 0))).toBe(true)
  })

  it('follows a rotated banquet table around rather than boxing it in', () => {
    // End-on the long table reaches far; broadside it does not.
    expect(footprintsOverlap(round(0, 200), banquet(0, 0))).toBe(false)
    expect(footprintsOverlap(round(0, 200), banquet(0, 0, 90))).toBe(true)
  })

  it('measures amenities as the rectangles they are', () => {
    const floor = featureFootprint({ ...DEFAULT_VENUE.dance_floor, x: 0, y: 0 })
    expect(footprintsOverlap(round(-200, -200), floor)).toBe(false)
    expect(footprintsOverlap(round(100, 100), floor)).toBe(true)
  })

  it('treats pieces set flush against each other as fine, not overlapping', () => {
    const gap = footprintGap(round(0, 0, 'a'), round(174, 0, 'b'))
    expect(gap).toBeGreaterThanOrEqual(0)
    expect(gap).toBeLessThan(1)
    expect(footprintsOverlap(round(0, 0, 'a'), round(174, 0, 'b'))).toBe(false)
  })
})

describe('staying inside the room', () => {
  const room = roomRect(dimensions)

  it('leaves furniture already inside where it is', () => {
    const inside = table({ x: room.x + room.w / 2, y: room.y + room.h / 2 })
    expect(containDelta(tableBounds(inside, dimensions), room)).toEqual({ dx: 0, dy: 0 })
  })

  it('nudges a table back in by exactly its overhang', () => {
    const t = table({ x: room.x, y: room.y })
    const bounds = tableBounds(t, dimensions)
    const { dx, dy } = containDelta(bounds, room)
    const moved = tableBounds({ ...t, x: t.x + dx, y: t.y + dy }, dimensions)
    expect(moved.left).toBeGreaterThanOrEqual(room.x)
    expect(moved.top).toBeGreaterThanOrEqual(room.y)
  })

  it('counts the chairs, not just the tabletop, as the table’s footprint', () => {
    // Centred so the tabletop is inside the wall but the far chairs are not.
    const t = table({ x: room.x + tableRadius(table(), dimensions) + 4, y: room.y + room.h / 2 })
    expect(containDelta(tableBounds(t, dimensions), room).dx).toBeGreaterThan(0)
  })

  it('reports a table pushed past the wall, with how far it reaches', () => {
    const t = table({ id: 'stray', name: 'Table 9', x: room.x - ft(2), y: room.y + room.h / 2 })
    const [warning] = outOfRoomItems(stateWith([t]))
    expect(warning).toMatchObject({ kind: 'table', id: 'stray', label: 'Table 9' })
    expect(warning.overhangFt).toBeCloseTo(2 + toFeet(tableBounds(t, dimensions).right - t.x), 5)
  })

  it('stays quiet about a table parked flush against a wall', () => {
    const t = table({ x: room.x + ft(5), y: room.y + ft(5) })
    const { dx, dy } = containDelta(tableBounds(t, dimensions), room)
    expect(outOfRoomItems(stateWith([{ ...t, x: t.x + dx, y: t.y + dy }]))).toEqual([])
  })

  it('reports an amenity hanging off the edge', () => {
    const state = stateWith([])
    state.venue.dance_floor = { ...state.venue.dance_floor, x: roomRect(dimensions).x + ft(65) }
    const [warning] = outOfRoomItems(state)
    expect(warning).toMatchObject({ kind: 'feature', id: 'dance_floor' })
    expect(warning.overhangFt).toBeCloseTo(9, 5)
  })

  it('ignores an amenity that is hidden from the floor plan', () => {
    const state = stateWith([])
    state.venue.bar = { ...state.venue.bar, enabled: false, x: roomRect(dimensions).x + ft(200) }
    expect(outOfRoomItems(state)).toEqual([])
  })
})

describe('the sample wedding', () => {
  it('lays out inside the default room with nothing overlapping', () => {
    const state = stateWith(SAMPLE.tables, freshVenueDimensions())
    expect(layoutConflicts(state)).toEqual([])
    expect(outOfRoomItems(state)).toEqual([])
  })

  it('keeps its tables clear of the amenities that ship shown', () => {
    const state = stateWith(SAMPLE.tables, freshVenueDimensions())
    const shown = Object.values(state.venue).filter((f) => f.enabled)
    expect(shown.length).toBeGreaterThan(0)
    for (const feature of shown) {
      for (const t of SAMPLE.tables) {
        const a = tableBounds(t, state.venueDimensions)
        const b = featureBounds(feature)
        expect(a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top).toBe(false)
      }
    }
  })
})

describe('naming a new table', () => {
  it('picks the lowest free number rather than counting how many exist', () => {
    expect(nextTableName([])).toBe('Table 1')
    expect(nextTableName(['Table 1', 'Table 3'])).toBe('Table 2')
    expect(nextTableName(['Head Table', 'Table 1', 'Table 2'])).toBe('Table 3')
    expect(nextTableName(['table 1'])).toBe('Table 2')
  })
})
