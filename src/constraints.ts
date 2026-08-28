import type { AisleState, Constraint, Violation, ZoneId } from './types'
import { ZONES, zoneBands } from './geometry'

const ZONE_LABEL: Record<ZoneId, string> = {
  dance_floor: 'the dance floor',
  band: 'the band',
  entrance: 'the entrance',
}

export function constraintText(state: AisleState, c: Constraint): string {
  const name = (id: string) => state.guests[id]?.name ?? 'someone'
  switch (c.type) {
    case 'together':
      return `${name(c.a)} and ${name(c.b)} sit together`
    case 'apart':
      return `${name(c.a)} and ${name(c.b)} sit apart`
    case 'zone':
      return `${name(c.guestId)} sits ${c.preference === 'near' ? 'near' : 'away from'} ${ZONE_LABEL[c.zone]}`
  }
}

export type ConstraintStatus = 'ok' | 'violated' | 'pending'

/** pending = can't be judged yet because someone involved isn't seated. */
export function constraintStatus(state: AisleState, c: Constraint): ConstraintStatus {
  if (c.type === 'together' || c.type === 'apart') {
    const sa = state.seating[c.a]
    const sb = state.seating[c.b]
    if (!sa || !sb) return 'pending'
    const same = sa.tableId === sb.tableId
    return (c.type === 'together') === same ? 'ok' : 'violated'
  }
  const s = state.seating[c.guestId]
  if (!s) return 'pending'
  const bands = zoneBands(state, c.zone)
  const d = bands.byTable[s.tableId]
  if (d === undefined) return 'pending'
  const ok = c.preference === 'near' ? d <= bands.nearMax : d >= bands.farMin
  return ok ? 'ok' : 'violated'
}

export function computeViolations(state: AisleState): Violation[] {
  const out: Violation[] = []
  for (const c of state.constraints) {
    if (constraintStatus(state, c) !== 'violated') continue
    if (c.type === 'together' || c.type === 'apart') {
      out.push({
        kind: c.type,
        constraintId: c.id,
        a: c.a,
        b: c.b,
        text:
          c.type === 'apart'
            ? `${state.guests[c.a]?.name} and ${state.guests[c.b]?.name} are at the same table — they need space`
            : `${state.guests[c.a]?.name} and ${state.guests[c.b]?.name} are split across tables — they belong together`,
      })
    } else {
      const table = state.tables[state.seating[c.guestId]!.tableId]
      out.push({
        kind: 'zone',
        constraintId: c.id,
        guestId: c.guestId,
        zone: c.zone,
        preference: c.preference,
        text: `${state.guests[c.guestId]?.name} is at ${table?.name}, ${
          c.preference === 'near' ? 'too far from' : 'too close to'
        } ${ZONE_LABEL[c.zone]}`,
      })
    }
  }
  for (const tid of state.tableOrder) {
    const t = state.tables[tid]
    const occupancy = Object.values(state.seating).filter((s) => s.tableId === tid).length
    if (occupancy > t.seats) {
      out.push({
        kind: 'overfull',
        tableId: tid,
        text: `${t.name} is over capacity: ${occupancy} guests for ${t.seats} seats`,
      })
    }
  }
  return out
}

export function dramaScore(violations: Violation[]): number {
  let score = 0
  for (const v of violations) {
    if (v.kind === 'apart') score += 3
    else if (v.kind === 'together') score += 2
    else if (v.kind === 'overfull') score += 2
    else score += 1
  }
  return score
}

export function dramaLabel(score: number): string {
  if (score === 0) return 'Serene'
  if (score <= 3) return 'A little tension'
  if (score <= 7) return 'Simmering'
  if (score <= 11) return 'Spicy'
  return 'Full telenovela'
}

export function zoneLabel(zone: ZoneId): string {
  return ZONES[zone].label
}

export function zoneNoun(zone: ZoneId): string {
  return ZONE_LABEL[zone]
}
