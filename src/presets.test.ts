import { describe, expect, it } from 'vitest'
import { SAMPLE } from './sample'
import { freshVenue, freshVenueDimensions } from './geometry'
import { planRulePreset, planSummary, suggestRulePresets } from './presets'
import type { AisleState, Constraint, Guest } from './types'

function sampleState(patch: Partial<AisleState> = {}): AisleState {
  let groupOrder: string[] = []
  for (const g of SAMPLE.guests) if (!groupOrder.includes(g.group)) groupOrder.push(g.group)
  return {
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
    ...patch,
  }
}

/** A small chart with no rules, for presets that start from scratch. */
function bareState(guests: Partial<Guest>[], constraints: Constraint[] = []): AisleState {
  const full = guests.map((g, i) => ({ id: g.id ?? `g${i}`, name: g.name ?? `Guest ${i}`, group: g.group ?? 'Guests', dietary: [], rsvp: g.rsvp ?? 'yes', notes: g.notes }) as Guest)
  return sampleState({
    guests: Object.fromEntries(full.map((g) => [g.id, g])),
    guestOrder: full.map((g) => g.id),
    groupOrder: [...new Set(full.map((g) => g.group))],
    constraints,
  })
}

describe('planRulePreset', () => {
  it('keeps divorced parents apart with one apart rule', () => {
    const state = sampleState()
    const plan = planRulePreset(state, 'divorced_parents_apart', ['g-sofia', 'g-marco'])
    expect(plan.error).toBeUndefined()
    expect(plan.add).toEqual([{ type: 'apart', a: 'g-sofia', b: 'g-marco', note: 'Preset: divorced parents apart' }])
  })

  it('skips a rule the chart already has, in either guest order', () => {
    const plan = planRulePreset(sampleState(), 'divorced_parents_apart', ['g-dario', 'g-marta'])
    expect(plan.add).toEqual([])
    expect(plan.skipped).toHaveLength(1)
    expect(planSummary(sampleState(), plan)).toMatch(/nothing to add/)
  })

  it('refuses to split a pair that sit-together rules tie to each other', () => {
    const plan = planRulePreset(sampleState(), 'divorced_parents_apart', ['g-jess', 'g-poppy'])
    expect(plan.error).toMatch(/tied together/)
    expect(plan.add).toEqual([])
  })

  it('needs the right number of guests', () => {
    expect(planRulePreset(sampleState(), 'plus_ones_together', ['g-maya']).error).toMatch(/at least 2/)
    expect(planRulePreset(sampleState(), 'plus_ones_together', ['g-maya', 'g-tunde', 'g-dev']).error).toMatch(/exactly 2/)
    expect(planRulePreset(sampleState(), 'away_from_band', []).error).toMatch(/a guest/)
  })

  it('ties a kids table to one anchor, skipping pairs already linked through other rules', () => {
    // Poppy and Milo are unlinked; a rule chain already links Jess's daughter Poppy to Toby.
    const plan = planRulePreset(sampleState(), 'kids_table', ['g-poppy', 'g-milo', 'g-toby'])
    expect(plan.add).toEqual([{ type: 'together', a: 'g-poppy', b: 'g-milo', note: 'Preset: kids table' }])
    expect(plan.skipped.map((s) => s.reason)).toEqual([expect.stringMatching(/already tied together/)])
    // Their parents come along through the existing kid-with-parent rules.
    expect(plan.warnings.join(' ')).toMatch(/Jess Nguyen/)
    expect(plan.fits).toBe(true)
  })

  it('warns when the sit-together group outgrows the largest table', () => {
    const guests = Array.from({ length: 12 }, (_, i) => ({ id: `k${i}`, name: `Kid ${i}`, group: 'Kids' }))
    const plan = planRulePreset(bareState(guests), 'kids_table', guests.map((g) => g.id))
    expect(plan.add).toHaveLength(11)
    expect(plan.fits).toBe(false)
    expect(plan.warnings.join(' ')).toMatch(/largest table seats 10/)
  })

  it('refuses a together preset that would swallow a keep-apart pair', () => {
    const plan = planRulePreset(sampleState(), 'head_table', ['g-jordan', 'g-sam'])
    expect(plan.error).toMatch(/keeps them apart/)
  })

  it('keeps several guests away from the band and skips the ones already there', () => {
    const plan = planRulePreset(sampleState(), 'away_from_band', ['g-rosa', 'g-adaeze'])
    expect(plan.add).toEqual([{ type: 'zone', guestId: 'g-adaeze', zone: 'band', preference: 'far', note: 'Preset: away from the speakers' }])
    expect(plan.skipped).toHaveLength(1)
  })

  it('will not keep someone away from the band while another rule wants them near it', () => {
    const state = bareState([{ id: 'a', name: 'Ana' }], [{ id: 'c', type: 'zone', guestId: 'a', zone: 'band', preference: 'near' }])
    expect(planRulePreset(state, 'away_from_band', ['a']).error).toMatch(/opposite rule/)
  })

  it('refuses rules around a hidden band', () => {
    const venue = freshVenue()
    venue.band = { ...venue.band, enabled: false }
    expect(planRulePreset(sampleState({ venue }), 'away_from_band', ['g-adaeze']).error).toMatch(/hidden/)
  })

  it('puts the head table near the dance floor through one anchor, reusing an existing spot rule', () => {
    // Tunde already sits near the dance floor, so he anchors and no new spot rule is needed.
    const plan = planRulePreset(sampleState(), 'head_table', ['g-lena', 'g-tunde', 'g-dev'])
    expect(plan.add).toEqual([
      { type: 'together', a: 'g-tunde', b: 'g-lena', note: 'Preset: head table' },
      { type: 'together', a: 'g-tunde', b: 'g-dev', note: 'Preset: head table' },
    ])
    expect(plan.skipped).toEqual([expect.objectContaining({ draft: expect.objectContaining({ type: 'zone', guestId: 'g-tunde' }) })])
  })

  it('a sweetheart table of two gets a together rule and a dance-floor rule', () => {
    const state = bareState([{ id: 'a', name: 'June' }, { id: 'b', name: 'Ravi' }])
    const plan = planRulePreset(state, 'head_table', ['a', 'b'])
    expect(plan.add.map((d) => d.type)).toEqual(['together', 'zone'])
  })
})

