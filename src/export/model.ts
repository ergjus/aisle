import type { AisleState } from '../types'
import { occupantsOf } from '../store'
import { groupColors } from '../utils'

/**
 * The export document model: everything the printed chart contains, computed
 * ahead of render as plain data. Pages are paginated here — deterministically,
 * from measured constants — so the on-screen preview and the printed PDF are
 * the same pages, and so pagination is testable without a browser.
 */

export type PaperSize = 'letter' | 'a4'

export interface ExportSections {
  floorPlan: boolean
  tables: boolean
  directory: boolean
  catering: boolean
}

export interface ExportOptions {
  sections: ExportSections
  eventTitle: string
  eventDate: string
  venueName: string
  paper: PaperSize
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  sections: { floorPlan: true, tables: true, directory: true, catering: true },
  eventTitle: '',
  eventDate: '',
  venueName: '',
  paper: 'letter',
}

/** Page boxes at CSS 96dpi. Letter is exactly 8.5×11in; A4 rounds 210×297mm down. */
export const PAGE_PX: Record<PaperSize, { w: number; h: number }> = {
  letter: { w: 816, h: 1056 },
  a4: { w: 794, h: 1122 },
}

/**
 * Layout metrics in px. Every value must match export.css — the paginator
 * trusts these to decide what fits on a page, so keep them honest (round up,
 * never down) and change both places together.
 */
export const EXPORT_METRICS = {
  padX: 64,
  padTop: 50,
  padBottom: 42,
  footerH: 36,
  sectionHeaderH: 50,
  continuedHeaderH: 34,
  /** The "¹ vegetarian · † awaiting reply" line under a section header. */
  legendLineH: 22,
  columnGap: 28,
}

/** Vertical space a page offers to flowing content, before headers. */
export function contentHeight(paper: PaperSize): number {
  const m = EXPORT_METRICS
  return PAGE_PX[paper].h - m.padTop - m.padBottom - m.footerH
}

/** Height of the page-one masthead (kicker, title, meta line, rule). */
export function mastheadHeight(title: string): number {
  const lines = title.trim().length > 40 ? 2 : 1
  return 118 + (lines - 1) * 38
}

// ---- dietary legend --------------------------------------------------------

export interface DietaryLegendEntry {
  key: string
  label: string
}

/** Unique dietary needs among attending guests, in first-appearance order. */
export function dietaryLegend(state: AisleState): DietaryLegendEntry[] {
  const seen = new Map<string, string>()
  for (const id of state.guestOrder) {
    const g = state.guests[id]
    if (g.rsvp === 'no') continue
    for (const d of g.dietary) {
      const label = d.trim()
      const key = label.toLowerCase()
      if (key && !seen.has(key)) seen.set(key, label)
    }
  }
  return [...seen].map(([key, label]) => ({ key, label }))
}

/** 1-based legend markers for a guest's dietary needs, sorted and deduped. */
export function dietaryMarkers(legend: DietaryLegendEntry[], dietary: string[]): number[] {
  const index = new Map(legend.map((e, i) => [e.key, i + 1]))
  const out: number[] = []
  for (const d of dietary) {
    const n = index.get(d.trim().toLowerCase())
    if (n !== undefined && !out.includes(n)) out.push(n)
  }
  return out.sort((a, b) => a - b)
}

// ---- section data ----------------------------------------------------------

export interface TableCardRow {
  guestId: string
  name: string
  color: string
  markers: number[]
  pending: boolean
}

export interface TableCard {
  id: string
  name: string
  /** 0 for the synthetic "not yet seated" card. */
  seats: number
  rows: TableCardRow[]
  openSeats: number
  unseated: boolean
  /** Estimated rendered height incl. the gap below, px. */
  h: number
}

const CARD = { base: 58, row: 17, wrappedRow: 34, openLine: 20, emptyLine: 18, gap: 12 }

function cardRowHeight(row: TableCardRow): number {
  const chars = row.name.length + row.markers.length * 2 + (row.pending ? 2 : 0)
  return chars > 40 ? CARD.wrappedRow : CARD.row
}

