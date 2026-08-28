import { getCore, occupantsOf, uid, useStore } from '../store'
import type { AisleState, Guest, RSVP, Table, VenueFeatureId, ZoneId } from '../types'
import { ROOM, featureMinSize, feetSize, formatFeet, layoutConflicts, roomRect, stageUnitsPerFoot, tableBodyBounds, zoneBands } from '../geometry'
import { computeViolations, constraintStatus, constraintText, dramaLabel, dramaScore, findDuplicateRule } from '../constraints'
import { autoArrange } from '../solver'
import { SAMPLE } from '../sample'
import { chartMarkdown, parseGuestEntries } from '../utils'
import { buildDocModel, chartCSV, type ExportSections, type PaperSize } from '../export/model'
import { loadExportOptions, saveExportOptions } from '../export/options'
import { syncTools, webmcpAvailable, type WebTool } from './adapter'
import { choreograph, glance, touchAgentSession } from '../agentCursor'

// ---- result helpers --------------------------------------------------------

interface HandlerResult {
  text: string
  touched?: string[]
  isError?: boolean
  /** Runs after the choreography settles; its return is appended to the reply.
   *  Lets a tool hold its answer open for something slower than animation —
   *  like a human deciding on a proposal. */
  finish?: () => Promise<string>
}

function ok(text: string, touched?: string[]): HandlerResult {
  return { text, touched }
}

function fail(text: string): HandlerResult {
  return { text, isError: true }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Never let a stuck animation hold a tool reply hostage. */
const MAX_CHOREOGRAPHY_WAIT_MS = 16000

/** How long propose_arrangement's reply waits for the human's Keep/Revert. */
const PROPOSAL_WAIT_MS = 30000

/** Resolves with the human's verdict on proposal `id`, or 'pending' on timeout. */
function waitForProposalDecision(id: string, timeoutMs: number): Promise<'keep' | 'revert' | 'pending'> {
  return new Promise((resolve) => {
    const read = (s: ReturnType<typeof useStore.getState>): 'keep' | 'revert' | null => {
      if (s.proposal?.id === id) return null
      const d = s.lastProposalDecision
      // Gone without a recorded verdict (e.g. a reset) — treat as adopted.
      return d?.id === id ? d.decision : 'keep'
    }
    const first = read(useStore.getState())
    if (first) return resolve(first)
    let unsub: () => void = () => {}
    const timer = setTimeout(() => {
      unsub()
      resolve('pending')
    }, timeoutMs)
    unsub = useStore.subscribe((s) => {
      const decision = read(s)
      if (decision) {
        clearTimeout(timer)
        unsub()
        resolve(decision)
      }
    })
  })
}

// ---- layout conflicts ------------------------------------------------------

/** "Table 2 overlaps Dance floor"-style lines for the whole floor plan. */
function conflictLines(state: AisleState): string[] {
  return layoutConflicts(state).map((c) => `${c.aLabel} overlaps ${c.bLabel}`)
}

/** Warning suffix for tool replies that placed, resized, or rotated `ids`. */
function overlapWarning(state: AisleState, ids: string[]): string {
  const involved = layoutConflicts(state).filter((c) => ids.includes(c.aId) || ids.includes(c.bId))
  if (involved.length === 0) return ''
  return ` ⚠ Overlapping: ${involved
    .map((c) => `${c.aLabel} × ${c.bLabel}`)
    .join(', ')} — move, shrink, or rotate one of them to clear the conflict.`
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
  lines.push(
    `Room: ${formatFeet(state.venueDimensions.widthFt)} × ${formatFeet(state.venueDimensions.lengthFt)} · ${state.venueDimensions.snapFt > 0 ? `${formatFeet(state.venueDimensions.snapFt)} snap grid` : 'snapping off'}`,
  )
  const ui = useStore.getState()
  if (ui.proposal) {
    lines.push(
      `⏳ An agent proposal (${ui.proposal.moved} move${ui.proposal.moved === 1 ? '' : 's'}) is applied and awaiting the human's Keep/Revert decision.`,
    )
  }
  const checkpointNames = Object.keys(ui.checkpoints)
  if (checkpointNames.length) lines.push(`Checkpoints saved: ${checkpointNames.join(', ')} (restore_checkpoint returns to one).`)
  const units = stageUnitsPerFoot(state.venueDimensions)
  const room = roomRect(state.venueDimensions)
  lines.push(
    `Venue: ${Object.values(state.venue)
      .map((feature) => {
        if (!feature.enabled) return `${feature.label} hidden`
        const size = feetSize(feature.w, feature.h, state.venueDimensions)
        const x = (feature.x - room.x) / units.x
        const y = (feature.y - room.y) / units.y
        return `${feature.label} shown at (${formatFeet(x)}, ${formatFeet(y)}), ${formatFeet(size.w)} × ${formatFeet(size.h)}, rotated ${Math.round(feature.rotation)}°`
      })
      .join(' · ')}`,
  )
  for (const tid of state.tableOrder) {
    const t = state.tables[tid]
    const occ = occupantsOf(state, tid)
    lines.push(
      `${t.name} (${t.shape}, ${occ.length}/${t.seats}, center ${formatFeet((t.x - room.x) / units.x)}, ${formatFeet((t.y - room.y) / units.y)}, rotated ${Math.round(t.rotation)}°): ${occ.map((g) => state.guests[g]?.name).join(', ') || 'empty'}`,
    )
  }
  const unseated = attending.filter((id) => !state.seating[id])
  if (unseated.length) lines.push(`Unseated: ${unseated.map((id) => state.guests[id].name).join(', ')}`)
  const conflicts = conflictLines(state)
  if (conflicts.length) {
    lines.push('Layout conflicts (furniture on top of each other — fix by moving, shrinking, or rotating via update_table / update_venue):')
    for (const c of conflicts) lines.push(`  ⚠ ${c}`)
  }
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

const VENUE_FEATURE_IDS: VenueFeatureId[] = [
  'entrance', 'dance_floor', 'band', 'bathroom', 'photo_booth', 'bar', 'buffet', 'cake_table', 'gift_table',
]
const VENUE_LOCATIONS = [
  'top_left', 'top_center', 'top_right',
  'center_left', 'center', 'center_right',
  'bottom_left', 'bottom_center', 'bottom_right',
] as const

function featurePosition(feature: AisleState['venue'][VenueFeatureId], location: string, dimensions: AisleState['venueDimensions']) {
  const room = roomRect(dimensions)
  const [vertical, horizontal] = location === 'center'
    ? ['center', 'center']
    : location.split('_')
  const x = horizontal === 'left'
    ? room.x + 34
    : horizontal === 'right'
      ? room.x + room.w - feature.w - 34
      : room.x + (room.w - feature.w) / 2
  const y = vertical === 'top'
    ? room.y + 34
    : vertical === 'bottom'
      ? room.y + room.h - feature.h - 34
      : room.y + (room.h - feature.h) / 2
  return { x, y }
}

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

/** Bubble text for read-only tools — shown only if the cursor is already on stage. */
const READ_GLANCES: Record<string, string> = {
  get_seating_chart: 'Reading the room…',
  list_guests: 'Reviewing the guest list…',
  list_constraints: 'Reviewing the rules…',
  list_unseated: 'Counting empty seats…',
  list_violations: 'Checking for drama…',
  get_chart_document: 'Compiling the seating list…',
  explain_seating: 'Consulting the seating logic…',
}

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
      // Any tool call keeps the cursor parked on stage for the whole turn.
      touchAgentSession()
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
      const before = getCore()
      let result: HandlerResult
      try {
        result = handler(args)
      } catch (err) {
        result = fail(`Something went wrong in ${name}: ${err instanceof Error ? err.message : String(err)}`)
      }
      if (!opts.readOnly || result.isError) {
        useStore.getState().logActivity(name, result.text.split('\n')[0].slice(0, 140), 'agent')
      }
      let played: Promise<void> = Promise.resolve()
      if (!result.isError) {
        try {
          if (opts.readOnly) {
            if (READ_GLANCES[name]) glance(READ_GLANCES[name])
          } else {
            played = choreograph({
              tool: name,
              summary: result.text,
              before,
              after: getCore(),
              touched: result.touched ?? [],
            })
          }
        } catch {
          // Choreography is decoration; a hiccup must never fail the tool call.
        }
      }
      if (result.touched?.length) useStore.getState().markTouched(result.touched)
      // The reply is the tool call's "end": hold it until the cursor has acted
      // the change out, so a burst of calls plays as one legible sequence
      // instead of everything snapping into place at once.
      await Promise.race([played, sleep(MAX_CHOREOGRAPHY_WAIT_MS)]).catch(() => undefined)
      let text = result.text
      if (result.finish && !result.isError) {
        try {
          text += await result.finish()
        } catch {
          // The base reply stands on its own.
        }
      }
      return {
        content: [{ type: 'text', text }],
        ...(result.isError ? { isError: true } : {}),
      }
    },
  }
}