describe('suggestRulePresets', () => {
  it('reads notes and groups but leaves out what the chart already has', () => {
    const suggestions = suggestRulePresets(sampleState())
    const keys = suggestions.map((s) => `${s.preset}:${s.guestIds.join(',')}`)
    // The sample already keeps Marta and Dario apart and Maya with Chris.
    expect(keys.some((k) => k.startsWith('divorced_parents_apart'))).toBe(false)
    expect(keys.some((k) => k.startsWith('plus_ones_together'))).toBe(false)
    // Grandma Adaeze has no band rule yet; Rosa and Ezio do.
    expect(keys).toContain('away_from_band:g-adaeze')
    expect(keys).not.toContain('away_from_band:g-rosa')
    expect(keys).toContain('kids_table:g-poppy,g-milo,g-zara,g-teddy')
    expect(keys.some((k) => k.startsWith('head_table:'))).toBe(true)
  })

  it('suggests exes and plus-ones from notes that name another guest', () => {
    const state = bareState([
      { id: 'a', name: 'Aunt Marta Rossi', notes: 'Recently divorced from Dario' },
      { id: 'b', name: 'Uncle Dario Rossi', notes: 'Recently divorced from Marta' },
      { id: 'c', name: 'Jess Nguyen', notes: "Toby's partner" },
      { id: 'd', name: 'Toby Reed' },
      { id: 'e', name: 'Petra Novak', notes: 'Fence dispute with Rich' },
      { id: 'f', name: 'Rich Henderson' },
    ])
    const keys = suggestRulePresets(state).map((s) => `${s.preset}:${s.guestIds.join(',')}`)
    // One apart suggestion for the pair, not one per note.
    expect(keys).toEqual(['divorced_parents_apart:a,b', 'plus_ones_together:c,d'])
  })

  it('never suggests a preset that cannot fit', () => {
    const guests = Array.from({ length: 12 }, (_, i) => ({ id: `k${i}`, name: `Kid ${i}`, group: 'Kids' }))
    expect(suggestRulePresets(bareState(guests))).toEqual([])
  })
})
