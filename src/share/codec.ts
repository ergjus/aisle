import type { AisleState, Constraint, Guest, RSVP, SeatAssignment, Table, VenueFeature, VenueFeatureId, ZoneId } from '../types'
import { WALL_MARGIN, containDelta, featureBounds, freshVenue, freshVenueDimensions, roomRect, tableBounds } from '../geometry'
import { SHARE_HASH_PREFIX } from './hash'

/**
 * Share links, v1 — the whole chart carried inside the URL fragment.
 *
 *   https://…/#share=v1.<base64url( flag byte + body )>
 *
 * The body is a compact, positional JSON payload (rows instead of keyed
 * objects, indexes instead of ids), deflated with the browser's own
 * CompressionStream('deflate-raw') when it has one; the flag byte records
 * whether it was. A fragment never reaches a server, so the chart travels
 * from one browser to the next without touching one.
 *
 * Decoding treats the link as untrusted input: every field is type-checked
 * and range-clamped, sizes are capped before and during inflation (so a
 * deflate bomb can't balloon), and anything that doesn't add up becomes a
 * ShareLinkError with a sentence a person can read — never a crash, and
 * never a half-built chart.
 */

export const SHARE_VERSION = 1

/** Above this, some messengers and mail clients start truncating links. */
export const LONG_LINK_CHARS = 8000

/** The encoded part (after "v1.") Aisle will even look at. */
export const MAX_SHARE_DATA_CHARS = 400_000
/** The inflated JSON Aisle will read, in bytes. */
export const MAX_SHARE_JSON_BYTES = 2_000_000

const LIMITS = {
  guests: 3000,
  tables: 500,
  constraints: 6000,
  groups: 1000,
  dietary: 16,
  name: 160,
  group: 120,
  dietaryLabel: 60,
  note: 1000,
  title: 160,
  /** Stage coordinates are a few thousand units at most; anything wild is junk. */
  coordinate: 1_000_000,
}

const FLAG_PLAIN = 0
const FLAG_DEFLATE = 1

const RSVPS: readonly RSVP[] = ['yes', 'no', 'pending']
const ZONES: readonly ZoneId[] = ['dance_floor', 'band', 'entrance']
const FEATURE_IDS = Object.keys(freshVenue()) as VenueFeatureId[]

// ---- payload shape -----------------------------------------------------------

/** [name, groupIndex, rsvp(0 yes · 1 no · 2 pending), dietary?, notes?] */
type GuestRow = [string, number, number, string[]?, string?]
/** [name, shape(0 round · 1 rect), seats, x, y, rotation] */
type TableRow = [string, number, number, number, number, number]
/** [guestIndex, tableIndex, seat] */
type SeatRow = [number, number, number]
/** [0 together | 1 apart, guestA, guestB, note?] or [2 zone, guest, zone, 0 near | 1 far, note?] */
type ConstraintRow = [0 | 1, number, number, string?] | [2, number, number, number, string?]
/** [featureIndex, enabled 0|1, x, y, w, h, rotation] */
type FeatureRow = [number, number, number, number, number, number, number]

export interface SharePayloadV1 {
  v: 1
  /** Optional title, e.g. "June & Ravi". */
  t?: string
  /** Room: [widthFt, lengthFt, snapFt]. */
  r: [number, number, number]
  gr: string[]
  g: GuestRow[]
  tb: TableRow[]
  s: SeatRow[]
  c: ConstraintRow[]
  vn: FeatureRow[]
  /** Pinned guest indexes. */
  p?: number[]
  /** Finalized. */
  f?: 1
}

export interface ShareOptions {
  /** Guest notes (and rule notes) can be private — left out unless asked for. */
  includeNotes?: boolean
  title?: string
}

export interface DecodedShare {
  state: AisleState
  title?: string
  /** Whether the sender chose to include guest or rule notes. */
  hasNotes: boolean
}

// ---- errors ------------------------------------------------------------------

export type ShareErrorCode = 'malformed' | 'too_large' | 'unsupported_version' | 'unsupported_browser' | 'invalid'

const FRIENDLY: Record<ShareErrorCode, string> = {
  malformed:
    'This link looks incomplete or damaged — it may have been cut short when it was copied or forwarded. Ask whoever sent it for a fresh link.',
  too_large: 'This link carries more than Aisle will open safely in a browser. Ask whoever sent it to share a smaller chart.',
  unsupported_version:
    'This link was made by a different version of Aisle and can’t be read here. Reload the page, or ask whoever sent it for a fresh link.',
  unsupported_browser:
    'This browser can’t unpack Aisle’s compressed share links. Try opening it in a recent Chrome, Edge, Safari, or Firefox.',
  invalid:
    'The seating chart inside this link doesn’t add up, so Aisle won’t open it. Ask whoever sent it for a fresh link.',
}