// ---- the tools -------------------------------------------------------------

function baseTools(): WebTool[] {
  return [
    makeTool(
      'update_venue',
      'Configure the shared venue floor plan. Show, hide, place, resize, and rotate the entrance, dance floor, band & speakers, restrooms, photo booth, bar, buffet & catering, cake table, or gifts & cards table. Prefer the real-world *_ft fields, measured from the room’s top-left; legacy x/y/width/height floor-plan units remain supported. The reply warns if the amenity now overlaps a table or another amenity. The human sees the same saved layout and can adjust it afterward.',
      obj(
        {
          feature: str('Venue amenity to change', { enum: VENUE_FEATURE_IDS }),
          enabled: { type: 'boolean', description: 'Whether this amenity is present and visible' },
          location: str('Named part of the room', { enum: [...VENUE_LOCATIONS] }),
          x_ft: { type: 'number', minimum: 0, maximum: 300, description: 'Amenity left edge in feet from the room’s left wall (preferred)' },
          y_ft: { type: 'number', minimum: 0, maximum: 200, description: 'Amenity top edge in feet from the room’s top wall (preferred)' },
          width_ft: { type: 'number', minimum: 1, maximum: 300, description: 'Amenity width in feet (preferred)' },
          height_ft: { type: 'number', minimum: 1, maximum: 200, description: 'Amenity height in feet (preferred)' },
          rotation: { type: 'number', minimum: -360, maximum: 360, description: 'Clockwise rotation in degrees' },
          x: { type: 'number', minimum: 0, maximum: ROOM.w, description: 'Legacy horizontal floor-plan position from the room’s left edge' },
          y: { type: 'number', minimum: 0, maximum: ROOM.h, description: 'Legacy vertical floor-plan position from the room’s top edge' },
          width: { type: 'number', minimum: 1, maximum: ROOM.w, description: 'Legacy amenity width in floor-plan units' },
          height: { type: 'number', minimum: 1, maximum: ROOM.h, description: 'Legacy amenity height in floor-plan units' },
        },
        ['feature'],
      ),
      (args) => {
        const id = String(args.feature ?? '') as VenueFeatureId
        if (!VENUE_FEATURE_IDS.includes(id)) return fail(`Unknown venue feature. Use one of: ${VENUE_FEATURE_IDS.join(', ')}.`)
        const state = getCore()
        const feature = state.venue[id]
        const patch: Partial<typeof feature> = {}
        const min = featureMinSize(id, state.venueDimensions)
        const units = stageUnitsPerFoot(state.venueDimensions)
        const room = roomRect(state.venueDimensions)
        if (typeof args.enabled === 'boolean') patch.enabled = args.enabled
        const requestedWidth = typeof args.width_ft === 'number' ? args.width_ft * units.x : args.width
        const requestedHeight = typeof args.height_ft === 'number' ? args.height_ft * units.y : args.height
        if (typeof requestedWidth === 'number') patch.w = Math.max(min.w, Math.min(room.w - 16, requestedWidth))
        if (typeof requestedHeight === 'number') patch.h = Math.max(min.h, Math.min(room.h - 16, requestedHeight))
        if (typeof args.rotation === 'number') patch.rotation = ((args.rotation % 360) + 360) % 360
        const proposed = { ...feature, ...patch }
        if (args.location) {
          if (!VENUE_LOCATIONS.includes(String(args.location) as (typeof VENUE_LOCATIONS)[number])) {
            return fail(`Unknown location. Use one of: ${VENUE_LOCATIONS.join(', ')}.`)
          }
          Object.assign(patch, featurePosition(proposed, String(args.location), state.venueDimensions))
        }
        const width = patch.w ?? feature.w
        const height = patch.h ?? feature.h
        const requestedX = typeof args.x_ft === 'number' ? args.x_ft * units.x : args.x
        const requestedY = typeof args.y_ft === 'number' ? args.y_ft * units.y : args.y
        if (typeof requestedX === 'number') patch.x = Math.max(room.x + 8, Math.min(room.x + room.w - width - 8, room.x + requestedX))
        if (typeof requestedY === 'number') patch.y = Math.max(room.y + 8, Math.min(room.y + room.h - height - 8, room.y + requestedY))
        const x = patch.x ?? feature.x
        const y = patch.y ?? feature.y
        if (patch.w !== undefined) patch.w = Math.min(patch.w, room.x + room.w - x - 8)
        if (patch.h !== undefined) patch.h = Math.min(patch.h, room.y + room.h - y - 8)
        if (Object.keys(patch).length === 0) return fail('Give enabled, a named location, position, size, or rotation to change the venue.')
        useStore.getState().updateVenueFeature(id, patch)
        const after = getCore().venue[id]
        const afterSize = feetSize(after.w, after.h, getCore().venueDimensions)
        return ok(
          `${after.label} is ${after.enabled ? `shown at (${formatFeet((after.x - room.x) / units.x)}, ${formatFeet((after.y - room.y) / units.y)}), sized ${formatFeet(afterSize.w)} × ${formatFeet(afterSize.h)}, rotated ${Math.round(after.rotation)}°` : 'hidden'}.${after.enabled ? overlapWarning(getCore(), [id]) : ''}`,
          [id],
        )
      },
    ),
    makeTool(
      'update_venue_dimensions',
      'Set the real-world venue room width and length in feet, plus the movement snap grid. The floor plan is drawn to a fixed scale, so growing the room adds floor space around the existing furniture (which stays put); shrinking it nudges anything stranded outside back inside the walls.',
      obj({
        width_ft: { type: 'number', minimum: 20, maximum: 300, description: 'Inside room width in feet' },
        length_ft: { type: 'number', minimum: 15, maximum: 200, description: 'Inside room length in feet' },
        snap_ft: { type: 'number', minimum: 0, maximum: 10, description: 'Grid spacing in feet; use 0 to turn grid snapping off' },
      }),
      (args) => {
        const patch: Partial<AisleState['venueDimensions']> = {}
        if (typeof args.width_ft === 'number') patch.widthFt = args.width_ft
        if (typeof args.length_ft === 'number') patch.lengthFt = args.length_ft
        if (typeof args.snap_ft === 'number') patch.snapFt = args.snap_ft
        if (Object.keys(patch).length === 0) return fail('Give width_ft, length_ft, or snap_ft to update the room.')
        useStore.getState().updateVenueDimensions(patch)
        const dimensions = getCore().venueDimensions
        return ok(
          `Room calibrated to ${formatFeet(dimensions.widthFt)} × ${formatFeet(dimensions.lengthFt)} with ${dimensions.snapFt > 0 ? `${formatFeet(dimensions.snapFt)} snapping` : 'snapping off'}.`,
          ['venue-dimensions'],
        )
      },
    ),
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
      'explain_seating',
      'Explain one guest’s seating in full: where they sit and with whom, every rule involving them with its live status (including how near or far their table actually is from the dance floor, band, or entrance), their group context, dietary needs, and notes. For an unseated guest: what to honor when choosing their seat, where their group sits, and which tables have space. Use it before moving someone — or when the human asks "why is she there?"',
      obj({ guest: str('The guest to explain') }, ['guest']),
      (args) => {
        const state = getCore()
        const r = resolveGuest(state, args.guest)
        if ('err' in r) return fail(r.err)
        const g = r.hit
        const lines: string[] = []
        const seat = state.seating[g.id]
        if (g.rsvp === 'no') lines.push(`${g.name} (${g.group}) has declined — they will not be seated.`)
        else if (seat) {
          const table = state.tables[seat.tableId]
          const mates = occupantsOf(state, seat.tableId).filter((id) => id !== g.id)
          const groupMates = mates.filter((id) => state.guests[id].group === g.group)
          lines.push(`${g.name} (${g.group}) sits at ${table.name}, seat ${seat.seat + 1} of ${table.seats}.`)
          lines.push(
            mates.length
              ? `Tablemates: ${mates
                  .map((id) => `${state.guests[id].name}${state.guests[id].group === g.group ? '' : ` (${state.guests[id].group})`}`)
                  .join(', ')} — ${groupMates.length} of them from “${g.group}”.`
              : 'They are alone at the table so far.',
          )
        } else {
          lines.push(`${g.name} (${g.group}) is unseated, waiting in the lounge.`)
          const groupCounts = new Map<string, number>()
          for (const [gid, a] of Object.entries(state.seating)) {
            if (state.guests[gid]?.group === g.group) groupCounts.set(a.tableId, (groupCounts.get(a.tableId) ?? 0) + 1)
          }
          const top = [...groupCounts.entries()].sort((a, b) => b[1] - a[1])[0]
          if (top) lines.push(`Most of “${g.group}” sit at ${state.tables[top[0]]?.name} (${top[1]} of them).`)
          const free = state.tableOrder
            .map((id) => ({ t: state.tables[id], free: state.tables[id].seats - occupantsOf(state, id).length }))
            .filter((x) => x.free > 0)
          lines.push(free.length ? `Tables with space: ${free.map((x) => `${x.t.name} (${x.free})`).join(', ')}.` : 'No table has a free seat — add or enlarge one.')
        }
        const involved = state.constraints.filter((c) =>
          c.type === 'zone' ? c.guestId === g.id : c.a === g.id || c.b === g.id,
        )
        if (involved.length === 0) lines.push('No seating rules involve them.')
        else {
          lines.push('Rules involving them:')
          for (const c of involved) {
            const status = constraintStatus(state, c)
            const mark = status === 'ok' ? '✓' : status === 'violated' ? '⚠' : '…'
            let detail = ''
            if (c.type === 'together' || c.type === 'apart') {
              const otherId = c.a === g.id ? c.b : c.a
              const other = state.guests[otherId]
              if (other) {
                const os = state.seating[otherId]
                detail = ` — ${other.name} is ${os ? `at ${state.tables[os.tableId]?.name}` : 'unseated'}`
              }
            } else if (seat) {
              const bands = zoneBands(state, c.zone)
              const d = bands.byTable[seat.tableId]
              if (d !== undefined) {
                const place =
                  d <= bands.nearMax
                    ? 'among the closest tables to'
                    : d >= bands.farMin
                      ? 'among the farthest tables from'
                      : 'mid-distance from'
                detail = ` — ${state.tables[seat.tableId].name} is ${place} ${state.venue[c.zone]?.label ?? c.zone}`
              }
            }
            lines.push(`  ${mark} [${c.id}] ${constraintText(state, c)} (${status})${detail}${c.note ? ` — “${c.note}”` : ''}`)
          }
        }
        if (g.dietary.length) lines.push(`Dietary: ${g.dietary.join(', ')}.`)
        if (g.notes) lines.push(`Note: ${g.notes}`)
        if (g.rsvp === 'pending') lines.push('RSVP is still pending.')
        return ok(lines.join('\n'))
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
      'Add a table to the room. Choose a name, seat count (2–16), shape (round or rect), and optionally where its center goes in real-world feet from the room’s top-left, plus a rotation. Without a position it lands in an open spot; the human can drag or rotate it afterwards. The reply warns if the placement overlaps other furniture.',
      obj({
        name: str('Table name, e.g. "Table 11" or "Head table"; auto-numbered if omitted'),
        seats: { type: 'integer', minimum: 2, maximum: 16, description: 'Number of seats (default 8)' },
        shape: str('Table shape', { enum: ['round', 'rect'] }),
        x_ft: { type: 'number', minimum: 0, maximum: 300, description: 'Table center in feet from the room’s left wall' },
        y_ft: { type: 'number', minimum: 0, maximum: 200, description: 'Table center in feet from the room’s top wall' },
        rotation: { type: 'number', minimum: -360, maximum: 360, description: 'Clockwise rotation in degrees' },
      }),
      (args) => {
        const fields: Partial<Omit<Table, 'id'>> = {
          name: args.name ? String(args.name) : undefined,
          seats: typeof args.seats === 'number' ? args.seats : undefined,
          shape: args.shape === 'rect' ? 'rect' : 'round',
        }
        if (typeof args.rotation === 'number') fields.rotation = ((args.rotation % 360) + 360) % 360
        if (typeof args.x_ft === 'number' || typeof args.y_ft === 'number') {
          const dimensions = getCore().venueDimensions
          const units = stageUnitsPerFoot(dimensions)
          const room = roomRect(dimensions)
          let x = typeof args.x_ft === 'number' ? room.x + args.x_ft * units.x : room.x + room.w / 2
          let y = typeof args.y_ft === 'number' ? room.y + args.y_ft * units.y : room.y + room.h / 2
          const probe: Table = {
            id: 'probe',
            name: '',
            shape: fields.shape ?? 'round',
            seats: Math.max(2, Math.min(16, fields.seats ?? 8)),
            rotation: fields.rotation ?? 0,
            x,
            y,
          }
          const bounds = tableBodyBounds(probe, dimensions)
          x += Math.max(room.x + 6 - bounds.left, Math.min(room.x + room.w - 6 - bounds.right, 0))
          y += Math.max(room.y + 6 - bounds.top, Math.min(room.y + room.h - 6 - bounds.bottom, 0))
          fields.x = x
          fields.y = y
        }
        const table = useStore.getState().addTable(fields)
        const dimensions = getCore().venueDimensions
        const units = stageUnitsPerFoot(dimensions)
        const room = roomRect(dimensions)
        return ok(
          `Added ${table.name} (${table.shape}, ${table.seats} seats), centered at (${formatFeet((table.x - room.x) / units.x)}, ${formatFeet((table.y - room.y) / units.y)})${table.rotation ? `, rotated ${Math.round(table.rotation)}°` : ''}.${overlapWarning(getCore(), [table.id])}`,
          [table.id],
        )
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
        if (parsed.kind === 'zone' && !state.venue[parsed.zone]?.enabled) {
          return fail(`${state.venue[parsed.zone].label} is hidden. Show it with update_venue before adding a seating rule around it.`)
        }
        const ra = resolveGuest(state, args.guest_a)
        if ('err' in ra) return fail(ra.err)
        const note = args.note ? String(args.note) : undefined
        if (parsed.kind === 'pair') {
          const rb = resolveGuest(state, args.guest_b)
          if ('err' in rb) return fail(`Pair rules need guest_b too. ${rb.err}`)
          if (ra.hit.id === rb.hit.id) return fail('That is the same guest twice.')
          const dup = findDuplicateRule(state, { type: parsed.pair, a: ra.hit.id, b: rb.hit.id })
          if (dup) return fail(`That rule already exists (${dup.id}).`)
          const c = useStore.getState().addConstraint({ type: parsed.pair, a: ra.hit.id, b: rb.hit.id, note })
          const status = constraintStatus(getCore(), c)
          return ok(
            `Rule added [${c.id}]: ${constraintText(getCore(), c)}.${status === 'violated' ? ' It is currently VIOLATED — auto_arrange(mode:"repair") can fix it.' : ''}`,
            [ra.hit.id, rb.hit.id],
          )
        }
        const zoneDup = findDuplicateRule(state, {
          type: 'zone',
          guestId: ra.hit.id,
          zone: parsed.zone,
          preference: parsed.preference,
        })
        if (zoneDup) return fail(`That rule already exists (${zoneDup.id}).`)
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
      'save_checkpoint',
      'Save a named snapshot of the entire chart — guests, tables, seating, rules, venue — that restore_checkpoint can return to. Session-only (it does not survive a page reload). Use it before trying something bold: checkpoint, propose a daring layout, and if the human hates it, restore. Saving an existing name overwrites it.',
      obj({ name: str('Checkpoint name, e.g. "before-bold-layout"; defaults to "checkpoint"') }),
      (args) => {
        const name = String(args.name ?? '').trim() || 'checkpoint'
        useStore.getState().saveCheckpoint(name)
        const state = getCore()
        const attending = state.guestOrder.filter((id) => state.guests[id].rsvp !== 'no')
        const seated = attending.filter((id) => state.seating[id])
        return ok(
          `Checkpoint “${name}” saved: ${seated.length} of ${attending.length} seated across ${state.tableOrder.length} tables, ${computeViolations(state).length} violations. restore_checkpoint returns to exactly this state.`,
        )
      },
    ),
    makeTool(
      'restore_checkpoint',
      'Restore the chart to a previously saved checkpoint — everything comes back: guests, tables, seating, rules, venue. The restore itself is undoable, and the checkpoint stays saved so you can return again. With no name given and exactly one checkpoint saved, that one is restored.',
      obj({ name: str('Checkpoint name to restore') }),
      (args) => {
        const st = useStore.getState()
        const names = Object.keys(st.checkpoints)
        if (names.length === 0) return fail('No checkpoints saved yet — save_checkpoint creates one.')
        let name = String(args.name ?? '').trim()
        if (!name) {
          if (names.length !== 1) return fail(`Which checkpoint? Saved: ${names.join(', ')}.`)
          name = names[0]
        }
        if (!st.checkpoints[name]) return fail(`No checkpoint named “${name}”. Saved: ${names.join(', ')}.`)
        const before = getCore()
        const cp = st.restoreCheckpoint(name)!
        const after = getCore()
        const seatKey = (s: AisleState, id: string) =>
          s.seating[id] ? `${s.seating[id].tableId}:${s.seating[id].seat}` : ''
        const moved = after.guestOrder.filter((id) => seatKey(after, id) !== seatKey(before, id))
        const seconds = Math.max(1, Math.round((Date.now() - cp.at) / 1000))
        const age = seconds < 60 ? `${seconds}s` : `${Math.round(seconds / 60)} min`
        return ok(
          `Restored checkpoint “${name}” (saved ${age} ago). ${moved.length} guest${moved.length === 1 ? '' : 's'} changed seats; undo brings back what was there before the restore.`,
          moved,
        )
      },
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
      'Rename, resize, rotate, or reposition a table using real-world feet from the room’s top-left. Shrinking a table below its occupancy politely bumps the extra guests back to the lounge. The reply warns if the table now overlaps another table or an amenity.',
      obj(
        {
          table: str('Table to change, by name'),
          name: str('New name'),
          seats: { type: 'integer', minimum: 2, maximum: 16, description: 'New seat count' },
          shape: str('New shape', { enum: ['round', 'rect'] }),
          rotation: { type: 'number', minimum: -360, maximum: 360, description: 'Clockwise rotation in degrees' },
          x_ft: { type: 'number', minimum: 0, maximum: 300, description: 'Table center in feet from the room’s left wall' },
          y_ft: { type: 'number', minimum: 0, maximum: 200, description: 'Table center in feet from the room’s top wall' },
        },
        ['table'],
      ),
      (args) => {
        const state = getCore()
        const r = resolveTable(state, args.table)
        if ('err' in r) return fail(r.err)
        const tablePatch: Partial<Omit<Table, 'id'>> = {
          ...(args.name ? { name: String(args.name) } : {}),
          ...(typeof args.seats === 'number' ? { seats: args.seats } : {}),
          ...(args.shape === 'round' || args.shape === 'rect' ? { shape: args.shape } : {}),
          ...(typeof args.rotation === 'number' ? { rotation: ((args.rotation % 360) + 360) % 360 } : {}),
        }
        const hasPosition = typeof args.x_ft === 'number' || typeof args.y_ft === 'number'
        if (Object.keys(tablePatch).length === 0 && !hasPosition) return fail('Give a new name, seats, shape, rotation, x_ft, or y_ft.')
        let unseated: string[] = []
        if (Object.keys(tablePatch).length > 0) {
          unseated = useStore.getState().updateTable(r.hit.id, tablePatch).unseated
        } else {
          useStore.getState().snapshot('move table')
        }
        let after = getCore().tables[r.hit.id]
        if (hasPosition) {
          const dimensions = getCore().venueDimensions
          const units = stageUnitsPerFoot(dimensions)
          const room = roomRect(dimensions)
          let x = typeof args.x_ft === 'number' ? room.x + args.x_ft * units.x : after.x
          let y = typeof args.y_ft === 'number' ? room.y + args.y_ft * units.y : after.y
          const bounds = tableBodyBounds({ ...after, x, y }, dimensions)
          x += Math.max(room.x + 6 - bounds.left, Math.min(room.x + room.w - 6 - bounds.right, 0))
          y += Math.max(room.y + 6 - bounds.top, Math.min(room.y + room.h - 6 - bounds.bottom, 0))
          useStore.getState().moveTable(r.hit.id, x, y)
          after = getCore().tables[r.hit.id]
        }
        const dimensions = getCore().venueDimensions
        const units = stageUnitsPerFoot(dimensions)
        const room = roomRect(dimensions)
        let text = `${r.hit.name} is now "${after.name}" (${after.shape}, ${after.seats} seats), centered at (${formatFeet((after.x - room.x) / units.x)}, ${formatFeet((after.y - room.y) / units.y)}) and rotated ${Math.round(after.rotation)}°.`
        if (unseated.length) {
          text += ` ${unseated.map((id) => state.guests[id]?.name).join(', ')} lost their seat${unseated.length === 1 ? '' : 's'} and moved to the lounge.`
        }
        text += overlapWarning(getCore(), [r.hit.id])
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
      'Arrange the seating automatically, honoring every rule: couples together, feuds apart, near/far zone preferences, groups kept coherent, tables balanced. mode "full" (default) redesigns the whole room; mode "repair" fixes current violations and seats stragglers while moving as few guests as possible — use it after the human hand-moves someone into trouble. Returns a plain-language explanation of what it did and anything it could not satisfy. The chart animates the changes table by table and the reply waits for the animation, so the call may take several seconds — that is normal.',
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
      'propose_arrangement',
      'Like auto_arrange, but as a question rather than an act: computes the arrangement, plays it out on the chart as a live proposal, and shows the human a Keep / Revert banner. THIS CALL WAITS for the human to decide (up to ~30 seconds) and the reply tells you their verdict. If they have not decided yet, the reply says so — the proposal stays applied under its banner; any further edit quietly adopts it, and undo rejects it. Prefer this over auto_arrange for big rearrangements, so the human stays in charge of their own wedding.',
      obj({
        mode: str('"full" re-seats everyone; "repair" makes minimal fixes', { enum: ['full', 'repair'] }),
      }),
      (args) => {
        const state = getCore()
        const attending = state.guestOrder.filter((id) => state.guests[id].rsvp !== 'no')
        if (attending.length === 0) return fail('There are no attending guests to seat. Add guests first.')
        if (useStore.getState().proposal) {
          return fail('A proposal is already awaiting the human’s decision — wait for their Keep/Revert before proposing again.')
        }
        const mode = args.mode === 'repair' ? 'repair' : 'full'
        const before = state.seating
        const result = autoArrange(state, { mode })
        useStore.getState().applyArrangement(result.assignments)
        const touched = attending.filter(
          (id) => (before[id]?.tableId ?? '') !== (result.assignments[id]?.tableId ?? ''),
        )
        const tables = new Set(touched.map((id) => result.assignments[id]?.tableId).filter(Boolean) as string[])
        if (touched.length === 0) {
          // Nothing changed — no decision to ask for.
          return ok(`${result.explanation}\n\nNothing needed to move, so there is nothing to propose.`)
        }
        const id = uid()
        useStore.getState().beginProposal({
          id,
          summary: mode === 'repair' ? 'a minimal repair' : 'a fresh arrangement',
          moved: touched.length,
          beforeSeating: structuredClone(before),
        })
        return {
          ...ok(
            `Proposed to the human (${touched.length} move${touched.length === 1 ? '' : 's'}, awaiting their Keep/Revert):\n${result.explanation}`,
            [...touched, ...tables],
          ),
          finish: () =>
            waitForProposalDecision(id, PROPOSAL_WAIT_MS).then((decision) => {
              if (decision === 'keep') return '\n\n✅ The human KEPT the proposal — it is now the arrangement.'
              if (decision === 'revert') {
                return '\n\n↩ The human REVERTED the proposal — the seating is back to how it was before this call. Ask what they would like changed, or try a different approach.'
              }
              return '\n\n⏳ The human has not decided yet. The proposal stays applied with its Keep/Revert banner on the chart; get_seating_chart will note it while it is pending.'
            }),
        }
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
      'List every seating rule currently being violated (plus the drama score), and any floor-plan conflicts where tables or amenities physically overlap. An empty list means the room is at peace.',
      obj({}),
      () => {
        const state = getCore()
        const violations = computeViolations(state)
        const conflicts = conflictLines(state)
        const conflictBlock = conflicts.length
          ? `\n${conflicts.length} layout conflict${conflicts.length === 1 ? '' : 's'}:\n${conflicts.map((c) => `⚠ ${c}`).join('\n')}\nFix overlaps by moving, shrinking, or rotating with update_table / update_venue.`
          : ''
        if (violations.length === 0) {
          return ok(`No seating violations — the room is at peace. Drama: Serene.${conflictBlock}`)
        }
        const score = dramaScore(violations)
        return ok(
          `${violations.length} violation${violations.length === 1 ? '' : 's'} · drama: ${dramaLabel(score)} (${score})\n${violations.map((v) => `⚠ ${v.text}`).join('\n')}\nauto_arrange(mode:"repair") fixes these with minimal moves.${conflictBlock}`,
        )
      },
      { readOnly: true },
    ),
  ]
}

// ---- export tools ----------------------------------------------------------

const EXPORT_SECTION_NAMES = ['floor_plan', 'seating_by_table', 'guest_directory', 'catering'] as const
const EXPORT_SECTION_KEY: Record<(typeof EXPORT_SECTION_NAMES)[number], keyof ExportSections> = {
  floor_plan: 'floorPlan',
  seating_by_table: 'tables',
  guest_directory: 'directory',
  catering: 'catering',
}
const EXPORT_SECTION_LABEL: Record<string, string> = {
  plan: 'floor plan',
  tables: 'seating by table',
  directory: 'guest directory',
  catering: 'catering & dietary',
}

function exportTools(): WebTool[] {
  return [
    makeTool(
      'export_chart',
      'Compose the printed seating document and open the export studio on screen, pre-filled with your choices: a to-scale floor plan, per-table seating cards, an A–Z guest directory, and a catering & dietary summary — branded, paginated, with a live page preview. Set the masthead title, date, and venue, pick sections and paper size. The human reviews the preview and presses "Print · Save as PDF" — the one step an agent cannot press. For raw data instead of a printed document, use get_chart_document.',
      obj({
        title: str('Event title for the masthead, e.g. "June & Ravi"'),
        date: str('Event date line, e.g. "Saturday, June 14, 2026"'),
        venue: str('Venue name, e.g. "The Orchard House"'),
        paper: str('Paper size', { enum: ['letter', 'a4'] }),
        sections: {
          type: 'array',
          items: { type: 'string', enum: [...EXPORT_SECTION_NAMES] },
          description: 'Exactly which sections to include; omit to keep the current composition (all sections by default)',
        },
      }),
      (args) => {
        const state = getCore()
        if (state.guestOrder.length === 0 && state.tableOrder.length === 0) {
          return fail('There is nothing to export yet — add guests or tables first.')
        }
        const options = { ...loadExportOptions(), sections: { ...loadExportOptions().sections } }
        if (args.title !== undefined) options.eventTitle = String(args.title)
        if (args.date !== undefined) options.eventDate = String(args.date)
        if (args.venue !== undefined) options.venueName = String(args.venue)
        if (args.paper !== undefined) {
          if (args.paper !== 'letter' && args.paper !== 'a4') return fail('paper must be "letter" or "a4".')
          options.paper = args.paper as PaperSize
        }
        if (args.sections !== undefined) {
          if (!Array.isArray(args.sections) || args.sections.length === 0) {
            return fail(`sections must be a non-empty array of: ${EXPORT_SECTION_NAMES.join(', ')}.`)
          }
          const bad = args.sections.filter((x) => !EXPORT_SECTION_NAMES.includes(String(x) as (typeof EXPORT_SECTION_NAMES)[number]))
          if (bad.length) return fail(`Unknown section${bad.length === 1 ? '' : 's'}: ${bad.join(', ')}. Use: ${EXPORT_SECTION_NAMES.join(', ')}.`)
          const wanted = new Set(args.sections.map(String))
          for (const name of EXPORT_SECTION_NAMES) options.sections[EXPORT_SECTION_KEY[name]] = wanted.has(name)
        }
        saveExportOptions(options)
        const model = buildDocModel(state, options)
        if (model.pages.length === 0) {
          return fail('None of the requested sections have anything to show yet (e.g. the guest directory needs attending guests).')
        }
        useStore.getState().requestExport()
        const included = [...new Set(model.pages.map((p) => EXPORT_SECTION_LABEL[p.kind]))].join(', ')
        const masthead = [model.displayTitle, model.dateLine, model.venueLine].filter(Boolean).join(' · ')
        const skipped = EXPORT_SECTION_NAMES.filter((name) => {
          const key = EXPORT_SECTION_KEY[name]
          return options.sections[key] && !model.pages.some((p) => (p.kind === 'plan' ? key === 'floorPlan' : p.kind === key))
        })
        let text =
          `The export studio is open with a live preview: ${model.pages.length} ${options.paper === 'a4' ? 'A4' : 'Letter'} page${model.pages.length === 1 ? '' : 's'} — ${included} — under the masthead “${masthead}”. ` +
          `The human finishes by pressing “Print · Save as PDF”.`
        if (skipped.length) text += ` (Skipped for now, nothing to show: ${skipped.map((s) => s.replace(/_/g, ' ')).join(', ')}.)`
        if (model.stats.unseated > 0) text += ` Note: ${model.stats.unseated} attending guest${model.stats.unseated === 1 ? ' is' : 's are'} unseated and will print under “Not yet seated” — auto_arrange can fix that first.`
        const violations = computeViolations(state)
        if (violations.length > 0) text += ` ⚠ ${violations.length} seating rule${violations.length === 1 ? ' is' : 's are'} still broken; the document prints as-is.`
        return ok(text)
      },
    ),
    makeTool(
      'get_chart_document',
      'Return the seating chart as a portable document, without opening anything on screen. format "markdown" gives a per-table list with a dietary summary — ready to paste into an email to the caterer; format "csv" gives one spreadsheet row per guest (Guest, Group, RSVP, Dietary, Table, Seat). To hand the human a branded printable PDF instead, call export_chart.',
      obj({
        format: str('Document format (default "markdown")', { enum: ['markdown', 'csv'] }),
      }),
      (args) => {
        const state = getCore()
        if (state.guestOrder.length === 0) return fail('The guest list is empty — nothing to compile yet.')
        const format = args.format === 'csv' ? 'csv' : 'markdown'
        return ok(format === 'csv' ? chartCSV(state) : chartMarkdown(state))
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
        const conflicts = conflictLines(state)
        const conflictNote = conflicts.length
          ? `\n\nNote: the floor plan still has overlapping furniture — ${conflicts.join('; ')}. Consider fixing with update_table / update_venue.`
          : ''
        return ok(`Chart finalized and locked in. 🥂\n\n${lines.join('\n')}${conflictNote}`)
      },
    ),
  ]
}

// ---- dynamic registration --------------------------------------------------

function toolFlags(state: AisleState) {
  const attending = state.guestOrder.filter((id) => state.guests[id].rsvp !== 'no')
  const allSeated = attending.length > 0 && attending.every((id) => state.seating[id])
  const canFinalize = allSeated && computeViolations(state).length === 0
  return {
    hasTables: state.tableOrder.length > 0,
    hasContent: state.guestOrder.length > 0 || state.tableOrder.length > 0,
    canFinalize,
  }
}

export function currentTools(): WebTool[] {
  const flags = toolFlags(getCore())
  return [
    ...baseTools(),
    ...(flags.hasTables ? seatingTools() : []),
    ...(flags.hasContent ? exportTools() : []),
    ...(flags.canFinalize ? finalizeTools() : []),
  ]
}

// ---- catalog for the in-app toolbox page ------------------------------------

export interface CatalogParam {
  name: string
  description: string
  required: boolean
}

export interface CatalogEntry {
  name: string
  description: string
  params: CatalogParam[]
  readOnly: boolean
  /** What has to be true of the chart for this tool to be registered. */
  requires: 'always' | 'tables' | 'content' | 'perfect'
  available: boolean
}

/**
 * Every tool — including ones currently gated off — with its live availability,
 * for the human-facing toolbox page. Built from the same definitions the agent
 * gets, so the page can never drift from reality.
 */
export function toolCatalog(): CatalogEntry[] {
  const flags = toolFlags(getCore())
  const entry = (tool: WebTool, requires: CatalogEntry['requires'], available: boolean): CatalogEntry => {
    const schema = tool.inputSchema as {
      properties?: Record<string, { description?: string; enum?: unknown[] }>
      required?: string[]
    }
    const requiredNames = new Set(schema.required ?? [])
    return {
      name: tool.name,
      description: tool.description,
      params: Object.entries(schema.properties ?? {}).map(([name, p]) => ({
        name,
        description: [p.description, p.enum ? `One of: ${p.enum.join(', ')}` : null].filter(Boolean).join('. '),
        required: requiredNames.has(name),
      })),
      readOnly: tool.annotations?.readOnlyHint === true,
      requires,
      available,
    }
  }
  return [
    ...baseTools().map((t) => entry(t, 'always', true)),
    ...seatingTools().map((t) => entry(t, 'tables', flags.hasTables)),
    ...exportTools().map((t) => entry(t, 'content', flags.hasContent)),
    ...finalizeTools().map((t) => entry(t, 'perfect', flags.canFinalize)),
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
    const sig = `${flags.hasTables}|${flags.hasContent}|${flags.canFinalize}`
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
