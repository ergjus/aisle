import type { AisleState } from '../types'
import { freshVenue, freshVenueDimensions } from '../geometry'
import { SAMPLE } from '../sample'
import { autoArrange } from '../solver'

/**
 * The sample wedding, seated by the solver: the floor plan the front door
 * shows. Built once, from the same data the app loads when someone picks
 * "See an example", so what the visitor sees is what they get.
 */
export function seatedSampleChart(): AisleState {
  const groupOrder: string[] = []
  for (const g of SAMPLE.guests) if (!groupOrder.includes(g.group)) groupOrder.push(g.group)
  const base: AisleState = {
    layoutVersion: 3,
    guests: Object.fromEntries(SAMPLE.guests.map((g) => [g.id, g])),
    guestOrder: SAMPLE.guests.map((g) => g.id),
    tables: Object.fromEntries(SAMPLE.tables.map((t) => [t.id, t])),
    tableOrder: SAMPLE.tables.map((t) => t.id),
    constraints: SAMPLE.constraints,
    seating: {},
    finalized: false,
    groupOrder,
    venue: freshVenue(),
    venueDimensions: freshVenueDimensions(),
    demoMetadata: null,
    pinned: {},
  }
  return { ...base, seating: autoArrange(base).assignments }
}