export class ShareLinkError extends Error {
  readonly code: ShareErrorCode
  /** Developer-facing detail; the message is the human sentence. */
  readonly detail?: string
  constructor(code: ShareErrorCode, detail?: string) {
    super(FRIENDLY[code])
    this.name = 'ShareLinkError'
    this.code = code
    this.detail = detail
  }
}

// ---- encode ------------------------------------------------------------------

const round1 = (n: number) => Math.round(n * 10) / 10

function cleanNote(note: string | undefined, include: boolean): string | undefined {
  if (!include) return undefined
  const trimmed = note?.trim()
  return trimmed ? trimmed.slice(0, LIMITS.note) : undefined
}

/** The chart as a compact, versioned payload — no ids, no UI state. */
export function buildSharePayload(state: AisleState, options: ShareOptions = {}): SharePayloadV1 {
  const includeNotes = options.includeNotes === true
  const groups: string[] = [...(state.groupOrder ?? [])]
  for (const id of state.guestOrder) if (!groups.includes(state.guests[id].group)) groups.push(state.guests[id].group)
  const groupIndex = new Map(groups.map((g, i) => [g, i]))
  const guestIndex = new Map(state.guestOrder.map((id, i) => [id, i]))
  const tableIndex = new Map(state.tableOrder.map((id, i) => [id, i]))

  const g: GuestRow[] = state.guestOrder.map((id) => {
    const guest = state.guests[id]
    const row: GuestRow = [guest.name, groupIndex.get(guest.group)!, RSVPS.indexOf(guest.rsvp)]
    const notes = cleanNote(guest.notes, includeNotes)
    if (guest.dietary.length > 0 || notes) row.push(guest.dietary)
    if (notes) row.push(notes)
    return row
  })

  const tb: TableRow[] = state.tableOrder.map((id) => {
    const t = state.tables[id]
    return [t.name, t.shape === 'rect' ? 1 : 0, t.seats, round1(t.x), round1(t.y), round1(t.rotation ?? 0)]
  })

  const s: SeatRow[] = []
  for (const id of state.guestOrder) {
    const seat = state.seating[id]
    const ti = seat ? tableIndex.get(seat.tableId) : undefined
    if (seat && ti !== undefined) s.push([guestIndex.get(id)!, ti, seat.seat])
  }

  const c: ConstraintRow[] = []
  for (const rule of state.constraints) {
    const note = cleanNote(rule.note, includeNotes)
    if (rule.type === 'zone') {
      const gi = guestIndex.get(rule.guestId)
      if (gi === undefined) continue
      const row: ConstraintRow = [2, gi, ZONES.indexOf(rule.zone), rule.preference === 'far' ? 1 : 0]
      if (note) row.push(note)
      c.push(row)
    } else {
      const a = guestIndex.get(rule.a)
      const b = guestIndex.get(rule.b)
      if (a === undefined || b === undefined) continue
      const row: ConstraintRow = [rule.type === 'apart' ? 1 : 0, a, b]
      if (note) row.push(note)
      c.push(row)
    }
  }

  const vn: FeatureRow[] = FEATURE_IDS.flatMap((id, i) => {
    const f = state.venue[id]
    if (!f) return []
    return [[i, f.enabled ? 1 : 0, round1(f.x), round1(f.y), round1(f.w), round1(f.h), round1(f.rotation ?? 0)] as FeatureRow]
  })

  const pinned = Object.keys(state.pinned ?? {})
    .filter((id) => state.seating[id])
    .map((id) => guestIndex.get(id))
    .filter((i): i is number => i !== undefined)

  const payload: SharePayloadV1 = {
    v: 1,
    r: [state.venueDimensions.widthFt, state.venueDimensions.lengthFt, state.venueDimensions.snapFt],
    gr: groups,
    g,
    tb,
    s,
    c,
    vn,
  }
  const title = options.title?.trim().slice(0, LIMITS.title)
  if (title) payload.t = title
  if (pinned.length) payload.p = pinned
  if (state.finalized) payload.f = 1
  return payload
}

function hasCompression(): boolean {
  return typeof CompressionStream !== 'undefined' && typeof ReadableStream !== 'undefined'
}

function hasDecompression(): boolean {
  return typeof DecompressionStream !== 'undefined' && typeof ReadableStream !== 'undefined'
}

