import { getCore, occupantsOf, useStore } from '../store'
import type { AisleState, Guest, RSVP, Table, ZoneId } from '../types'
import { computeViolations, constraintStatus, constraintText, dramaLabel, dramaScore } from '../constraints'
import { autoArrange } from '../solver'
import { SAMPLE } from '../sample'
import { parseGuestEntries } from '../utils'
import { syncTools, webmcpAvailable, type WebTool } from './adapter'

// ---- result helpers --------------------------------------------------------

interface HandlerResult {
  text: string
  touched?: string[]
  isError?: boolean
}

function ok(text: string, touched?: string[]): HandlerResult {
  return { text, touched }
}

function fail(text: string): HandlerResult {
  return { text, isError: true }
}

// ---- fuzzy lookup ----------------------------------------------------------

type Resolved<T> = { hit: T } | { err: string }

function resolveGuest(state: AisleState, query: unknown): Resolved<Guest> {
  const q = String(query ?? '').trim()
  if (!q) return { err: 'No guest given.' }
  if (state.guests[q]) return { hit: state.guests[q] }
  const lower = q.toLowerCase()
  const all = state.guestOrder.map((id) => state.guests[id])
  const exact = all.filter((g) => g.name.toLowerCase() === lower)
  if (exact.length === 1) return { hit: exact[0] }
  const partial = all.filter((g) => g.name.toLowerCase().includes(lower))
  if (partial.length === 1) return { hit: partial[0] }
  if (partial.length > 1) {
    return { err: `"${q}" matches several guests: ${partial.slice(0, 6).map((g) => g.name).join(', ')}. Be more specific.` }
  }
  return { err: `No guest matches "${q}". Use list_guests to see the roster.` }
}

function resolveTable(state: AisleState, query: unknown): Resolved<Table> {
  const q = String(query ?? '').trim()
  if (!q) return { err: 'No table given.' } as const
  if (state.tables[q]) return { hit: state.tables[q] } as const
  const lower = q.toLowerCase()
  const all = state.tableOrder.map((id) => state.tables[id])
  const exact = all.filter((t) => t.name.toLowerCase() === lower)
  if (exact.length === 1) return { hit: exact[0] } as const
  if (/^\d+$/.test(lower)) {
    const byNumber = all.filter((t) => t.name.toLowerCase() === `table ${lower}`)
    if (byNumber.length === 1) return { hit: byNumber[0] } as const
  }
  const partial = all.filter((t) => t.name.toLowerCase().includes(lower))
  if (partial.length === 1) return { hit: partial[0] } as const
  if (partial.length > 1) {
    return { err: `"${q}" matches several tables: ${partial.map((t) => t.name).join(', ')}.` } as const
  }
  return { err: `No table matches "${q}". Tables: ${all.map((t) => t.name).join(', ') || 'none yet'}.` } as const
}

// ---- formatting ------------------------------------------------------------

function guestLine(state: AisleState, g: Guest): string {
  const bits = [g.group]
  if (g.rsvp !== 'yes') bits.push(`RSVP ${g.rsvp}`)
  if (g.dietary.length) bits.push(g.dietary.join(', '))
  const seat = state.seating[g.id]
  bits.push(seat ? `at ${state.tables[seat.tableId]?.name}` : 'unseated')
  if (g.notes) bits.push(`note: ${g.notes}`)
  return `${g.name} — ${bits.join(' · ')}`
}

