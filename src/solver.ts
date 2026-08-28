import type { AisleState, SeatAssignment, ZoneId } from './types'
import { zoneBands } from './geometry'
import { zoneNoun } from './constraints'

export interface ArrangeResult {
  assignments: Record<string, SeatAssignment>
  explanation: string
  unplaced: string[]
  movedCount: number
}

/** Deterministic RNG so the same request produces the same room. */
function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Ctx {
  state: AisleState
  attendees: string[]
  tables: string[]
  capacity: Record<string, number>
  bands: Record<ZoneId, ReturnType<typeof zoneBands>>
  pairs: { type: 'together' | 'apart'; a: string; b: string; id: string }[]
  zones: { guestId: string; zone: ZoneId; preference: 'near' | 'far'; id: string }[]
}

function buildCtx(state: AisleState): Ctx {
  const attendees = state.guestOrder.filter((id) => state.guests[id].rsvp !== 'no')
  const att = new Set(attendees)
  const pairs: Ctx['pairs'] = []
  const zones: Ctx['zones'] = []
  for (const c of state.constraints) {
    if (c.type === 'zone') {
      if (att.has(c.guestId) && state.venue[c.zone]?.enabled) {
        zones.push({ guestId: c.guestId, zone: c.zone, preference: c.preference, id: c.id })
      }
    } else if (att.has(c.a) && att.has(c.b)) {
      pairs.push({ type: c.type, a: c.a, b: c.b, id: c.id })
    }
  }
  return {
    state,
    attendees,
    tables: [...state.tableOrder],
    capacity: Object.fromEntries(state.tableOrder.map((id) => [id, state.tables[id].seats])),
    bands: {
      dance_floor: zoneBands(state, 'dance_floor'),
      band: zoneBands(state, 'band'),
      entrance: zoneBands(state, 'entrance'),
    },
    pairs,
    zones,
  }
}

function zoneOk(ctx: Ctx, z: Ctx['zones'][number], tableId: string): boolean {
  const b = ctx.bands[z.zone]
  const d = b.byTable[tableId]
  if (d === undefined) return true
  return z.preference === 'near' ? d <= b.nearMax : d >= b.farMin
}

/** Lower is better. `at` maps guestId -> tableId ('' = unseated). */
function scoreAll(ctx: Ctx, at: Record<string, string>, baseline?: Record<string, string>): number {
  let score = 0
  for (const g of ctx.attendees) if (!at[g]) score += 50
  // Repair mode: every guest displaced from where they were costs a little,
  // so fixes disturb as few seats as possible.
  if (baseline) {
    for (const g of ctx.attendees) {
      if (baseline[g] && at[g] !== baseline[g]) score += 1.5
    }
  }
  for (const p of ctx.pairs) {
    const ta = at[p.a]
    const tb = at[p.b]
    if (p.type === 'together') {
      if (ta && tb) score += ta === tb ? 0 : 30
      else score += 15
    } else if (ta && tb && ta === tb) score += 30
  }
  for (const z of ctx.zones) {
    const t = at[z.guestId]
    if (t && !zoneOk(ctx, z, t)) score += 12
  }
  // Cohesion: tables reading as a mix of many parties feel worse than tables
  // that mostly share a group.
  const groupsAt: Record<string, Set<string>> = {}
  for (const g of ctx.attendees) {
    const t = at[g]
    if (!t) continue
    ;(groupsAt[t] ??= new Set()).add(ctx.state.guests[g].group)
  }
  for (const t of Object.keys(groupsAt)) score += (groupsAt[t].size - 1) * 2
  return score
}

function unionFind(ctx: Ctx): Map<string, string[]> {
  const parent: Record<string, string> = {}
  const find = (x: string): string => (parent[x] === x ? x : (parent[x] = find(parent[x])))
  for (const g of ctx.attendees) parent[g] = g
  for (const p of ctx.pairs) {
    if (p.type !== 'together') continue
    const ra = find(p.a)
    const rb = find(p.b)
    if (ra !== rb) parent[ra] = rb
  }
  const clusters = new Map<string, string[]>()
  for (const g of ctx.attendees) {
    const r = find(g)
    if (!clusters.has(r)) clusters.set(r, [])
    clusters.get(r)!.push(g)
  }
  return clusters
}

