import type { AisleState, ZoneId } from './types'
import { constraintText, findDuplicateRule, zoneNoun, type RuleDraft } from './constraints'

/**
 * One-click house rules for the cases every wedding has. A preset is only a
 * recipe: it turns a few chosen guests into ordinary together/apart/zone
 * rules, so the solver, the violation lines, and undo need nothing new. The
 * sidebar's preset picker and the agent's apply_rule_preset tool both read
 * from here, so a person and the agent always get the same rules.
 */

export type RulePresetId =
  | 'divorced_parents_apart'
  | 'kids_table'
  | 'plus_ones_together'
  | 'away_from_band'
  | 'head_table'

export interface RulePreset {
  id: RulePresetId
  /** Short name for the picker. */
  label: string
  /** One line on what the preset does, for the picker and the tool description. */
  blurb: string
  minGuests: number
  /** null = as many as the human picks. */
  maxGuests: number | null
  /** Written on every rule the preset adds, so the rule list says where it came from. */
  note: string
}

export const RULE_PRESETS: RulePreset[] = [
  {
    id: 'divorced_parents_apart',
    label: 'Divorced parents apart',
    blurb: 'Two people who should not share a table — divorced parents, exes.',
    minGuests: 2,
    maxGuests: 2,
    note: 'Preset: divorced parents apart',
  },
  {
    id: 'kids_table',
    label: 'Kids table',
    blurb: 'The children sit together at one table.',
    minGuests: 2,
    maxGuests: null,
    note: 'Preset: kids table',
  },
  {
    id: 'plus_ones_together',
    label: 'Plus-ones together',
    blurb: 'A guest and their plus-one share a table.',
    minGuests: 2,
    maxGuests: 2,
    note: 'Preset: plus-one',
  },
  {
    id: 'away_from_band',
    label: 'Away from the band',
    blurb: 'Elderly or noise-shy guests sit away from the band and speakers.',
    minGuests: 1,
    maxGuests: null,
    note: 'Preset: away from the speakers',
  },
  {
    id: 'head_table',
    label: 'Head / sweetheart table',
    blurb: 'The wedding party (or just the couple) together, near the dance floor.',
    minGuests: 2,
    maxGuests: null,
    note: 'Preset: head table',
  },
]

export function rulePreset(id: string): RulePreset | undefined {
  return RULE_PRESETS.find((p) => p.id === id)
}

export interface PresetPlan {
  preset: RulePresetId
  /** Rules to add, already free of duplicates. */
  add: RuleDraft[]
  /** Rules the preset would have made that the chart already has (directly or through other rules). */
  skipped: { draft: RuleDraft; reason: string }[]
  /** Things the human should know before applying, e.g. who else gets pulled along. */
  warnings: string[]
  /** Set when the preset can't be applied as asked; `add` is empty then. */
  error?: string
  /** False when the resulting sit-together group is bigger than the largest table. */
  fits: boolean
}

/** Plain text for a rule that has no id yet. */
export function draftText(state: AisleState, draft: RuleDraft): string {
  return constraintText(state, { ...draft, id: '' })
}

/** Union-find over the chart's sit-together rules: who is already tied to whom. */
function togetherClusters(state: AisleState) {
  const parent = new Map<string, string>()
  const find = (id: string): string => {
    let root = id
    while (parent.has(root) && parent.get(root) !== root) root = parent.get(root)!
    parent.set(id, root)
    return root
  }
  const union = (a: string, b: string) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }
  for (const c of state.constraints) if (c.type === 'together') union(c.a, c.b)
  return { find, union }
}

function names(state: AisleState, ids: string[]): string {
  const list = ids.map((id) => state.guests[id]?.name ?? 'someone')
  if (list.length <= 1) return list[0] ?? ''
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
}

function failed(preset: RulePresetId, error: string): PresetPlan {
  return { preset, add: [], skipped: [], warnings: [], error, fits: true }
}

/**
 * The rules a preset adds for the chosen guests, in pick order. Pure: nothing
 * is written to the chart. Duplicates are skipped — including sit-together
 * pairs already joined through a chain of other rules — and a preset that
 * would contradict an existing rule comes back with an `error` instead.
 */