function roomSummary(state: AisleState): string {
  const attending = state.guestOrder.filter((id) => state.guests[id].rsvp !== 'no')
  const seated = attending.filter((id) => state.seating[id])
  const violations = computeViolations(state)
  const drama = dramaScore(violations)
  const seats = state.tableOrder.reduce((n, id) => n + state.tables[id].seats, 0)
  const lines: string[] = []
  lines.push(
    `${state.guestOrder.length} guests (${attending.length} attending) · ${state.tableOrder.length} tables, ${seats} seats · ${seated.length} seated, ${attending.length - seated.length} unseated · ${violations.length} violations · drama: ${dramaLabel(drama)}${state.finalized ? ' · FINALIZED' : ''}`,
  )
  for (const tid of state.tableOrder) {
    const t = state.tables[tid]
    const occ = occupantsOf(state, tid)
    lines.push(
      `${t.name} (${t.shape}, ${occ.length}/${t.seats}): ${occ.map((g) => state.guests[g]?.name).join(', ') || 'empty'}`,
    )
  }
  const unseated = attending.filter((id) => !state.seating[id])
  if (unseated.length) lines.push(`Unseated: ${unseated.map((id) => state.guests[id].name).join(', ')}`)
  if (state.constraints.length) {
    lines.push('Constraints:')
    for (const c of state.constraints) {
      lines.push(`  [${c.id}] ${constraintText(state, c)} — ${constraintStatus(state, c)}`)
    }
  }
  if (violations.length) {
    lines.push('Violations:')
    for (const v of violations) lines.push(`  ⚠ ${v.text}`)
  }
  return lines.join('\n')
}

// ---- tool construction -----------------------------------------------------

const CONSTRAINT_TYPES = [
  'must_sit_together',
  'must_sit_apart',
  'near_dance_floor',
  'far_from_dance_floor',
  'near_band',
  'far_from_band',
  'near_entrance',
  'far_from_entrance',
] as const

function parseConstraintType(type: string):
  | { kind: 'pair'; pair: 'together' | 'apart' }
  | { kind: 'zone'; zone: ZoneId; preference: 'near' | 'far' }
  | null {
  if (type === 'must_sit_together') return { kind: 'pair', pair: 'together' }
  if (type === 'must_sit_apart') return { kind: 'pair', pair: 'apart' }
  const m = type.match(/^(near|far)(?:_from)?_(dance_floor|band|entrance)$/)
  if (m) return { kind: 'zone', zone: m[2] as ZoneId, preference: m[1] as 'near' | 'far' }
  return null
}

function obj(properties: Record<string, unknown>, required: string[] = []) {
  return { type: 'object', properties, required, additionalProperties: false }
}

const str = (description: string, extra: Record<string, unknown> = {}) => ({ type: 'string', description, ...extra })

function makeTool(
  name: string,
  description: string,
  inputSchema: Record<string, unknown>,
  handler: (args: Record<string, unknown>) => HandlerResult,
  opts: { readOnly?: boolean } = {},
): WebTool {
  return {
    name,
    description,
    inputSchema,
    annotations: { readOnlyHint: opts.readOnly ?? false, title: name.replace(/_/g, ' ') },
    execute: async (rawArgs: unknown) => {
      const store = useStore.getState()
      store.setAgentConnected()
      let args: Record<string, unknown> = {}
      if (typeof rawArgs === 'string') {
        try {
          args = JSON.parse(rawArgs)
        } catch {
          args = {}
        }
      } else if (rawArgs && typeof rawArgs === 'object') {
        args = rawArgs as Record<string, unknown>
      }
      let result: HandlerResult
      try {
        result = handler(args)
      } catch (err) {
        result = fail(`Something went wrong in ${name}: ${err instanceof Error ? err.message : String(err)}`)
      }
      if (!opts.readOnly || result.isError) {
        useStore.getState().logActivity(name, result.text.split('\n')[0].slice(0, 140), 'agent')
      }
      if (result.touched?.length) useStore.getState().markTouched(result.touched)
      return {
        content: [{ type: 'text', text: result.text }],
        ...(result.isError ? { isError: true } : {}),
      }
    },
  }
}

// ---- the tools -------------------------------------------------------------

