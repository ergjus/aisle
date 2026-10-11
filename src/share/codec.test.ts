import { describe, expect, it } from 'vitest'
import type { AisleState } from '../types'
import { freshVenue, freshVenueDimensions } from '../geometry'
import { SAMPLE } from '../sample'
import { autoArrange } from '../solver'
import {
  LONG_LINK_CHARS,
  ShareLinkError,
  buildSharePayload,
  buildShareUrl,
  chartFromPayload,
  decodeShareLink,
  encodeShareData,
} from './codec'

/** The 72-guest sample wedding, fully seated by the solver, with a pin. */
function sampleChart(): AisleState {
  let groupOrder: string[] = []
  for (const g of SAMPLE.guests) if (!groupOrder.includes(g.group)) groupOrder = [...groupOrder, g.group]
  const base: AisleState = {
    layoutVersion: 3,
    guests: Object.fromEntries(SAMPLE.guests.map((g) => [g.id, structuredClone(g)])),
    guestOrder: SAMPLE.guests.map((g) => g.id),
    tables: Object.fromEntries(SAMPLE.tables.map((t) => [t.id, structuredClone(t)])),
    tableOrder: SAMPLE.tables.map((t) => t.id),
    constraints: structuredClone(SAMPLE.constraints),
    seating: {},
    finalized: false,
    groupOrder,
    venue: freshVenue(),
    venueDimensions: freshVenueDimensions(),
    demoMetadata: null,
    pinned: {},
  }
  const seating = autoArrange(base).assignments
  const firstSeated = base.guestOrder.find((id) => seating[id])!
  return { ...base, seating, pinned: { [firstSeated]: true } }
}

/** Coordinates travel at 0.1-unit precision; compare at whole units. */
const near = (n: number) => Math.round(Math.round(n * 10) / 10)

/** A chart compared by meaning rather than ids: names, seats by table name, rules by names. */
function describeChart(state: AisleState) {
  const name = (id: string) => state.guests[id].name
  return {
    guests: state.guestOrder.map((id) => {
      const g = state.guests[id]
      return { name: g.name, group: g.group, rsvp: g.rsvp, dietary: g.dietary, notes: g.notes }
    }),
    tables: state.tableOrder.map((id) => {
      const t = state.tables[id]
      return { name: t.name, shape: t.shape, seats: t.seats, x: near(t.x), y: near(t.y), rotation: t.rotation }
    }),
    seating: state.guestOrder
      .filter((id) => state.seating[id])
      .map((id) => `${name(id)} @ ${state.tables[state.seating[id].tableId].name}#${state.seating[id].seat}`),
    rules: state.constraints.map((c) =>
      c.type === 'zone' ? `${name(c.guestId)} ${c.preference} ${c.zone} ${c.note ?? ''}` : `${name(c.a)} ${c.type} ${name(c.b)} ${c.note ?? ''}`,
    ),
    pinned: Object.keys(state.pinned).map(name),
    venue: Object.values(state.venue).map((f) => ({ ...f, x: near(f.x), y: near(f.y), w: near(f.w), h: near(f.h) })),
    venueDimensions: state.venueDimensions,
    groupOrder: state.groupOrder,
    finalized: state.finalized,
  }
}

/** Re-encodes a hand-made payload the way the encoder frames it (plain-JSON flag). */
function rawLink(payload: unknown): string {
  const json = new TextEncoder().encode(JSON.stringify(payload))
  const framed = new Uint8Array(json.length + 1)
  framed[0] = 0
  framed.set(json, 1)
  let binary = ''
  for (const b of framed) binary += String.fromCharCode(b)
  return `v1.${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`
}

async function expectShareError(input: string, code: ShareLinkError['code']) {
  const error = await decodeShareLink(input).then(
    () => null,
    (err: unknown) => err,
  )
  expect(error).toBeInstanceOf(ShareLinkError)
  expect((error as ShareLinkError).code).toBe(code)
  // Every refusal speaks in a sentence a person can act on.
  expect((error as ShareLinkError).message).toMatch(/link/i)
}