function cardHeight(rows: TableCardRow[], openSeats: number): number {
  const body = rows.length === 0 ? CARD.emptyLine : rows.reduce((sum, r) => sum + cardRowHeight(r), 0)
  return CARD.base + body + (openSeats > 0 ? CARD.openLine : 0) + CARD.gap
}

export function buildTableCards(state: AisleState, legend: DietaryLegendEntry[]): TableCard[] {
  const colors = groupColors(state)
  const cards: TableCard[] = []
  for (const tid of state.tableOrder) {
    const t = state.tables[tid]
    const rows = occupantsOf(state, tid).map((gid): TableCardRow => {
      const g = state.guests[gid]
      return {
        guestId: gid,
        name: g.name,
        color: colors[g.group],
        markers: dietaryMarkers(legend, g.dietary),
        pending: g.rsvp === 'pending',
      }
    })
    const openSeats = Math.max(0, t.seats - rows.length)
    cards.push({ id: tid, name: t.name, seats: t.seats, rows, openSeats, unseated: false, h: cardHeight(rows, openSeats) })
  }
  const unseated = state.guestOrder
    .filter((id) => state.guests[id].rsvp !== 'no' && !state.seating[id])
    .map((gid): TableCardRow => {
      const g = state.guests[gid]
      return {
        guestId: gid,
        name: g.name,
        color: colors[g.group],
        markers: dietaryMarkers(legend, g.dietary),
        pending: g.rsvp === 'pending',
      }
    })
  if (unseated.length > 0) {
    cards.push({
      id: '__unseated',
      name: 'Not yet seated',
      seats: 0,
      rows: unseated,
      openSeats: 0,
      unseated: true,
      h: cardHeight(unseated, 0),
    })
  }
  return cards
}

export type DirectoryItem =
  | { kind: 'letter'; key: string; letter: string; h: number }
  | { kind: 'guest'; key: string; name: string; table: string | null; pending: boolean; h: number }

const DIRECTORY = { letter: 26, row: 19, wrappedRow: 36 }

/** Attending guests A→Z with letter headings; unseated guests keep a null table. */
export function buildDirectory(state: AisleState): DirectoryItem[] {
  const guests = state.guestOrder
    .map((id) => state.guests[id])
    .filter((g) => g.rsvp !== 'no')
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  const items: DirectoryItem[] = []
  let current = ''
  for (const g of guests) {
    const first = g.name.trim()[0]?.toUpperCase() ?? '#'
    const letter = /[A-Z]/.test(first) ? first : '#'
    if (letter !== current) {
      current = letter
      items.push({ kind: 'letter', key: `letter-${letter}`, letter, h: DIRECTORY.letter })
    }
    const seat = state.seating[g.id]
    const table = seat ? (state.tables[seat.tableId]?.name ?? null) : null
    const chars = g.name.length + (table ?? 'unseated').length
    items.push({
      kind: 'guest',
      key: g.id,
      name: g.name,
      table,
      pending: g.rsvp === 'pending',
      h: chars > 30 ? DIRECTORY.wrappedRow : DIRECTORY.row,
    })
  }
  return items
}

export interface CateringLine {
  key: string
  text: string
  dim?: boolean
}

export interface CateringBlock {
  key: string
  title: string
  lines: CateringLine[]
  h: number
}

const CATERING = { base: 36, line: 17, wrappedLine: 34, gap: 12 }

function cateringBlock(key: string, title: string, lines: CateringLine[]): CateringBlock {
  const body = lines.reduce((sum, l) => sum + (l.text.length > 44 ? CATERING.wrappedLine : CATERING.line), 0)
  return { key, title, lines, h: CATERING.base + body + CATERING.gap }
}