/** Pushes bytes through a (de)compression stream, refusing to collect more than `limit`. */
async function pump(input: Uint8Array, transform: CompressionStream | DecompressionStream, limit: number): Promise<Uint8Array> {
  const source = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(input as Uint8Array<ArrayBuffer>)
      controller.close()
    },
  })
  const reader = source.pipeThrough(transform).getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel().catch(() => undefined)
      throw new ShareLinkError('too_large', `inflated past ${limit} bytes`)
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.byteLength
  }
  return out
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(data: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(data)) throw new ShareLinkError('malformed', 'not base64url')
  const padded = data.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (data.length % 4)) % 4)
  let binary: string
  try {
    binary = atob(padded)
  } catch {
    throw new ShareLinkError('malformed', 'base64 decode failed')
  }
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** The fragment value — "v1.<data>" — for a chart. */
export async function encodeShareData(state: AisleState, options: ShareOptions = {}): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(buildSharePayload(state, options)))
  let flag = FLAG_PLAIN
  let body: Uint8Array = json
  if (hasCompression()) {
    try {
      body = await pump(json, new CompressionStream('deflate-raw'), Number.MAX_SAFE_INTEGER)
      flag = FLAG_DEFLATE
    } catch {
      // Older engines may lack deflate-raw; the plain body still works.
      body = json
      flag = FLAG_PLAIN
    }
  }
  const framed = new Uint8Array(body.byteLength + 1)
  framed[0] = flag
  framed.set(body, 1)
  return `v${SHARE_VERSION}.${toBase64Url(framed)}`
}

/** Where share links point: this page, without any existing fragment. */
export function shareBaseUrl(): string {
  try {
    return `${location.origin}${location.pathname}`
  } catch {
    return ''
  }
}

/** A complete, read-only share link for a chart. */
export async function buildShareUrl(state: AisleState, options: ShareOptions = {}, base = shareBaseUrl()): Promise<string> {
  return `${base}${SHARE_HASH_PREFIX}${await encodeShareData(state, options)}`
}

// ---- decode ------------------------------------------------------------------