export function planRulePreset(state: AisleState, presetId: RulePresetId, guestIds: string[]): PresetPlan {
  const preset = rulePreset(presetId)
  if (!preset) return failed(presetId, `Unknown preset "${presetId}".`)
  const ids = [...new Set(guestIds)].filter((id) => state.guests[id])
  if (ids.length < preset.minGuests) {
    return failed(presetId, `${preset.label} needs ${preset.minGuests === 1 ? 'a guest' : `at least ${preset.minGuests} different guests`}.`)
  }
  if (preset.maxGuests !== null && ids.length > preset.maxGuests) {
    return failed(presetId, `${preset.label} takes exactly ${preset.maxGuests} guests.`)
  }

  const note = preset.note
  const add: RuleDraft[] = []
  const skipped: PresetPlan['skipped'] = []
  const warnings: string[] = []
  const clusters = togetherClusters(state)

  const offer = (draft: RuleDraft) => {
    const dup = findDuplicateRule(state, draft)
    if (dup) skipped.push({ draft, reason: `already a rule: “${constraintText(state, dup)}”` })
    else add.push(draft)
  }

  /** Offers a zone rule; returns an error instead if the guest already has the opposite one. */
  const zoneRule = (guestId: string, zone: ZoneId, preference: 'near' | 'far'): string | null => {
    const opposite = findDuplicateRule(state, { type: 'zone', guestId, zone, preference: preference === 'near' ? 'far' : 'near' })
    if (opposite) return `${state.guests[guestId].name} already has the opposite rule: “${constraintText(state, opposite)}”. Remove it first.`
    offer({ type: 'zone', guestId, zone, preference, note })
    return null
  }

  if (presetId === 'divorced_parents_apart') {
    const [a, b] = ids
    if (clusters.find(a) === clusters.find(b)) {
      return failed(presetId, `${names(state, [a, b])} are tied together by sit-together rules. Remove those first.`)
    }
    offer({ type: 'apart', a, b, note })
    return { preset: presetId, add, skipped, warnings, fits: true }
  }

  if (presetId === 'away_from_band') {
    if (!state.venue.band?.enabled) {
      return failed(presetId, 'The band is hidden on the floor plan. Show it in the venue before adding rules around it.')
    }
    for (const id of ids) {
      const conflict = zoneRule(id, 'band', 'far')
      if (conflict) return failed(presetId, conflict)
    }
    return { preset: presetId, add, skipped, warnings, fits: true }
  }

  // The rest tie everyone to one anchor guest. The solver clusters
  // sit-together rules transitively, so a star of pairs is enough, and a pair
  // already joined through other rules needs no new one.
  const before = togetherClusters(state)
  let anchor = ids[0]
  if (presetId === 'head_table') {
    // Reuse whoever already sits near the dance floor as the anchor, so the
    // head table picks up one spot rule rather than one per person.
    anchor = ids.find((id) => findDuplicateRule(state, { type: 'zone', guestId: id, zone: 'dance_floor', preference: 'near' })) ?? ids[0]
  }
  for (const id of ids) {
    if (id === anchor) continue
    const draft: RuleDraft = { type: 'together', a: anchor, b: id, note }
    const dup = findDuplicateRule(state, draft)
    if (dup) {
      skipped.push({ draft, reason: `already a rule: “${constraintText(state, dup)}”` })
    } else if (clusters.find(anchor) === clusters.find(id)) {
      skipped.push({ draft, reason: `${names(state, [anchor, id])} are already tied together by other rules` })
    } else {
      add.push(draft)
      clusters.union(anchor, id)
    }
  }

  // A sit-together group that swallows a keep-apart pair can never be satisfied.
  for (const c of state.constraints) {
    if (c.type !== 'apart') continue
    if (clusters.find(c.a) === clusters.find(c.b) && before.find(c.a) !== before.find(c.b)) {
      return failed(presetId, `That would seat ${names(state, [c.a, c.b])} at one table, but a rule keeps them apart (“${constraintText(state, c)}”).`)
    }
  }

  // Who ends up in the group, including people already tied to the picks.
  const root = clusters.find(anchor)
  const group = state.guestOrder.filter((id) => clusters.find(id) === root)
  const extra = group.filter((id) => !ids.includes(id))
  if (extra.length > 0 && add.length > 0) {
    warnings.push(`Existing rules also bring ${names(state, extra)} along to the same table.`)
  }
  const largest = Math.max(0, ...state.tableOrder.map((id) => state.tables[id].seats))
  const fits = largest === 0 || group.length <= largest
  if (!fits) {
    warnings.push(`That makes ${group.length} people who must share a table, but the largest table seats ${largest}. Some of these rules will break.`)
  }

  if (presetId === 'head_table') {
    if (state.venue.dance_floor?.enabled) {
      const conflict = zoneRule(anchor, 'dance_floor', 'near')
      if (conflict) return failed(presetId, conflict)
    } else {
      warnings.push(`The dance floor is hidden, so the head table is kept together but not placed near ${zoneNoun('dance_floor')}.`)
    }
  }

  return { preset: presetId, add, skipped, warnings, fits }
}

/** One plain sentence about what applying a plan did (or would do). */
export function planSummary(state: AisleState, plan: PresetPlan): string {
  const preset = rulePreset(plan.preset)!
  if (plan.error) return plan.error
  if (plan.add.length === 0) return `${preset.label}: nothing to add — the chart already has ${plan.skipped.length === 1 ? 'that rule' : 'those rules'}.`
  const added = `${plan.add.length} rule${plan.add.length === 1 ? '' : 's'}`
  const skipped = plan.skipped.length > 0 ? ` (${plan.skipped.length} already in place)` : ''
  return `${preset.label}: added ${added}${skipped} — ${plan.add.map((d) => draftText(state, d)).join('; ')}.`
}