function baseTools(): WebTool[] {
  return [
    makeTool(
      'get_seating_chart',
      'Read the full current state of the wedding seating chart: every table with its occupants, unseated guests, all constraints with their status, current violations, and the drama score. Call this before making changes so you are working from the latest state — the human may have dragged guests around since your last call.',
      obj({}),
      () => ok(roomSummary(getCore())),
      { readOnly: true },
    ),
    makeTool(
      'list_guests',
      'List guests on the wedding guest list with their group, RSVP status, dietary needs, notes, and where they are seated. Optionally filter to only unseated guests, a specific group/party, or an RSVP status.',
      obj({
        filter: str('Optional filter', { enum: ['all', 'unseated', 'seated', 'pending_rsvp', 'declined'] }),
        group: str('Only guests in this group/party, e.g. "College friends"'),
      }),
      (args) => {
        const state = getCore()
        let ids = [...state.guestOrder]
        const filter = String(args.filter ?? 'all')
        if (filter === 'unseated') ids = ids.filter((id) => !state.seating[id] && state.guests[id].rsvp !== 'no')
        if (filter === 'seated') ids = ids.filter((id) => state.seating[id])
        if (filter === 'pending_rsvp') ids = ids.filter((id) => state.guests[id].rsvp === 'pending')
        if (filter === 'declined') ids = ids.filter((id) => state.guests[id].rsvp === 'no')
        if (args.group) {
          const q = String(args.group).toLowerCase()
          ids = ids.filter((id) => state.guests[id].group.toLowerCase().includes(q))
        }
        if (ids.length === 0) return ok('No guests match. The guest list may be empty — add_guest or import_guests will fix that.')
        return ok(`${ids.length} guest${ids.length === 1 ? '' : 's'}:\n${ids.map((id) => guestLine(state, state.guests[id])).join('\n')}`)
      },
      { readOnly: true },
    ),
    makeTool(
      'add_guest',
      'Add one guest to the wedding guest list. Give their name, and optionally their group/party (e.g. "Bride\'s family", "College friends"), dietary needs, RSVP status, and a free-form note (relationships, quirks, warnings).',
      obj(
        {
          name: str('Full name of the guest'),
          group: str('Group or party they belong to; defaults to "Guests"'),
          dietary: { type: 'array', items: { type: 'string' }, description: 'Dietary needs, e.g. ["vegetarian"]' },
          rsvp: str('RSVP status', { enum: ['yes', 'no', 'pending'] }),
          notes: str('Free-form note about this guest'),
        },
        ['name'],
      ),
      (args) => {
        const name = String(args.name ?? '').trim()
        if (!name) return fail('A guest needs a name.')
        const existing = Object.values(getCore().guests).find((g) => g.name.toLowerCase() === name.toLowerCase())
        if (existing) return fail(`${existing.name} is already on the list.`)
        const guest = useStore.getState().addGuest({
          name,
          group: args.group ? String(args.group) : undefined,
          dietary: Array.isArray(args.dietary) ? args.dietary.map(String) : [],
          rsvp: ['yes', 'no', 'pending'].includes(String(args.rsvp)) ? (String(args.rsvp) as RSVP) : 'yes',
          notes: args.notes ? String(args.notes) : undefined,
        })
        return ok(`Added ${guest.name} (${guest.group}). They are in the lounge, unseated.`, [guest.id])
      },
    ),
    makeTool(
      'update_guest',
      'Update a guest\'s details: name, group, dietary needs, RSVP status, or notes. Identify the guest by name (fuzzy match is fine). Setting RSVP to "no" frees up their seat.',
      obj(
        {
          guest: str('Name of the guest to update'),
          name: str('New name'),
          group: str('New group/party'),
          dietary: { type: 'array', items: { type: 'string' }, description: 'Replacement list of dietary needs' },
          rsvp: str('New RSVP status', { enum: ['yes', 'no', 'pending'] }),
          notes: str('Replacement note'),
        },
        ['guest'],
      ),
      (args) => {
        const state = getCore()
        const r = resolveGuest(state, args.guest)
        if ('err' in r) return fail(r.err)
        const patch: Partial<Guest> = {}
        if (args.name) patch.name = String(args.name)
        if (args.group) patch.group = String(args.group)
        if (Array.isArray(args.dietary)) patch.dietary = args.dietary.map(String)
        if (['yes', 'no', 'pending'].includes(String(args.rsvp))) patch.rsvp = String(args.rsvp) as RSVP
        if (args.notes !== undefined) patch.notes = String(args.notes)
        useStore.getState().updateGuest(r.hit.id, patch)
        return ok(`Updated ${patch.name ?? r.hit.name}.`, [r.hit.id])
      },
    ),
    makeTool(
      'remove_guest',
      'Remove a guest from the wedding entirely. Their seat is freed and any constraints involving them are dropped.',
      obj({ guest: str('Name of the guest to remove') }, ['guest']),
      (args) => {
        const state = getCore()
        const r = resolveGuest(state, args.guest)
        if ('err' in r) return fail(r.err)
        useStore.getState().removeGuest(r.hit.id)
        return ok(`Removed ${r.hit.name} from the guest list.`)
      },
    ),
    makeTool(
      'import_guests',
      'Bulk-import guests from pasted text — one guest per line, fields separated by " — ", " | " or tabs: name, then optionally group, dietary needs, and RSVP (yes/no/pending). Example: "Nora Flynn — Childhood friends — vegetarian". A JSON array of {name, group, dietary, rsvp, notes} objects also works. Duplicate names are skipped.',
      obj(
        {
          text: str('The pasted guest list'),
          default_group: str('Group to assign when a line does not specify one'),
        },
        ['text'],
      ),
      (args) => {
        const entries = parseGuestEntries(String(args.text ?? ''), args.default_group ? String(args.default_group) : undefined)
        if (entries.length === 0) return fail('Could not find any guest names in that text.')
        const added = useStore.getState().importGuests(entries)
        const skipped = entries.length - added.length
        return ok(
          `Imported ${added.length} guest${added.length === 1 ? '' : 's'}${skipped ? ` (${skipped} skipped as duplicates or blank)` : ''}. They are waiting in the lounge.`,
          added.map((g) => g.id),
        )
      },
    ),
    makeTool(
      'add_table',
      'Add a table to the room. Choose a name, seat count (2–16) and shape (round or rect). It is placed in an open spot; the human can drag it anywhere.',
      obj({
        name: str('Table name, e.g. "Table 11" or "Head table"; auto-numbered if omitted'),
        seats: { type: 'integer', minimum: 2, maximum: 16, description: 'Number of seats (default 8)' },
        shape: str('Table shape', { enum: ['round', 'rect'] }),
      }),
      (args) => {
        const table = useStore.getState().addTable({
          name: args.name ? String(args.name) : undefined,
          seats: typeof args.seats === 'number' ? args.seats : undefined,
          shape: args.shape === 'rect' ? 'rect' : 'round',
        })
        return ok(`Added ${table.name} (${table.shape}, ${table.seats} seats).`, [table.id])
      },
    ),
    makeTool(
      'add_constraint',
      'Add a seating rule. Pair rules: must_sit_together / must_sit_apart between guest_a and guest_b (same table vs. different tables). Zone rules for a single guest: near_dance_floor, far_from_dance_floor, near_band, far_from_band, near_entrance, far_from_entrance — "near" means one of the closest tables to that spot, "far" one of the farthest. Rules are enforced by auto_arrange and any breach shows up as a violation on the chart.',
      obj(
        {
          type: str('Kind of rule', { enum: [...CONSTRAINT_TYPES] }),
          guest_a: str('First guest (pair rules) or the guest (zone rules)'),
          guest_b: str('Second guest — pair rules only'),
          note: str('Why this rule exists, e.g. "recently divorced"'),
        },
        ['type', 'guest_a'],
      ),
      (args) => {
        const state = getCore()
        const parsed = parseConstraintType(String(args.type ?? ''))
        if (!parsed) return fail(`Unknown constraint type. Use one of: ${CONSTRAINT_TYPES.join(', ')}.`)
        const ra = resolveGuest(state, args.guest_a)
        if ('err' in ra) return fail(ra.err)
        const note = args.note ? String(args.note) : undefined
        if (parsed.kind === 'pair') {
          const rb = resolveGuest(state, args.guest_b)
          if ('err' in rb) return fail(`Pair rules need guest_b too. ${rb.err}`)
          if (ra.hit.id === rb.hit.id) return fail('That is the same guest twice.')
          const dup = state.constraints.find(
            (c) =>
              (c.type === 'together' || c.type === 'apart') &&
              c.type === parsed.pair &&
              ((c.a === ra.hit.id && c.b === rb.hit.id) || (c.a === rb.hit.id && c.b === ra.hit.id)),
          )
          if (dup) return fail(`That rule already exists (${dup.id}).`)
          const c = useStore.getState().addConstraint({ type: parsed.pair, a: ra.hit.id, b: rb.hit.id, note })
          const status = constraintStatus(getCore(), c)
          return ok(
            `Rule added [${c.id}]: ${constraintText(getCore(), c)}.${status === 'violated' ? ' It is currently VIOLATED — auto_arrange(mode:"repair") can fix it.' : ''}`,
            [ra.hit.id, rb.hit.id],
          )
        }
        const c = useStore.getState().addConstraint({
          type: 'zone',
          guestId: ra.hit.id,
          zone: parsed.zone,
          preference: parsed.preference,
          note,
        })
        const status = constraintStatus(getCore(), c)
        return ok(
          `Rule added [${c.id}]: ${constraintText(getCore(), c)}.${status === 'violated' ? ' It is currently VIOLATED — auto_arrange(mode:"repair") can fix it.' : ''}`,
          [ra.hit.id],
        )
      },
    ),
    makeTool(
      'remove_constraint',
      'Remove a seating rule by its id (see list_constraints or get_seating_chart), or remove every rule involving a named guest.',
      obj({
        constraint_id: str('The rule id, e.g. "c7"'),
        guest: str('Alternatively: remove all rules involving this guest'),
      }),
      (args) => {
        const state = getCore()
        if (args.constraint_id) {
          const id = String(args.constraint_id)
          const c = state.constraints.find((x) => x.id === id)
          if (!c) return fail(`No rule with id "${id}".`)
          useStore.getState().removeConstraint(id)
          return ok(`Removed rule: ${constraintText(state, c)}.`)
        }
        if (args.guest) {
          const r = resolveGuest(state, args.guest)
          if ('err' in r) return fail(r.err)
          const involved = state.constraints.filter((c) =>
            c.type === 'zone' ? c.guestId === r.hit.id : c.a === r.hit.id || c.b === r.hit.id,
          )
          if (involved.length === 0) return ok(`${r.hit.name} has no rules.`)
          for (const c of involved) useStore.getState().removeConstraint(c.id)
          return ok(`Removed ${involved.length} rule${involved.length === 1 ? '' : 's'} involving ${r.hit.name}.`)
        }
        return fail('Give a constraint_id or a guest name.')
      },
    ),
    makeTool(
      'list_constraints',
      'List every seating rule with its id and current status: ok, violated, or pending (someone involved is not seated yet).',
      obj({}),
      () => {
        const state = getCore()
        if (state.constraints.length === 0) return ok('No seating rules yet. add_constraint creates them.')
        return ok(
          state.constraints
            .map((c) => `[${c.id}] ${constraintText(state, c)} — ${constraintStatus(state, c)}${c.note ? ` (${c.note})` : ''}`)
            .join('\n'),
        )
      },
      { readOnly: true },
    ),
    makeTool(
      'load_sample_wedding',
      'Replace the current chart with the built-in sample wedding: 72 named guests in 8 groups, 10 tables, and 17 seating rules including divorced relatives, exes, and a grandmother who hates loud speakers. Great for a demo. Everyone starts unseated; the previous chart can be restored with undo.',
      obj({}),
      () => {
        useStore.getState().loadSample(SAMPLE)
        return ok(
          'Sample wedding loaded: 72 guests, 10 tables (84 seats), 17 rules. Everyone is in the lounge — auto_arrange will seat them.',
        )
      },
    ),
  ]
}