export function autoArrange(
  state: AisleState,
  opts: { mode?: 'full' | 'repair' } = {},
): ArrangeResult {
  const mode = opts.mode ?? 'full'
  const ctx = buildCtx(state)
  const rnd = mulberry32(7)

  if (ctx.tables.length === 0) {
    return { assignments: {}, explanation: 'There are no tables yet — add tables first.', unplaced: ctx.attendees, movedCount: 0 }
  }

  const totalSeats = ctx.tables.reduce((n, t) => n + ctx.capacity[t], 0)
  const at: Record<string, string> = {}
  const before: Record<string, string> = {}
  for (const g of ctx.attendees) before[g] = state.seating[g]?.tableId ?? ''

  const occupancy: Record<string, number> = Object.fromEntries(ctx.tables.map((t) => [t, 0]))
  const seatIn = (g: string, t: string) => {
    if (at[g]) occupancy[at[g]]--
    at[g] = t
    if (t) occupancy[t]++
  }

  const splitClusters: string[] = []

  if (mode === 'repair') {
    for (const g of ctx.attendees) if (before[g]) seatIn(g, before[g])
  } else {
    // Greedy seed: place together-clusters (largest and most-constrained first).
    const clusters = [...unionFind(ctx).values()]
    const zoneByGuest = new Map(ctx.zones.map((z) => [z.guestId, z]))
    clusters.sort((a, b) => {
      const za = a.filter((g) => zoneByGuest.has(g)).length
      const zb = b.filter((g) => zoneByGuest.has(g)).length
      return zb - za || b.length - a.length
    })
    for (let cluster of clusters) {
      const maxTable = Math.max(...ctx.tables.map((t) => ctx.capacity[t]))
      if (cluster.length > maxTable) {
        splitClusters.push(ctx.state.guests[cluster[0]].group)
        cluster = cluster.slice(0, maxTable)
      }
      let bestT = ''
      let bestCost = Infinity
      for (const t of ctx.tables) {
        if (ctx.capacity[t] - occupancy[t] < cluster.length) continue
        let cost = 0
        for (const g of cluster) {
          const z = zoneByGuest.get(g)
          if (z && !zoneOk(ctx, z, t)) cost += 12
          for (const p of ctx.pairs) {
            if (p.type !== 'apart') continue
            const other = p.a === g ? p.b : p.b === g ? p.a : ''
            if (other && at[other] === t) cost += 30
          }
        }
        const groups = new Set(
          ctx.attendees.filter((g) => at[g] === t).map((g) => ctx.state.guests[g].group),
        )
        const clusterGroups = new Set(cluster.map((g) => ctx.state.guests[g].group))
        for (const cg of clusterGroups) if (groups.size > 0 && !groups.has(cg)) cost += 2
        cost += ((occupancy[t] + cluster.length) / ctx.capacity[t]) * 3
        cost += rnd() * 0.5
        if (cost < bestCost) {
          bestCost = cost
          bestT = t
        }
      }
      if (bestT) for (const g of cluster) seatIn(g, bestT)
    }
  }

  // Local search. In repair mode only guests tied to a problem may move.
  let movable = new Set(ctx.attendees)
  if (mode === 'repair') {
    movable = new Set(ctx.attendees.filter((g) => !at[g]))
    const flagged = () => {
      for (const p of ctx.pairs) {
        const same = at[p.a] && at[p.a] === at[p.b]
        if ((p.type === 'apart' && same) || (p.type === 'together' && !same)) {
          movable.add(p.a)
          movable.add(p.b)
        }
      }
      for (const z of ctx.zones) {
        if (at[z.guestId] && !zoneOk(ctx, z, at[z.guestId])) movable.add(z.guestId)
      }
    }
    flagged()
  }

  const baseline = mode === 'repair' ? before : undefined
  let current = scoreAll(ctx, at, baseline)
  const movableArr = [...movable]
  const iterations = mode === 'repair' ? 2500 : 6000
  const pool = mode === 'repair' ? movableArr : ctx.attendees
  if (pool.length > 0) {
    for (let i = 0; i < iterations && current > 0; i++) {
      const g = pool[Math.floor(rnd() * pool.length)]
      const prevT = at[g]
      let candidateSwap = ''
      let candT = ''
      if (rnd() < 0.5) {
        candT = ctx.tables[Math.floor(rnd() * ctx.tables.length)]
        if (candT === prevT || occupancy[candT] >= ctx.capacity[candT]) continue
      } else {
        candidateSwap = ctx.attendees[Math.floor(rnd() * ctx.attendees.length)]
        if (candidateSwap === g) continue
        if (mode === 'repair' && !movable.has(candidateSwap) && !movable.has(g)) continue
        candT = at[candidateSwap]
        if (candT === prevT) continue
      }
      // Try the move.
      const swapPrev = candidateSwap ? at[candidateSwap] : ''
      if (candidateSwap) {
        seatIn(candidateSwap, prevT)
        seatIn(g, candT)
      } else {
        seatIn(g, candT)
      }
      const next = scoreAll(ctx, at, baseline)
      if (next <= current) {
        current = next
      } else {
        // Revert.
        if (candidateSwap) {
          seatIn(candidateSwap, swapPrev)
        }
        seatIn(g, prevT)
      }
    }
  }

  // Turn table choices into seat numbers, keeping together-clusters adjacent
  // and preserving untouched seats in repair mode.
  const assignments: Record<string, SeatAssignment> = {}
  const clusterOf = new Map<string, number>()
  let ci = 0
  for (const members of unionFind(ctx).values()) {
    ci++
    for (const g of members) clusterOf.set(g, ci)
  }
  for (const t of ctx.tables) {
    const members = ctx.attendees.filter((g) => at[g] === t)
    members.sort((a, b) => {
      const ca = clusterOf.get(a) ?? 0
      const cb = clusterOf.get(b) ?? 0
      if (ca !== cb) return ca - cb
      return ctx.state.guests[a].group.localeCompare(ctx.state.guests[b].group)
    })
    const used = new Set<number>()
    const later: string[] = []
    if (mode === 'repair') {
      for (const g of members) {
        const prev = state.seating[g]
        if (prev && prev.tableId === t && prev.seat < ctx.capacity[t] && !used.has(prev.seat)) {
          assignments[g] = { tableId: t, seat: prev.seat }
          used.add(prev.seat)
        } else later.push(g)
      }
    } else {
      later.push(...members)
    }
    let s = 0
    for (const g of later) {
      while (used.has(s)) s++
      assignments[g] = { tableId: t, seat: s }
      used.add(s)
    }
  }

  const unplaced = ctx.attendees.filter((g) => !at[g])
  const movedCount = ctx.attendees.filter((g) => (before[g] || '') !== (at[g] || '')).length

  // ---- Narration ----------------------------------------------------------
  const name = (id: string) => state.guests[id]?.name ?? id
  const tname = (id: string) => state.tables[id]?.name ?? id
  const lines: string[] = []
  const seatedCount = ctx.attendees.length - unplaced.length
  lines.push(
    mode === 'repair'
      ? `Repaired the chart, moving only ${movedCount} guest${movedCount === 1 ? '' : 's'}.`
      : `Seated ${seatedCount} of ${ctx.attendees.length} attending guests across ${ctx.tables.length} tables (${totalSeats} seats).`,
  )
  const declined = state.guestOrder.length - ctx.attendees.length
  if (mode === 'full' && declined > 0) lines.push(`${declined} guest${declined === 1 ? '' : 's'} declined and stay off the chart.`)

  if (mode === 'repair' && movedCount > 0) {
    const moves = ctx.attendees
      .filter((g) => (before[g] || '') !== (at[g] || ''))
      .slice(0, 8)
      .map((g) => `${name(g)}: ${before[g] ? tname(before[g]) : 'unseated'} → ${at[g] ? tname(at[g]) : 'unseated'}`)
    lines.push(...moves)
  }

  const satisfied: string[] = []
  const failed: string[] = []
  for (const p of ctx.pairs) {
    const same = at[p.a] && at[p.a] === at[p.b]
    const ok = p.type === 'together' ? !!same : !same || !at[p.a] || !at[p.b]
    const desc =
      p.type === 'together'
        ? `${name(p.a)} with ${name(p.b)}${same ? ` at ${tname(at[p.a])}` : ''}`
        : `${name(p.a)} and ${name(p.b)} kept apart`
    ;(ok ? satisfied : failed).push(desc)
  }
  for (const z of ctx.zones) {
    const t = at[z.guestId]
    const ok = !t ? false : zoneOk(ctx, z, t)
    const desc = t
      ? `${name(z.guestId)} at ${tname(t)}, ${z.preference === 'near' ? 'near' : 'well away from'} ${zoneNoun(z.zone)}`
      : `${name(z.guestId)} ${z.preference} ${zoneNoun(z.zone)} (still unseated)`
    ;(ok ? satisfied : failed).push(desc)
  }
  if (satisfied.length > 0) {
    lines.push(`Honored ${satisfied.length} of ${satisfied.length + failed.length} constraints, e.g.: ${satisfied.slice(0, 4).join('; ')}.`)
  }
  if (failed.length > 0) {
    lines.push(`Could not fully satisfy: ${failed.join('; ')}. Consider another table nearby, or loosen one of these.`)
  }
  if (splitClusters.length > 0) {
    lines.push(`Note: a sit-together group in ${splitClusters.join(', ')} was larger than the biggest table and had to be trimmed.`)
  }
  if (unplaced.length > 0) {
    lines.push(`Still unseated (${unplaced.length}): ${unplaced.map(name).join(', ')} — the room needs more seats.`)
  }
  if (mode === 'full') {
    // Where each party ended up, for a quick read of the room.
    const byGroup = new Map<string, Set<string>>()
    for (const g of ctx.attendees) {
      if (!at[g]) continue
      const grp = state.guests[g].group
      if (!byGroup.has(grp)) byGroup.set(grp, new Set())
      byGroup.get(grp)!.add(tname(at[g]))
    }
    const summary = [...byGroup.entries()]
      .map(([grp, ts]) => `${grp}: ${[...ts].join(', ')}`)
      .join(' · ')
    if (summary) lines.push(summary)
  }

  return { assignments, explanation: lines.join('\n'), unplaced, movedCount }
}