// ---- suggestions ------------------------------------------------------------

export interface PresetSuggestion {
  preset: RulePresetId
  guestIds: string[]
  /** Why the data points this way, in a few words, e.g. “Aunt Marta's note: Recently divorced from Dario”. */
  reason: string
}

const HONORIFICS = /^(aunt|auntie|uncle|cousin|grandma|grandpa|granny|nana|nonna|nonno|great-uncle|great-aunt|dr\.?|mr\.?|mrs\.?|ms\.?|mx\.?)$/i
const SPLIT = /divorc|separated|estranged|\bex\b|\bex-|exes/i
const FEUD = /dispute|feud|avoid|not speaking|hates/i
const COUPLE = /partner|plus[- ]?one|\+1|spouse|husband|wife|fianc|girlfriend|boyfriend|\bdate\b|\bwith\b|guest of/i
const QUIET = /speaker|loud|noise|hearing|quiet/i
const ELDER = /\b(grandma|grandpa|granny|grandmother|grandfather|nana|nonna|nonno|abuela|abuelo|oma|opa)\b/i
const KIDS_GROUP = /\b(kids?|children|child)\b/i
const HEAD_GROUP = /bridal party|wedding party|bridesmaids?|groomsm[ae]n|head table|sweetheart/i

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Other guests a note names — by full name, or by a first name only one guest has. */
function mentionedGuests(state: AisleState, text: string, selfId: string): string[] {
  const firstName = (name: string) => name.split(/\s+/).find((w) => !HONORIFICS.test(w)) ?? ''
  const firstCounts = new Map<string, number>()
  for (const id of state.guestOrder) {
    const f = firstName(state.guests[id].name).toLowerCase()
    firstCounts.set(f, (firstCounts.get(f) ?? 0) + 1)
  }
  const lower = text.toLowerCase()
  return state.guestOrder.filter((id) => {
    if (id === selfId) return false
    const name = state.guests[id].name
    if (lower.includes(name.toLowerCase())) return true
    const first = firstName(name)
    if (first.length < 2 || firstCounts.get(first.toLowerCase()) !== 1) return false
    return new RegExp(`\\b${escape(first)}\\b`, 'i').test(text)
  })
}

/**
 * Presets the guest list itself hints at: notes that mention a divorce or a
 * partner, a "Kids" group, a "Bridal party", a grandparent or a note about
 * loud speakers. Only suggestions — nothing here touches the chart, and a
 * suggestion the chart already satisfies (or that can't be applied) is left out.
 */
export function suggestRulePresets(state: AisleState): PresetSuggestion[] {
  const out: PresetSuggestion[] = []
  const seen = new Set<string>()
  const attending = state.guestOrder.filter((id) => state.guests[id].rsvp !== 'no')
  const push = (s: PresetSuggestion) => {
    const key = `${s.preset}:${[...s.guestIds].sort().join(',')}`
    if (seen.has(key)) return
    seen.add(key)
    const plan = planRulePreset(state, s.preset, s.guestIds)
    if (plan.error || plan.add.length === 0 || !plan.fits) return
    out.push(s)
  }

  for (const id of attending) {
    const g = state.guests[id]
    const note = g.notes ?? ''
    if (SPLIT.test(note)) {
      for (const other of mentionedGuests(state, note, id)) {
        push({ preset: 'divorced_parents_apart', guestIds: [id, other], reason: `${g.name}'s note: “${note}”` })
      }
    } else if (COUPLE.test(note) && !FEUD.test(note)) {
      for (const other of mentionedGuests(state, note, id)) {
        if (state.guests[other].rsvp === 'no') continue
        push({ preset: 'plus_ones_together', guestIds: [id, other], reason: `${g.name}'s note: “${note}”` })
      }
    }
    if (/plus[- ]?one|\+1|guest of/i.test(g.name)) {
      for (const other of mentionedGuests(state, g.name, id)) {
        push({ preset: 'plus_ones_together', guestIds: [other, id], reason: `${g.name} is listed as a plus-one` })
      }
    }
  }

  if (state.venue.band?.enabled) {
    const quiet = attending.filter((id) => QUIET.test(state.guests[id].notes ?? '') || ELDER.test(state.guests[id].name))
    for (const id of quiet) {
      const g = state.guests[id]
      push({
        preset: 'away_from_band',
        guestIds: [id],
        reason: QUIET.test(g.notes ?? '') ? `${g.name}'s note: “${g.notes}”` : `${g.name} may prefer a quieter table`,
      })
    }
  }

  for (const group of state.groupOrder) {
    const members = attending.filter((id) => state.guests[id].group === group)
    if (members.length < 2) continue
    if (KIDS_GROUP.test(group)) push({ preset: 'kids_table', guestIds: members, reason: `the “${group}” group` })
    else if (HEAD_GROUP.test(group)) push({ preset: 'head_table', guestIds: members, reason: `the “${group}” group` })
  }

  return out
}