function seatingTools(): WebTool[] {
  return [
    makeTool(
      'update_table',
      'Rename a table, change its seat count (2–16), or change its shape (round/rect). Shrinking a table below its occupancy politely bumps the extra guests back to the lounge.',
      obj(
        {
          table: str('Table to change, by name'),
          name: str('New name'),
          seats: { type: 'integer', minimum: 2, maximum: 16, description: 'New seat count' },
          shape: str('New shape', { enum: ['round', 'rect'] }),
        },
        ['table'],
      ),
      (args) => {
        const state = getCore()
        const r = resolveTable(state, args.table)
        if ('err' in r) return fail(r.err)
        const { unseated } = useStore.getState().updateTable(r.hit.id, {
          ...(args.name ? { name: String(args.name) } : {}),
          ...(typeof args.seats === 'number' ? { seats: args.seats } : {}),
          ...(args.shape === 'round' || args.shape === 'rect' ? { shape: args.shape } : {}),
        })
        const after = getCore().tables[r.hit.id]
        let text = `${r.hit.name} is now "${after.name}" (${after.shape}, ${after.seats} seats).`
        if (unseated.length) {
          text += ` ${unseated.map((id) => state.guests[id]?.name).join(', ')} lost their seat${unseated.length === 1 ? '' : 's'} and moved to the lounge.`
        }
        return ok(text, [r.hit.id, ...unseated])
      },
    ),
    makeTool(
      'remove_table',
      'Remove a table from the room. Its guests move back to the lounge (unseated) — reseat them with auto_arrange or seat_guest.',
      obj({ table: str('Table to remove, by name') }, ['table']),
      (args) => {
        const state = getCore()
        const r = resolveTable(state, args.table)
        if ('err' in r) return fail(r.err)
        const { unseated } = useStore.getState().removeTable(r.hit.id)
        return ok(
          `Removed ${r.hit.name}.${unseated.length ? ` ${unseated.length} guest${unseated.length === 1 ? '' : 's'} moved to the lounge: ${unseated.map((id) => state.guests[id]?.name).join(', ')}.` : ''}`,
          unseated,
        )
      },
    ),
    makeTool(
      'seat_guest',
      'Seat a guest at a specific table (first free seat). Fails with an explanation if the table is full. The chart animates the move so the human can follow it.',
      obj({ guest: str('Guest to seat'), table: str('Table to seat them at') }, ['guest', 'table']),
      (args) => {
        const state = getCore()
        const rg = resolveGuest(state, args.guest)
        if ('err' in rg) return fail(rg.err)
        const rt = resolveTable(state, args.table)
        if ('err' in rt) return fail(rt.err)
        const res = useStore.getState().seatGuest(rg.hit.id, rt.hit.id)
        if (!res.ok) {
          const free = state.tableOrder
            .map((id) => state.tables[id])
            .map((t) => ({ t, free: t.seats - occupantsOf(state, t.id).length }))
            .filter((x) => x.free > 0)
            .map((x) => `${x.t.name} (${x.free} free)`)
          return fail(`${res.error}. Tables with space: ${free.join(', ') || 'none — add a table'}.`)
        }
        const violations = computeViolations(getCore()).filter(
          (v) => (v.kind === 'together' || v.kind === 'apart') && (v.a === rg.hit.id || v.b === rg.hit.id),
        )
        let text = `${rg.hit.name} is now at ${rt.hit.name}.`
        if (violations.length) text += ` Heads-up: ${violations.map((v) => v.text).join('; ')}.`
        return ok(text, [rg.hit.id, rt.hit.id])
      },
    ),
    makeTool(
      'unseat_guest',
      'Remove a guest from their table and send them back to the lounge (still on the guest list).',
      obj({ guest: str('Guest to unseat') }, ['guest']),
      (args) => {
        const state = getCore()
        const r = resolveGuest(state, args.guest)
        if ('err' in r) return fail(r.err)
        if (!state.seating[r.hit.id]) return ok(`${r.hit.name} is already unseated.`)
        useStore.getState().unseatGuest(r.hit.id)
        return ok(`${r.hit.name} is back in the lounge.`, [r.hit.id])
      },
    ),
    makeTool(
      'swap_guests',
      'Swap the seats of two guests. If one is unseated, they simply take the other\'s seat.',
      obj({ guest_a: str('First guest'), guest_b: str('Second guest') }, ['guest_a', 'guest_b']),
      (args) => {
        const state = getCore()
        const ra = resolveGuest(state, args.guest_a)
        if ('err' in ra) return fail(ra.err)
        const rb = resolveGuest(state, args.guest_b)
        if ('err' in rb) return fail(rb.err)
        if (ra.hit.id === rb.hit.id) return fail('That is the same guest twice.')
        useStore.getState().swapGuests(ra.hit.id, rb.hit.id)
        const after = getCore()
        const where = (id: string) => (after.seating[id] ? after.tables[after.seating[id].tableId].name : 'the lounge')
        return ok(`Swapped: ${ra.hit.name} is now at ${where(ra.hit.id)}, ${rb.hit.name} at ${where(rb.hit.id)}.`, [ra.hit.id, rb.hit.id])
      },
    ),
    makeTool(
      'auto_arrange',
      'Arrange the seating automatically, honoring every rule: couples together, feuds apart, near/far zone preferences, groups kept coherent, tables balanced. mode "full" (default) redesigns the whole room; mode "repair" fixes current violations and seats stragglers while moving as few guests as possible — use it after the human hand-moves someone into trouble. Returns a plain-language explanation of what it did and anything it could not satisfy. The chart animates the changes.',
      obj({
        mode: str('"full" re-seats everyone; "repair" makes minimal fixes', { enum: ['full', 'repair'] }),
      }),
      (args) => {
        const state = getCore()
        const attending = state.guestOrder.filter((id) => state.guests[id].rsvp !== 'no')
        if (attending.length === 0) return fail('There are no attending guests to seat. Add guests first.')
        const mode = args.mode === 'repair' ? 'repair' : 'full'
        const before = state.seating
        const result = autoArrange(state, { mode })
        useStore.getState().applyArrangement(result.assignments)
        const touched = attending.filter(
          (id) => (before[id]?.tableId ?? '') !== (result.assignments[id]?.tableId ?? ''),
        )
        const tables = new Set(touched.map((id) => result.assignments[id]?.tableId).filter(Boolean) as string[])
        return ok(result.explanation, [...touched, ...tables])
      },
    ),
    makeTool(
      'clear_seating',
      'Unseat everyone — the guest list, tables and rules stay. A blank canvas for auto_arrange.',
      obj({}),
      () => {
        const state = getCore()
        const seatedCount = Object.keys(state.seating).length
        if (seatedCount === 0) return ok('Nobody is seated; nothing to clear.')
        useStore.getState().clearSeating()
        return ok(`Cleared ${seatedCount} seat assignment${seatedCount === 1 ? '' : 's'}. Everyone is in the lounge.`)
      },
    ),
    makeTool(
      'list_unseated',
      'List attending guests who do not have a seat yet.',
      obj({}),
      () => {
        const state = getCore()
        const unseated = state.guestOrder.filter((id) => !state.seating[id] && state.guests[id].rsvp !== 'no')
        if (unseated.length === 0) return ok('Everyone attending has a seat. 🎉')
        return ok(`${unseated.length} unseated:\n${unseated.map((id) => guestLine(state, state.guests[id])).join('\n')}`)
      },
      { readOnly: true },
    ),
    makeTool(
      'list_violations',
      'List every seating rule currently being violated, plus the drama score. An empty list means the room is at peace.',
      obj({}),
      () => {
        const state = getCore()
        const violations = computeViolations(state)
        if (violations.length === 0) return ok('No violations — the room is at peace. Drama: Serene.')
        const score = dramaScore(violations)
        return ok(
          `${violations.length} violation${violations.length === 1 ? '' : 's'} · drama: ${dramaLabel(score)} (${score})\n${violations.map((v) => `⚠ ${v.text}`).join('\n')}\nauto_arrange(mode:"repair") fixes these with minimal moves.`,
        )
      },
      { readOnly: true },
    ),
  ]
}