describe('share link codec', () => {
  it('round-trips the whole chart — guests, tables, seats, rules, venue, pins, title', async () => {
    const chart = sampleChart()
    const url = await buildShareUrl(chart, { includeNotes: true, title: 'June & Ravi' }, 'https://aisle.example/')
    expect(url.startsWith('https://aisle.example/#share=v1.')).toBe(true)

    const decoded = await decodeShareLink(url)
    expect(decoded.title).toBe('June & Ravi')
    expect(decoded.hasNotes).toBe(true)
    expect(describeChart(decoded.state)).toEqual(describeChart(chart))
  })

  it('reads a bare fragment value and a #share= fragment alike', async () => {
    const data = await encodeShareData(sampleChart())
    const a = await decodeShareLink(data)
    const b = await decodeShareLink(`#share=${data}`)
    expect(describeChart(a.state)).toEqual(describeChart(b.state))
  })

  it('keeps the 72-guest sample link comfortably short', async () => {
    const url = await buildShareUrl(sampleChart(), {}, 'https://aisle-three.vercel.app/')
    console.info(`[share] 72-guest sample link: ${url.length} characters`)
    expect(url.length).toBeLessThan(LONG_LINK_CHARS / 2)
    // Compression is doing real work: the link is smaller than the raw JSON.
    expect(url.length).toBeLessThan(JSON.stringify(buildSharePayload(sampleChart())).length)
  })

  it('strips guest and rule notes unless asked to include them', async () => {
    const chart = sampleChart()
    const stripped = buildSharePayload(chart)
    expect(JSON.stringify(stripped)).not.toContain('Recently divorced')
    const decoded = await decodeShareLink(await encodeShareData(chart))
    expect(decoded.hasNotes).toBe(false)
    expect(decoded.state.guestOrder.every((id) => decoded.state.guests[id].notes === undefined)).toBe(true)
    expect(decoded.state.constraints.every((c) => c.note === undefined)).toBe(true)

    const withNotes = await decodeShareLink(await encodeShareData(chart, { includeNotes: true }))
    expect(Object.values(withNotes.state.guests).map((g) => g.notes)).toContain('Recently divorced from Dario')
  })

  it('refuses damaged, truncated, and tampered links with a friendly error', async () => {
    const data = await encodeShareData(sampleChart())
    await expectShareError('', 'malformed')
    await expectShareError('v1.', 'malformed')
    await expectShareError('hello', 'malformed')
    await expectShareError('v1.not base64!', 'malformed')
    await expectShareError(data.slice(0, Math.floor(data.length / 2)), 'malformed')
    // Flip bytes in the middle of the deflate stream.
    const mid = Math.floor(data.length / 2)
    await expectShareError(`${data.slice(0, mid)}${data[mid] === 'A' ? 'B' : 'A'}zz${data.slice(mid + 3)}`, 'malformed')
    await expectShareError(rawLink({ v: 1 }), 'invalid')
    await expectShareError(rawLink(['not', 'an', 'object']), 'invalid')
  })

  it('refuses links from other versions', async () => {
    const data = await encodeShareData(sampleChart())
    await expectShareError(data.replace(/^v1\./, 'v2.'), 'unsupported_version')
    await expectShareError(data.replace(/^v1\./, 'v0.'), 'unsupported_version')
    await expectShareError(rawLink({ ...buildSharePayload(sampleChart()), v: 7 }), 'unsupported_version')
  })

  it('refuses oversized links before doing any work', async () => {
    await expectShareError(`v1.${'A'.repeat(500_000)}`, 'too_large')
    const many = { ...buildSharePayload(sampleChart()), g: Array.from({ length: 5000 }, () => ['x', 0, 0]) }
    await expectShareError(rawLink(many), 'too_large')
  })

  it('rejects payloads whose references do not add up', async () => {
    const good = buildSharePayload(sampleChart())
    await expectShareError(rawLink({ ...good, s: [[9999, 0, 0]] }), 'invalid')
    await expectShareError(rawLink({ ...good, c: [[0, 1, 1]] }), 'invalid')
    await expectShareError(rawLink({ ...good, g: [[42, 0, 0]] }), 'invalid')
    await expectShareError(rawLink({ ...good, tb: [['T', 0, 99, 0, 0, 0]] }), 'invalid')
    await expectShareError(rawLink({ ...good, r: [Number.MAX_VALUE, 1, 1] }), 'invalid')
  })

  it('drops double-booked chairs instead of trusting them', () => {
    const payload = buildSharePayload(sampleChart())
    const decoded = chartFromPayload({ ...payload, s: [[0, 0, 0], [1, 0, 0], [0, 1, 0]] })
    expect(Object.keys(decoded.state.seating)).toEqual(['g1'])
  })
})