export function buildCatering(state: AisleState, legend: DietaryLegendEntry[], stats: ExportStats): CateringBlock[] {
  const blocks: CateringBlock[] = []
  blocks.push(
    cateringBlock('glance', 'At a glance', [
      {
        key: 'guests',
        text: `${stats.attending} guests attending${stats.pending > 0 ? ` · ${stats.pending} awaiting reply` : ''}`,
      },
      { key: 'seated', text: `${stats.seated} seated · ${stats.unseated} not yet seated` },
      { key: 'tables', text: `${stats.tables} tables · ${stats.openSeats} open seats` },
    ]),
  )
  const tableNameOf = (gid: string) => {
    const seat = state.seating[gid]
    return seat ? (state.tables[seat.tableId]?.name ?? null) : null
  }
  const attending = state.guestOrder.filter((id) => state.guests[id].rsvp !== 'no')
  if (legend.length === 0) {
    blocks.push(cateringBlock('none', 'Dietary needs', [{ key: 'none', text: 'No dietary needs recorded.', dim: true }]))
    return blocks
  }
  for (const entry of legend) {
    const matching = attending.filter((id) =>
      state.guests[id].dietary.some((d) => d.trim().toLowerCase() === entry.key),
    )
    blocks.push(
      cateringBlock(
        `diet-${entry.key}`,
        `${entry.label} · ${matching.length}`,
        matching.map((gid) => ({
          key: gid,
          text: `${state.guests[gid].name} — ${tableNameOf(gid) ?? 'not yet seated'}`,
        })),
      ),
    )
  }
  const byTable: CateringLine[] = []
  for (const tid of state.tableOrder) {
    const counts = new Map<string, number>()
    for (const gid of occupantsOf(state, tid)) {
      for (const d of state.guests[gid].dietary) {
        const key = d.trim().toLowerCase()
        if (key) counts.set(key, (counts.get(key) ?? 0) + 1)
      }
    }
    if (counts.size === 0) continue
    const parts = legend
      .filter((e) => counts.has(e.key))
      .map((e) => `${counts.get(e.key)}× ${e.label.toLowerCase()}`)
    byTable.push({ key: tid, text: `${state.tables[tid].name}: ${parts.join(', ')}` })
  }
  if (byTable.length > 0) blocks.push(cateringBlock('by-table', 'By table, for the kitchen', byTable))
  return blocks
}

// ---- stats -----------------------------------------------------------------

export interface ExportGroupStat {
  name: string
  color: string
  count: number
}

export interface ExportStats {
  attending: number
  pending: number
  seated: number
  unseated: number
  tables: number
  seatsTotal: number
  openSeats: number
  dietaryCount: number
  groups: ExportGroupStat[]
}

export function buildStats(state: AisleState): ExportStats {
  const colors = groupColors(state)
  const attending = state.guestOrder.filter((id) => state.guests[id].rsvp !== 'no')
  const seated = attending.filter((id) => state.seating[id])
  const counts = new Map<string, number>()
  for (const id of attending) {
    const g = state.guests[id].group
    counts.set(g, (counts.get(g) ?? 0) + 1)
  }
  let seatsTotal = 0
  let openSeats = 0
  for (const tid of state.tableOrder) {
    const t = state.tables[tid]
    seatsTotal += t.seats
    openSeats += Math.max(0, t.seats - occupantsOf(state, tid).length)
  }
  return {
    attending: attending.length,
    pending: attending.filter((id) => state.guests[id].rsvp === 'pending').length,
    seated: seated.length,
    unseated: attending.length - seated.length,
    tables: state.tableOrder.length,
    seatsTotal,
    openSeats,
    dietaryCount: attending.filter((id) => state.guests[id].dietary.length > 0).length,
    groups: (state.groupOrder ?? [])
      .filter((g) => (counts.get(g) ?? 0) > 0)
      .map((g) => ({ name: g, color: colors[g], count: counts.get(g)! })),
  }
}

// ---- pagination ------------------------------------------------------------

export interface PaginateOptions<T> {
  heightOf: (item: T) => number
  columnHeight: number
  columns: number
  /** Height claimed by the masthead/section header on the section's first page. */
  firstPageOffset?: number
  /** Height claimed by the "continued" header on later pages. */
  laterPageOffset?: number
  /** Items (like letter headings) that must not be stranded at the bottom of a column. */
  keepWithNext?: (item: T) => boolean
}

