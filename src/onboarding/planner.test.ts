import { describe, expect, it } from 'vitest'
import { layoutConflicts } from '../geometry'
import type { PersonalizedDemoConfig } from '../types'
import {
  VENUE_FEATURE_IDS,
  amenitiesForPriority,
  attendingSampleGuests,
  buildTablePlan,
  expandVenuePreset,
  personalizedCapacityTarget,
  planPersonalizedSample,
  validateDimensions,
} from './planner'

function config(patch: Partial<PersonalizedDemoConfig> = {}): PersonalizedDemoConfig {
  return {
    venuePreset: 'ballroom',
    widthFt: 60,
    lengthFt: 33,
    tableStyle: 'round',
    seatsPerTable: 8,
    amenities: ['entrance', 'dance_floor', 'band', 'bathroom'],
    priority: 'family_harmony',
    ...patch,
  }
}

describe('personalized demo planner', () => {
  it('expands every venue preset without sharing mutable amenity arrays', () => {
    expect(expandVenuePreset('ballroom')).toEqual({
      widthFt: 72,
      lengthFt: 46,
      amenities: ['entrance', 'dance_floor', 'band', 'bathroom'],
    })
    expect(expandVenuePreset('garden_tent')).toEqual({
      widthFt: 90,
      lengthFt: 60,
      amenities: ['entrance', 'dance_floor', 'band', 'bathroom', 'bar', 'buffet'],
    })
    expect(expandVenuePreset('restaurant')).toEqual({
      widthFt: 62,
      lengthFt: 42,
      amenities: ['entrance', 'bathroom', 'bar'],
    })
    expect(expandVenuePreset('custom')).toEqual({ widthFt: 72, lengthFt: 46, amenities: [] })
  })

  // The welcome guide must never hand back a default that it then refuses to
  // build: every preset's room fits every table style, seat count, and focus —
  // with all nine amenities switched on, not just the preset's own.
  it.each(['ballroom', 'garden_tent', 'restaurant', 'custom'] as const)(
    'plans the %s preset at its default size with every amenity enabled',
    (venuePreset) => {
      const preset = expandVenuePreset(venuePreset)
      for (const tableStyle of ['round', 'banquet', 'mixed'] as const) {
        for (const seatsPerTable of [6, 8, 10] as const) {
          for (const priority of ['family_harmony', 'dance_floor_energy', 'easy_arrivals'] as const) {
            const result = planPersonalizedSample({
              venuePreset,
              widthFt: preset.widthFt,
              lengthFt: preset.lengthFt,
              tableStyle,
              seatsPerTable,
              amenities: [...VENUE_FEATURE_IDS],
              priority,
            })
            expect(
              result.ok,
              `${venuePreset} ${tableStyle}/${seatsPerTable}/${priority}: ${result.ok ? '' : result.message}`,
            ).toBe(true)
          }
        }
      }
    },
  )

  it('validates both exact dimension bounds', () => {
    expect(validateDimensions(20, 15)).toEqual({})
    expect(validateDimensions(300, 200)).toEqual({})
    expect(validateDimensions(19, 201)).toEqual({
      widthFt: 'Width must be between 20 and 300 feet.',
      lengthFt: 'Length must be between 15 and 200 feet.',
    })
  })

  it('enforces the focus-specific amenity requirements', () => {
    expect(amenitiesForPriority([], 'family_harmony')).toEqual([])
    expect(amenitiesForPriority(['bar'], 'dance_floor_energy')).toEqual(['dance_floor', 'bar'])
    expect(amenitiesForPriority(['bar'], 'easy_arrivals')).toEqual(['entrance', 'bar'])
  })

  it.each([6, 8, 10] as const)('creates enough %i-seat tables with challenge spare capacity', (seatsPerTable) => {
    const input = config({ seatsPerTable })
    const tables = buildTablePlan(input)
    expect(tables.reduce((sum, table) => sum + table.seats, 0)).toBeGreaterThanOrEqual(personalizedCapacityTarget(input))
    expect(personalizedCapacityTarget(input)).toBeGreaterThan(attendingSampleGuests())
  })

  it('creates one 10-seat banquet head table and round tables for Mixed', () => {
    const tables = buildTablePlan(config({ tableStyle: 'mixed', seatsPerTable: 6 }))
    expect(tables[0]).toMatchObject({ id: 'demo-head-table', shape: 'rect', seats: 10 })
    expect(tables.slice(1).every((table) => table.shape === 'round' && table.seats === 6)).toBe(true)
  })

  it.each([
    config(),
    config({ venuePreset: 'garden_tent', widthFt: 80, lengthFt: 50, amenities: expandVenuePreset('garden_tent').amenities, tableStyle: 'mixed' }),
    config({ venuePreset: 'restaurant', widthFt: 45, lengthFt: 28, amenities: expandVenuePreset('restaurant').amenities, tableStyle: 'banquet', seatsPerTable: 10 }),
  ])('returns a collision-free personalized sample', (input) => {
    const result = planPersonalizedSample(input)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.guestOrder).toHaveLength(72)
    expect(result.state.constraints).toHaveLength(17)
    expect(layoutConflicts(result.state)).toEqual([])
    expect(result.totalCapacity).toBeGreaterThan(result.attendingCount)
  })

  it('returns an accessible impossible-layout error to the relevant question', () => {
    const result = planPersonalizedSample(config({
      widthFt: 20,
      lengthFt: 15,
      amenities: ['entrance', 'dance_floor', 'band', 'bathroom', 'photo_booth', 'bar', 'buffet', 'cake_table', 'gift_table'],
    }))
    expect(result).toMatchObject({ ok: false, question: 'amenities' })
    if (!result.ok) expect(result.message.length).toBeGreaterThan(20)
  })
})