function invalid(detail: string): never {
  throw new ShareLinkError('invalid', detail)
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function list(x: unknown, max: number, field: string): unknown[] {
  if (!Array.isArray(x)) invalid(`${field} is not a list`)
  if (x.length > max) throw new ShareLinkError('too_large', `${field} has ${x.length} entries`)
  return x
}

function text(x: unknown, max: number, field: string, required = true): string {
  if (typeof x !== 'string') invalid(`${field} is not text`)
  const trimmed = x.trim().slice(0, max)
  if (required && !trimmed) invalid(`${field} is empty`)
  return trimmed
}

function optionalText(x: unknown, max: number, field: string): string | undefined {
  if (x === undefined || x === null) return undefined
  return text(x, max, field, false) || undefined
}

function int(x: unknown, lo: number, hi: number, field: string): number {
  if (typeof x !== 'number' || !Number.isInteger(x) || x < lo || x > hi) invalid(`${field} is out of range`)
  return x
}

function coordinate(x: unknown, field: string): number {
  if (typeof x !== 'number' || !Number.isFinite(x) || Math.abs(x) > LIMITS.coordinate) invalid(`${field} is not a usable number`)
  return x
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
const angle = (n: number) => ((n % 360) + 360) % 360

/** Accepts a full link, a "#share=…" fragment, or the bare "v1.…" value. */
function shareValue(input: string): string {
  const raw = input.trim()
  const hashAt = raw.indexOf(SHARE_HASH_PREFIX)
  if (hashAt >= 0) return raw.slice(hashAt + SHARE_HASH_PREFIX.length)
  if (raw.startsWith('share=')) return raw.slice('share='.length)
  return raw
}

/** Validates a parsed payload and rebuilds a complete chart from it. */
export function chartFromPayload(payload: unknown): DecodedShare {
  if (!isPlainObject(payload)) invalid('payload is not an object')
  if (payload.v !== 1) throw new ShareLinkError('unsupported_version', `payload version ${String(payload.v)}`)

  const room = list(payload.r, 3, 'room')
  if (room.length !== 3) invalid('room needs width, length, and snap')
  const venueDimensions = {
    widthFt: clamp(coordinate(room[0], 'room width'), 20, 300),
    lengthFt: clamp(coordinate(room[1], 'room length'), 15, 200),
    snapFt: clamp(coordinate(room[2], 'room snap'), 0, 10),
  }

  const groups = list(payload.gr, LIMITS.groups, 'groups').map((g, i) => text(g, LIMITS.group, `group ${i + 1}`))
  if (groups.length === 0 && Array.isArray(payload.g) && payload.g.length > 0) invalid('guests without groups')

  let hasNotes = false

  const guestRows = list(payload.g, LIMITS.guests, 'guests')
  const guestOrder: string[] = []
  const guests: Record<string, Guest> = {}
  guestRows.forEach((row, i) => {
    const field = `guest ${i + 1}`
    if (!Array.isArray(row) || row.length < 3 || row.length > 5) invalid(`${field} is malformed`)
    const id = `g${i + 1}`
    const dietary = row[3] === undefined || row[3] === null
      ? []
      : list(row[3], LIMITS.dietary, `${field} dietary`)
          .map((d, j) => text(d, LIMITS.dietaryLabel, `${field} dietary ${j + 1}`, false))
          .filter(Boolean)
    const notes = optionalText(row[4], LIMITS.note, `${field} notes`)
    if (notes) hasNotes = true
    guests[id] = {
      id,
      name: text(row[0], LIMITS.name, `${field} name`),
      group: groups[int(row[1], 0, groups.length - 1, `${field} group`)],
      rsvp: RSVPS[int(row[2], 0, 2, `${field} rsvp`)],
      dietary,
      ...(notes ? { notes } : {}),
    }
    guestOrder.push(id)
  })

  const roomBox = roomRect(venueDimensions)
  const tableRows = list(payload.tb, LIMITS.tables, 'tables')
  const tableOrder: string[] = []
  const tables: Record<string, Table> = {}
  tableRows.forEach((row, i) => {
    const field = `table ${i + 1}`
    if (!Array.isArray(row) || row.length !== 6) invalid(`${field} is malformed`)
    const id = `t${i + 1}`
    const table: Table = {
      id,
      name: text(row[0], LIMITS.name, `${field} name`),
      shape: int(row[1], 0, 1, `${field} shape`) === 1 ? 'rect' : 'round',
      seats: int(row[2], 2, 16, `${field} seats`),
      x: coordinate(row[3], `${field} x`),
      y: coordinate(row[4], `${field} y`),
      rotation: angle(coordinate(row[5], `${field} rotation`)),
    }
    // Keep everything inside the walls, exactly as a saved chart is loaded.
    const { dx, dy } = containDelta(tableBounds(table, venueDimensions), roomBox)
    tables[id] = { ...table, x: table.x + dx, y: table.y + dy }
    tableOrder.push(id)
  })

  // Seats: one guest per chair, one chair per guest, none for a declined RSVP.
  // Collisions are dropped rather than trusted.
  const seating: Record<string, SeatAssignment> = {}
  const taken = new Set<string>()
  list(payload.s, LIMITS.guests, 'seating').forEach((row, i) => {
    const field = `seat ${i + 1}`
    if (!Array.isArray(row) || row.length !== 3) invalid(`${field} is malformed`)
    const guestId = guestOrder[int(row[0], 0, guestOrder.length - 1, `${field} guest`)]
    const tableId = tableOrder[int(row[1], 0, tableOrder.length - 1, `${field} table`)]
    const seat = int(row[2], 0, 15, `${field} chair`)
    const key = `${tableId}:${seat}`
    if (seating[guestId] || taken.has(key) || seat >= tables[tableId].seats || guests[guestId].rsvp === 'no') return
    seating[guestId] = { tableId, seat }
    taken.add(key)
  })

  const constraints: Constraint[] = []
  list(payload.c, LIMITS.constraints, 'rules').forEach((row, i) => {
    const field = `rule ${i + 1}`
    if (!Array.isArray(row) || row.length < 3) invalid(`${field} is malformed`)
    const id = `c${i + 1}`
    const kind = int(row[0], 0, 2, `${field} kind`)
    const guestAt = (x: unknown, label: string) => guestOrder[int(x, 0, guestOrder.length - 1, `${field} ${label}`)]
    if (kind === 2) {
      if (row.length > 5) invalid(`${field} is malformed`)
      const note = optionalText(row[4], LIMITS.note, `${field} note`)
      if (note) hasNotes = true
      constraints.push({
        id,
        type: 'zone',
        guestId: guestAt(row[1], 'guest'),
        zone: ZONES[int(row[2], 0, ZONES.length - 1, `${field} zone`)],
        preference: int(row[3], 0, 1, `${field} preference`) === 1 ? 'far' : 'near',
        ...(note ? { note } : {}),
      })
    } else {
      if (row.length > 4) invalid(`${field} is malformed`)
      const a = guestAt(row[1], 'first guest')
      const b = guestAt(row[2], 'second guest')
      if (a === b) invalid(`${field} pairs a guest with themself`)
      const note = optionalText(row[3], LIMITS.note, `${field} note`)
      if (note) hasNotes = true
      constraints.push({ id, type: kind === 1 ? 'apart' : 'together', a, b, ...(note ? { note } : {}) })
    }
  })

  const venue = freshVenue()
  list(payload.vn, FEATURE_IDS.length, 'venue').forEach((row, i) => {
    const field = `venue item ${i + 1}`
    if (!Array.isArray(row) || row.length !== 7) invalid(`${field} is malformed`)
    const id = FEATURE_IDS[int(row[0], 0, FEATURE_IDS.length - 1, `${field} kind`)]
    const sized: VenueFeature = {
      ...venue[id],
      enabled: int(row[1], 0, 1, `${field} visibility`) === 1,
      x: coordinate(row[2], `${field} x`),
      y: coordinate(row[3], `${field} y`),
      w: clamp(coordinate(row[4], `${field} width`), 1, roomBox.w - WALL_MARGIN * 2),
      h: clamp(coordinate(row[5], `${field} depth`), 1, roomBox.h - WALL_MARGIN * 2),
      rotation: angle(coordinate(row[6], `${field} rotation`)),
    }
    const { dx, dy } = containDelta(featureBounds(sized), roomBox)
    venue[id] = { ...sized, x: sized.x + dx, y: sized.y + dy }
  })

  const pinned: Record<string, true> = {}
  if (payload.p !== undefined) {
    list(payload.p, LIMITS.guests, 'pins').forEach((x, i) => {
      const id = guestOrder[int(x, 0, guestOrder.length - 1, `pin ${i + 1}`)]
      if (seating[id]) pinned[id] = true
    })
  }

  const title = payload.t === undefined ? undefined : optionalText(payload.t, LIMITS.title, 'title')

  const groupOrder = [...new Set(groups)]
  return {
    state: {
      layoutVersion: 3,
      guests,
      guestOrder,
      tables,
      tableOrder,
      constraints,
      seating,
      finalized: payload.f === 1,
      groupOrder,
      venue,
      venueDimensions: { ...freshVenueDimensions(), ...venueDimensions },
      demoMetadata: null,
      pinned,
    },
    title,
    hasNotes,
  }
}

/**
 * Reads a share link (full URL, "#share=…" fragment, or bare "v1.…" value)
 * back into a chart. Throws ShareLinkError — with a human sentence as its
 * message — for anything it won't open.
 */
export async function decodeShareLink(input: string): Promise<DecodedShare> {
  if (typeof input !== 'string') throw new ShareLinkError('malformed', 'not a string')
  const value = shareValue(input)
  if (value.length > MAX_SHARE_DATA_CHARS + 8) throw new ShareLinkError('too_large', `${value.length} characters`)
  const match = /^v(\d{1,4})\.(.*)$/s.exec(value)
  if (!match) throw new ShareLinkError('malformed', 'missing version prefix')
  if (Number(match[1]) !== SHARE_VERSION) throw new ShareLinkError('unsupported_version', `link version ${match[1]}`)
  const data = match[2]
  if (!data) throw new ShareLinkError('malformed', 'empty payload')

  const framed = fromBase64Url(data)
  if (framed.length < 2) throw new ShareLinkError('malformed', 'payload too short')
  const flag = framed[0]
  let json: Uint8Array
  if (flag === FLAG_DEFLATE) {
    if (!hasDecompression()) throw new ShareLinkError('unsupported_browser')
    try {
      json = await pump(framed.subarray(1), new DecompressionStream('deflate-raw'), MAX_SHARE_JSON_BYTES)
    } catch (err) {
      if (err instanceof ShareLinkError) throw err
      throw new ShareLinkError('malformed', 'inflate failed')
    }
  } else if (flag === FLAG_PLAIN) {
    json = framed.subarray(1)
    if (json.byteLength > MAX_SHARE_JSON_BYTES) throw new ShareLinkError('too_large', `${json.byteLength} bytes`)
  } else {
    throw new ShareLinkError('malformed', `unknown flag ${flag}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(json))
  } catch {
    throw new ShareLinkError('malformed', 'not JSON')
  }
  try {
    return chartFromPayload(parsed)
  } catch (err) {
    if (err instanceof ShareLinkError) throw err
    throw new ShareLinkError('invalid', err instanceof Error ? err.message : String(err))
  }
}