/**
 * Flow items into fixed-height columns, left to right, page by page. Items
 * keep their order; an item taller than a column still gets a column to
 * itself rather than vanishing.
 */
export function paginateColumns<T>(items: T[], opts: PaginateOptions<T>): T[][][] {
  if (items.length === 0) return []
  const pages: T[][][] = []
  let page: T[][] = [[]]
  let used = 0
  // Even a degenerate capacity places one item per column (see the used > 0
  // guard below), so a tiny floor is safe and can't loop forever.
  const capacity = () =>
    Math.max(1, opts.columnHeight - (pages.length === 0 ? (opts.firstPageOffset ?? 0) : (opts.laterPageOffset ?? 0)))
  const queue = [...items]
  while (queue.length > 0) {
    const item = queue.shift()!
    const col = page[page.length - 1]
    if (used > 0 && used + opts.heightOf(item) > capacity()) {
      const prev = col[col.length - 1]
      if (prev !== undefined && col.length > 1 && opts.keepWithNext?.(prev)) {
        col.pop()
        queue.unshift(prev, item)
      } else {
        queue.unshift(item)
      }
      if (page.length === opts.columns) {
        pages.push(page)
        page = [[]]
      } else {
        page.push([])
      }
      used = 0
      continue
    }
    col.push(item)
    used += opts.heightOf(item)
  }
  pages.push(page)

  // Rebalance the ragged last page so its columns share the load instead of
  // everything stacking leftmost. Guarded: if the midpoint heuristic would
  // overfill a column, the plain flowed layout stands.
  const lastCap = Math.max(
    1,
    opts.columnHeight - (pages.length === 1 ? (opts.firstPageOffset ?? 0) : (opts.laterPageOffset ?? 0)),
  )
  const flat = pages[pages.length - 1].flat()
  if (opts.columns > 1 && flat.length > 1) {
    const balanced = balanceColumns(flat, opts)
    const colHeight = (col: T[]) => col.reduce((sum, i) => sum + opts.heightOf(i), 0)
    if (balanced.every((col) => colHeight(col) <= lastCap)) pages[pages.length - 1] = balanced
  }
  return pages
}

/** Distribute items over columns in order, closing each near total/columns. */
function balanceColumns<T>(items: T[], opts: PaginateOptions<T>): T[][] {
  const target = items.reduce((sum, i) => sum + opts.heightOf(i), 0) / opts.columns
  const out: T[][] = [[]]
  let used = 0
  for (const item of items) {
    const col = out[out.length - 1]
    const h = opts.heightOf(item)
    // An item belongs to the current column while its midpoint is before the
    // target; afterwards it opens the next column (while any remain).
    if (col.length > 0 && out.length < opts.columns && used + h / 2 > target) {
      const prev = col[col.length - 1]
      if (prev !== undefined && col.length > 1 && opts.keepWithNext?.(prev)) {
        col.pop()
        out.push([prev, item])
        used = opts.heightOf(prev) + h
      } else {
        out.push([item])
        used = h
      }
      continue
    }
    col.push(item)
    used += h
  }
  while (out.length < opts.columns) out.push([])
  return out
}

// ---- the document ----------------------------------------------------------

export type DocPage =
  | { kind: 'plan'; masthead: boolean }
  | { kind: 'tables'; masthead: boolean; continued: boolean; columns: TableCard[][] }
  | { kind: 'directory'; masthead: boolean; continued: boolean; columns: DirectoryItem[][] }
  | { kind: 'catering'; masthead: boolean; continued: boolean; columns: CateringBlock[][] }

export interface DocModel {
  pages: DocPage[]
  paper: PaperSize
  displayTitle: string
  dateLine: string
  venueLine: string
  finalized: boolean
  legend: DietaryLegendEntry[]
  stats: ExportStats
}