function finalizeTools(): WebTool[] {
  return [
    makeTool(
      'finalize_chart',
      'Every attending guest is seated and no rules are violated — lock in the chart and get a formatted seating list (per table, with groups and dietary needs) ready to hand to the caterer and calligrapher. This tool only exists while the chart is perfect.',
      obj({}),
      () => {
        const state = getCore()
        const violations = computeViolations(state)
        if (violations.length > 0) return fail('Violations crept back in — fix them first (list_violations).')
        useStore.getState().setFinalized(true)
        const lines: string[] = ['# Seating chart — final', '']
        for (const tid of state.tableOrder) {
          const t = state.tables[tid]
          const occ = occupantsOf(state, tid)
          if (occ.length === 0) continue
          lines.push(`## ${t.name} (${occ.length}/${t.seats})`)
          for (const gid of occ) {
            const g = state.guests[gid]
            lines.push(`- ${g.name} — ${g.group}${g.dietary.length ? ` · ${g.dietary.join(', ')}` : ''}`)
          }
          lines.push('')
        }
        const dietary = state.guestOrder
          .map((id) => state.guests[id])
          .filter((g) => state.seating[g.id] && g.dietary.length > 0)
        if (dietary.length) {
          lines.push('## Dietary summary')
          for (const g of dietary) lines.push(`- ${g.name}: ${g.dietary.join(', ')}`)
        }
        return ok(`Chart finalized and locked in. 🥂\n\n${lines.join('\n')}`)
      },
    ),
  ]
}