/** Which sections have anything to print at all. */
export function availableSections(state: AisleState): ExportSections {
  const attending = state.guestOrder.some((id) => state.guests[id].rsvp !== 'no')
  return {
    floorPlan: state.tableOrder.length > 0 || Object.values(state.venue).some((f) => f.enabled),
    tables: state.tableOrder.length > 0,
    directory: attending,
    catering: attending,
  }
}

export function buildDocModel(state: AisleState, options: ExportOptions): DocModel {
  const avail = availableSections(state)
  const on = (k: keyof ExportSections) => options.sections[k] && avail[k]
  const stats = buildStats(state)
  const legend = dietaryLegend(state)
  const displayTitle = options.eventTitle.trim() || 'Seating Chart'
  const m = EXPORT_METRICS
  const colH = contentHeight(options.paper)
  const mastH = mastheadHeight(displayTitle)
  const pages: DocPage[] = []
  let mastheadPlaced = false
  const claimMasthead = () => {
    const first = !mastheadPlaced
    mastheadPlaced = true
    return first
  }

  if (on('floorPlan')) pages.push({ kind: 'plan', masthead: claimMasthead() })

  if (on('tables')) {
    const cards = buildTableCards(state, legend)
    const legendLine = legend.length > 0 || stats.pending > 0 ? m.legendLineH : 0
    const first = !mastheadPlaced
    paginateColumns(cards, {
      heightOf: (c) => c.h,
      columnHeight: colH,
      columns: 2,
      firstPageOffset: (first ? mastH : 0) + m.sectionHeaderH + legendLine,
      laterPageOffset: m.continuedHeaderH,
    }).forEach((columns, i) =>
      pages.push({ kind: 'tables', masthead: i === 0 && claimMasthead(), continued: i > 0, columns }),
    )
  }

  if (on('directory')) {
    const items = buildDirectory(state)
    const legendLine = stats.pending > 0 ? m.legendLineH : 0
    const first = !mastheadPlaced
    paginateColumns(items, {
      heightOf: (item) => item.h,
      columnHeight: colH,
      columns: 3,
      firstPageOffset: (first ? mastH : 0) + m.sectionHeaderH + legendLine,
      laterPageOffset: m.continuedHeaderH,
      keepWithNext: (item) => item.kind === 'letter',
    }).forEach((columns, i) =>
      pages.push({ kind: 'directory', masthead: i === 0 && claimMasthead(), continued: i > 0, columns }),
    )
  }

  if (on('catering')) {
    const blocks = buildCatering(state, legend, stats)
    const first = !mastheadPlaced
    paginateColumns(blocks, {
      heightOf: (b) => b.h,
      columnHeight: colH,
      columns: 2,
      firstPageOffset: (first ? mastH : 0) + m.sectionHeaderH,
      laterPageOffset: m.continuedHeaderH,
    }).forEach((columns, i) =>
      pages.push({ kind: 'catering', masthead: i === 0 && claimMasthead(), continued: i > 0, columns }),
    )
  }

  return {
    pages,
    paper: options.paper,
    displayTitle,
    dateLine: options.eventDate.trim(),
    venueLine: options.venueName.trim(),
    finalized: state.finalized,
    legend,
    stats,
  }
}

// ---- flat data formats -----------------------------------------------------

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** Every guest as a spreadsheet row — including declined ones, table blank. */
export function chartCSV(state: AisleState): string {
  const rows: string[][] = [['Guest', 'Group', 'RSVP', 'Dietary', 'Table', 'Seat']]
  for (const id of state.guestOrder) {
    const g = state.guests[id]
    const seat = state.seating[id]
    const table = seat ? state.tables[seat.tableId] : undefined
    rows.push([
      g.name,
      g.group,
      g.rsvp,
      g.dietary.join('; '),
      table?.name ?? '',
      table ? String(seat!.seat + 1) : '',
    ])
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n'
}

/** Filesystem-friendly base name derived from the event title. */
export function exportFileName(displayTitle: string, ext: string): string {
  const slug = displayTitle
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${slug || 'seating-chart'}.${ext}`
}