// ---- dynamic registration --------------------------------------------------

function toolFlags(state: AisleState) {
  const attending = state.guestOrder.filter((id) => state.guests[id].rsvp !== 'no')
  const allSeated = attending.length > 0 && attending.every((id) => state.seating[id])
  const canFinalize = allSeated && computeViolations(state).length === 0
  return { hasTables: state.tableOrder.length > 0, canFinalize }
}

export function currentTools(): WebTool[] {
  const flags = toolFlags(getCore())
  return [
    ...baseTools(),
    ...(flags.hasTables ? seatingTools() : []),
    ...(flags.canFinalize ? finalizeTools() : []),
  ]
}

export function initWebMCP(): void {
  const apply = () => {
    const tools = currentTools()
    const available = syncTools(tools)
    const st = useStore.getState()
    const names = tools.map((t) => t.name)
    if (st.webmcpAvailable !== available || st.toolNames.join() !== names.join()) {
      st.setWebmcp(available, names)
    }
  }

  apply()

  let lastSig = ''
  useStore.subscribe((s) => {
    const flags = toolFlags(s)
    const sig = `${flags.hasTables}|${flags.canFinalize}`
    if (sig !== lastSig) {
      lastSig = sig
      apply()
    }
  })

  // Console escape hatch: lets anyone exercise the exact same tools without an
  // agent browser — `aisle.tools()` / `aisle.call('auto_arrange', {mode:'full'})`.
  const debug = {
    tools: () => currentTools().map((t) => t.name),
    call: async (name: string, args: Record<string, unknown> = {}) => {
      const tool = currentTools().find((t) => t.name === name)
      if (!tool) throw new Error(`No such tool: ${name}. Available: ${currentTools().map((t) => t.name).join(', ')}`)
      const result = (await tool.execute(args)) as { content: { text: string }[] }
      console.log(result.content[0]?.text)
      return result
    },
  }
  ;(window as unknown as { aisle: typeof debug }).aisle = debug

  if (!webmcpAvailable()) {
    console.info(
      '[aisle] No WebMCP surface found (navigator.modelContext / document.modelContext). ' +
        'The app works standalone; agent tools will register automatically in a WebMCP-enabled browser. ' +
        'Try aisle.tools() and aisle.call(name, args) in this console to exercise the same tools by hand.',
    )
  }
}
