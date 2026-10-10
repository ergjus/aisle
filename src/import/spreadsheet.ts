import type { RSVP } from '../types'
import { parseGuestEntries, type ImportEntry } from '../utils'
import { ZipError, openZip } from './zip'

/** What the file picker offers and what readSpreadsheet knows how to open. */
export const SPREADSHEET_ACCEPT = '.xlsx,.xlsm,.csv,.tsv,.txt'

export class SpreadsheetError extends Error {}

// ---- xlsx ------------------------------------------------------------------

function parseXml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.querySelector('parsererror')) throw new SpreadsheetError('That workbook’s contents could not be read.')
  return doc
}

/** Concatenates every text run in an element — rich text arrives split across <r><t> runs. */
function textOf(element: Element | null): string {
  if (!element) return ''
  return Array.from(element.getElementsByTagName('t'))
    .map((t) => t.textContent ?? '')
    .join('')
}

/** "AB12" → 27 (zero-based column index). */
function columnIndex(ref: string): number {
  let index = 0
  for (const char of ref) {
    const code = char.charCodeAt(0)
    if (code < 65 || code > 90) break
    index = index * 26 + (code - 64)
  }
  return Math.max(0, index - 1)
}

/** Path of the first sheet in the workbook's own order, resolved through its rels. */
function firstSheetPath(workbook: Document | null, rels: Document | null): string {
  const sheet = workbook?.getElementsByTagName('sheet')[0]
  const relationId = sheet?.getAttribute('r:id') ?? sheet?.getAttribute('id')
  if (relationId && rels) {
    for (const rel of Array.from(rels.getElementsByTagName('Relationship'))) {
      if (rel.getAttribute('Id') !== relationId) continue
      const target = rel.getAttribute('Target') ?? ''
      return target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
    }
  }
  return 'xl/worksheets/sheet1.xml'
}

async function readXlsx(buffer: ArrayBuffer): Promise<string[][]> {
  const zip = openZip(buffer)
  const decoder = new TextDecoder()
  const read = async (path: string) => {
    const entry = zip.get(path)
    return entry ? parseXml(decoder.decode(await entry())) : null
  }

  const sharedDoc = await read('xl/sharedStrings.xml')
  const shared = sharedDoc
    ? Array.from(sharedDoc.getElementsByTagName('si')).map((si) => textOf(si))
    : []

  const sheetPath = firstSheetPath(await read('xl/workbook.xml'), await read('xl/_rels/workbook.xml.rels'))
  const sheet = (await read(sheetPath)) ?? (await read('xl/worksheets/sheet1.xml'))
  if (!sheet) throw new SpreadsheetError('That workbook has no readable sheet.')

  const rows: string[][] = []
  for (const row of Array.from(sheet.getElementsByTagName('row'))) {
    const cells: string[] = []
    for (const cell of Array.from(row.getElementsByTagName('c'))) {
      const type = cell.getAttribute('t')
      const ref = cell.getAttribute('r')
      let value: string
      if (type === 's') {
        const index = Number(cell.getElementsByTagName('v')[0]?.textContent ?? NaN)
        value = shared[index] ?? ''
      } else if (type === 'inlineStr') {
        value = textOf(cell.getElementsByTagName('is')[0] ?? null)
      } else {
        value = cell.getElementsByTagName('v')[0]?.textContent ?? ''
      }
      const at = ref ? columnIndex(ref) : cells.length
      while (cells.length < at) cells.push('')
      cells[at] = value.trim()
    }
    rows.push(cells)
  }
  return rows
}

// ---- delimited text --------------------------------------------------------

/** RFC-4180 CSV/TSV, including quoted fields with embedded commas and newlines. */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const body = text.replace(/^﻿/, '')
  for (let i = 0; i < body.length; i++) {
    const char = body[i]
    if (quoted) {
      if (char !== '"') field += char
      else if (body[i + 1] === '"') { field += '"'; i++ }
      else quoted = false
      continue
    }
    if (char === '"') quoted = true
    else if (char === delimiter) { row.push(field); field = '' }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && body[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += char
  }
  if (field || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.map((cells) => cells.map((cell) => cell.trim()))
}

/** Whichever of comma, tab, or semicolon actually separates this file's columns. */
function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 20).join('\n')
  const score = (d: string) => parseDelimited(sample, d).reduce((n, row) => n + row.length, 0)
  return [',', '\t', ';'].reduce((best, d) => (score(d) > score(best) ? d : best), ',')
}


// ---- rows → guests ---------------------------------------------------------
//
// Guest lists arrive in two shapes: one row per guest (most hand-made sheets,
// WeddingWire, The Knot) or one row per invitation, with the partner, the
// plus-one and the children in extra columns (Zola). So each header cell is
// read as a person slot — '' for the row's own guest, or "partner",
// "plus one", "guest 2", "child 1"… — plus the field it holds, and
// "Partner First Name" or "Guest 2 Meal" lands on the right person.

type Field =
  | 'name' | 'first' | 'last' | 'title' | 'suffix'
  | 'group' | 'household' | 'side'
  | 'rsvp' | 'meal' | 'dietary' | 'notes' | 'age'

interface HeaderCell {
  index: number
  /** '' is the row's own guest; anything else is another person in the same party. */
  slot: string
  field: Field
  /** Which of several per-event columns wins: the reception beats the rehearsal dinner. */
  rank: number
  /** The header as written, for labelling extra note columns. */
  label: string
}

type SlotFields = Partial<Record<Field, HeaderCell[]>>

/** "Entrée (Guest #2)" → "entree guest 2"; "+1" → "plus one"; "Bride's" → "brides". */
function normalizeHeader(cell: string): string {
  return cell
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\+\s*1\b/g, ' plus one ')
    .replace(/['’]s\b/g, 's')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Contact, mailing, gift and bookkeeping columns: read past them, never into a guest. */
const IGNORED =
  /\b(e ?mails?|phones?|mobile|cell|telephone|tel|address(es|ed)?|street|apt|suite|city|town|state|province|zip|postal|postcode|post code|country|gifts?|registry|thank yous?|invit\w*|save the date|mailing|envelope|tables?|seats?|seating|size|count|total|number|qty|quantity|dates?|responded|created|added|updated|modified|website|url|id)\b/

function splitSlot(text: string): { slot: string; rest: string } {
  let m = text.match(/^(?:guest|person|invitee|attendee|name)s? ?(\d+)\b ?(.*)$/)
  if (m) return { slot: m[1] === '1' ? '' : `guest ${m[1]}`, rest: m[2] }
  m = text.match(/^(?:child|kid)(?:ren|s)? ?(\d+)\b ?(.*)$/)
  if (m) return { slot: `child ${m[1]}`, rest: m[2] }
  m = text.match(/^(partner|spouse|significant other|companion|plus one|plusone|second guest)\b ?(.*)$/)
  if (m) return { slot: m[1].startsWith('plus') ? 'plus one' : 'partner', rest: m[2] }
  m = text.match(/^(?:primary|main|lead) (?:guest )?(.*)$/)
  if (m) return { slot: '', rest: m[1] }
  // The slot written last: "First Name (Guest 2)", "Name 2", "Name of Partner".
  m = text.match(/^(.*?) ?(?:guest|person) (\d+)$/) ?? text.match(/^(.*\bnames?) (\d+)$/)
  if (m) return { slot: m[2] === '1' ? '' : `guest ${m[2]}`, rest: m[1] }
  m = text.match(/^(.*?) (?:of )?(partner|spouse|plus one)$/)
  if (m) return { slot: m[2] === 'plus one' ? 'plus one' : 'partner', rest: m[1] }
  return { slot: '', rest: text }
}

/** What a (slot-stripped, normalized) header holds. Order matters: "Household Name" is a household, not a name. */
function classifyField(text: string, slotted: boolean): Field | null {
  if (!text) return slotted ? 'name' : null
  if (/\b(household|party|family|group|invitation) (id|no|number|code|key)\b/.test(text)) return 'household'
  if (/\b(side|bride or groom|brides or grooms|bride groom|groom bride|guest of|invited by|whose guest)\b/.test(text)) return 'side'
  if (IGNORED.test(text)) return null
  if (/^(title|prefix|salutation|honorific)$/.test(text)) return 'title'
  if (/^(name )?suffix$/.test(text)) return 'suffix'
  if (/^(first|given|fore) ?names?$|^(first|given|forename)$/.test(text)) return 'first'
  if (/^(last|sur|family) ?names?$|^(last|surname)$/.test(text)) return 'last'
  if (/\b(rsvps?|attending|attendance|responses?|repl(y|ies)|status|confirmed|confirmation|coming|accepts?)\b/.test(text)) return 'rsvp'
  if (/\b(diet|dietary|allerg\w*|restrictions?|intolerances?)\b/.test(text)) return 'dietary'
  if (/\b(meals?|entrees?|menus?|food|course|selection|dish)\b/.test(text)) return 'meal'
  if (/^(age|ages|age group|age range|adult child|adult or child|child or adult|guest type)$/.test(text)) return 'age'
  if (/\b(wedding|bridal) party\b/.test(text)) return 'notes'
  if (/\b(groups?|category|categories|relationship|relation|affiliation|circle|connection|tags?)\b/.test(text)) return 'group'
  if (/\b(households?|party|parties|family|families)\b/.test(text)) return 'household'
  if (/\b(notes?|comments?|remarks?|details?|memo|message|requests?|info|information|role)\b/.test(text)) return 'notes'
  if (/\b(names?|guests?|attendees?|invitees?|persons?|people|who)\b/.test(text)) return 'name'
  return null
}

/**
 * Per-event columns ("Wedding RSVP", "Reception - RSVP", "Rehearsal Dinner
 * Meal") are ranked so the main event decides a guest's RSVP and meal: the
 * reception or wedding first, then a column naming no event at all, then the
 * ceremony, then everything else (rehearsal, welcome party, brunch…).
 */
function eventRank(text: string): number {
  if (/\b(reception|wedding)\b/.test(text)) return 4
  const rest = text
    .replace(/\b(rsvps?|attending|attendance|responses?|repl(y|ies)|status|confirmed|confirmation|coming|accepts?|meals?|entrees?|menus?|food|course|selection|dish|choices?|options?|preferences?|main|the|for|to|of|at|and|or|event|guests?)\b/g, '')
    .trim()
  if (!rest) return 3
  return /\bceremony\b/.test(rest) ? 2 : 1
}

function readHeader(row: string[]): HeaderCell[] {
  const cells: HeaderCell[] = []
  row.forEach((raw, index) => {
    const text = normalizeHeader(raw)
    if (!text) return
    const { slot, rest } = splitSlot(text)
    const field = classifyField(rest, rest !== text)
    if (field) cells.push({ index, slot, field, rank: eventRank(rest), label: raw.trim() })
  })
  return cells
}

const namesSomebody = (cells: HeaderCell[]) =>
  cells.some((cell) => cell.slot === '' && (cell.field === 'name' || cell.field === 'first'))

function layoutOf(cells: HeaderCell[]): Map<string, SlotFields> {
  const layout = new Map<string, SlotFields>([['', {}]])
  for (const cell of cells) {
    const fields = layout.get(cell.slot) ?? {}
    layout.set(cell.slot, fields)
    ;(fields[cell.field] ??= []).push(cell)
  }
  for (const fields of layout.values()) {
    for (const [field, list] of Object.entries(fields) as [Field, HeaderCell[]][]) {
      list.sort((a, b) => (field === 'notes' ? 0 : b.rank - a.rank) || a.index - b.index)
    }
  }
  return layout
}

// ---- headerless rows -------------------------------------------------------

const DIETARY_WORDS =
  /vegan|vegetarian|gluten|halal|kosher|allerg|dairy|lactose|pescatarian|\bnuts?\b|shellfish|celiac|coeliac|keto|chicken|beef|fish|salmon|steak/i

/**
 * Rows with no header — the usual paste out of Sheets or Excel — are read by
 * what their columns hold: a column of RSVP words is the RSVP, a column of
 * dietary words is dietary, emails, phone numbers and bare numbers are
 * skipped, and the text columns that remain are name, then group, then notes.
 */
function sniffColumns(rows: string[][]): HeaderCell[] {
  const width = Math.max(0, ...rows.map((row) => row.length))
  const cells: HeaderCell[] = []
  const free: number[] = []
  for (let index = 0; index < width; index++) {
    const values = rows.map((row) => (row[index] ?? '').trim()).filter(Boolean)
    if (values.length === 0) continue
    if (index === 0) {
      free.push(index)
      continue
    }
    const share = (test: (value: string) => boolean) => values.filter(test).length / values.length
    if (share((v) => /@|^[\d\s().+#-]+$/.test(v)) >= 0.6) continue
    const base = { index, slot: '', rank: 0, label: '' }
    if (share((v) => /[a-z?]/i.test(v) && parseRsvp(v) !== undefined) >= 0.6) cells.push({ ...base, field: 'rsvp' })
    else if (share((v) => DIETARY_WORDS.test(v)) >= 0.5) cells.push({ ...base, field: 'dietary' })
    else free.push(index)
  }
  free.forEach((index, i) =>
    cells.push({ index, slot: '', rank: 0, label: '', field: i === 0 ? 'name' : i === 1 ? 'group' : 'notes' }),
  )
  return cells
}

// ---- values ----------------------------------------------------------------

const RSVP_WORDS: [RSVP, RegExp][] = [
  // "No response" and "not yet replied" are pending, so they're tried before "no".
  ['pending', /^(pending|maybe|tentative|invited|awaiting( response| reply| rsvp)?|unknown|tbd|tba|undecided|no (response|reply|answer|rsvp)( yet)?|not (yet )?(responded|replied)|unanswered|waiting|hasn t (responded|replied)|\?)$/],
  ['no', /^(n|no|false|0|declined?|declines|regrets?|regretfully declines?|sends? regrets|not (attending|coming|going)|cannot( attend)?|can t( attend| make it| come)?|won t( attend| be attending)?|will not attend|unable( to attend)?|absent|cancell?ed)$/],
  ['yes', /^(y|yes|true|1|x|attending|attend|accepted|accepts?|joyfully accepts?|coming|confirmed|going|will attend|present|yes attending|attending (the )?(wedding|reception|ceremony))$/],
]

function parseRsvp(cell: string): RSVP | undefined {
  const text = cell.trim().toLowerCase().replace(/[^a-z0-9?]+/g, ' ').trim()
  if (!text) return undefined
  for (const [rsvp, pattern] of RSVP_WORDS) if (pattern.test(text)) return rsvp
  return undefined
}

/** Cells that mean "nothing here": no meal picked, no restrictions, no plus-one. */
const NOTHING = /^(no|n|none|nope|false|0|-+|n\/?a|nil|null|no preference|not selected|no selection|not applicable|no restrictions?|nothing)$/i
/** A plus-one who hasn't been named yet. */
const UNNAMED = /^(guest|a guest|and guest|plus one|plus-one|\+ ?1|tbd|tba|unknown|unnamed|yes|y|x|true|1|✓|guest of .+|.+['’]s guest)$/i
/** A row-per-guest export's own placeholder row for a plus-one ("Guest", "+1"). */
const PLACEHOLDER_ROW = /^(guest|a guest|and guest|plus one|plus-one|\+ ?1|tbd|tba|unknown|unnamed)$/i
/** Courtesy titles that add nothing to a name; anything else (Dr., Rev., Hon.) is kept. */
const PLAIN_TITLE = /^(mr|mrs|ms|miss|mx|master|m|mme|mlle|sr|sra|srta)\.?$/i

function splitList(cell: string): string[] {
  return cell.split(/[,;/]/).map((part) => part.trim()).filter((part) => part && !NOTHING.test(part))
}

/** A bare "Bride"/"Groom"/"Both" from a Side column reads better as a group name. */
function sideGroup(value: string): string {
  const text = value.trim().toLowerCase().replace(/['’]s\b/, 's').replace(/\s+side$/, '')
  if (/^brides?$/.test(text)) return 'Bride’s side'
  if (/^grooms?$/.test(text)) return 'Groom’s side'
  if (/^(both|mutual|shared|couple)$/.test(text)) return 'Both sides'
  return value.trim()
}

// ---- platforms -------------------------------------------------------------

/** Where a sheet appears to come from — named in the import summary, never relied on for the mapping. */
export type SheetFormat = 'zola' | 'theknot' | 'weddingwire' | 'sheet' | 'rows' | 'list'

/**
 * Header fingerprints of the big planning sites' guest-list exports. None of
 * them publish a spec and they reword columns from time to time, so these are
 * best-known shapes, matched loosely — the column mapping above works by
 * meaning and doesn't depend on which site a file came from.
 *
 * - Zola: one row per invitation — Title, First Name, Last Name, Suffix,
 *   Partner Title / Partner First Name / Partner Last Name / Partner Suffix,
 *   Child 1…N First Name / Last Name, mailing address, Email, Phone, then
 *   "<Event> RSVP" and "<Event> Meal" per event ("Wedding RSVP",
 *   "Rehearsal Dinner RSVP"). Unnamed plus-ones come through as "Guest".
 * - The Knot: one row per guest, grouped by Party/Household, with Side, a
 *   Plus-One name, and "<Event> - RSVP" / "<Event> - Meal" columns per event
 *   ("Ceremony - RSVP", "Reception - RSVP", "Reception - Meal").
 * - WeddingWire: one row per guest — First Name, Last Name, Group ("Bride's
 *   family", "Groom's friends"…), Age (Adult/Child/Baby), Menu, Attendance
 *   (Confirmed/Pending/Declined), Table, contact details, Notes.
 */
const FINGERPRINTS: [SheetFormat, RegExp, number][] = [
  ['zola', /^partner (title|first name|last name|suffix)$/, 3],
  ['zola', /^child ?\d+ (first|last) name$/, 1],
  ['zola', /^[a-z' ]+ (rsvp|meal)$/, 1],
  ['theknot', /^[^-–]+ [-–] (rsvp|meal|entr[eé]e)\b/, 3],
  ['theknot', /^(party|household)( name)?$/, 1],
  ['theknot', /^(plus[- ]one|guest 2)( (first |last |full )?name)?$/, 1],
  ['weddingwire', /^attendance\b/, 2],
  ['weddingwire', /^menu\b/, 1],
  ['weddingwire', /^(age|age group|adult\s*\/\s*child)$/, 1],
  ['weddingwire', /^table\b/, 1],
]

function detectFormat(header: string[]): SheetFormat {
  const scores = new Map<SheetFormat, number>()
  for (const raw of header) {
    const text = raw.trim().toLowerCase().replace(/\s+/g, ' ')
    for (const [format, pattern, weight] of FINGERPRINTS) {
      if (pattern.test(text)) scores.set(format, (scores.get(format) ?? 0) + weight)
    }
  }
  const [best, runnerUp] = [...scores.entries()].sort((a, b) => b[1] - a[1])
  return best && best[1] >= 3 && (!runnerUp || runnerUp[1] < best[1]) ? best[0] : 'sheet'
}

const FORMAT_LEAD: Record<SheetFormat, string> = {
  zola: 'Looks like a Zola export',
  theknot: 'Looks like an export from The Knot',
  weddingwire: 'Looks like a WeddingWire export',
  sheet: 'Read the sheet by its header row',
  rows: 'Read rows without a header',
  list: 'Read a pasted list',
}

// ---- the import ------------------------------------------------------------

export interface SheetImport {
  entries: ImportEntry[]
  /** Which column each of the row's own guest's fields came from, so the UI can say what it understood. */
  columns: Partial<Record<Field, number>>
  /** True when a row was consumed as a header rather than a guest. */
  usedHeader: boolean
  /** Which export the header looks like; 'sheet' for any other headed sheet. */
  format: SheetFormat
  /** Invitations/households the guests came in — a partner or plus-one shares their row's party. */
  parties: number
}

/** "Looks like a Zola export: 84 guests in 41 parties" — what was read, before duplicates are dropped. */
export function describeImport(sheet: SheetImport): string {
  const n = sheet.entries.length
  const guests = `${n} guest${n === 1 ? '' : 's'}`
  const parties =
    sheet.parties > 0 && sheet.parties < n ? ` in ${sheet.parties} part${sheet.parties === 1 ? 'y' : 'ies'}` : ''
  return `${FORMAT_LEAD[sheet.format]}: ${guests}${parties}`
}

/**
 * Reads a sheet of rows as guests. A header row is used when one is there —
 * a planning site's export or a planner's own sheet, columns in any order —
 * and otherwise each column is read by what it holds. A row can carry a whole
 * party: partner, plus-one, "Guest 2" and child columns become guests of
 * their own, in the row's group.
 */
export function guestEntriesFromRows(rows: string[][], defaultGroup?: string): SheetImport {
  const filled = rows.filter((row) => row.some((cell) => cell.trim()))
  if (filled.length === 0) return { entries: [], columns: {}, usedHeader: false, format: 'rows', parties: 0 }

  // A header only counts if it names somebody — a sheet whose first row is a
  // guest shouldn't lose that guest to a stray "notes" column. Exports
  // sometimes open with a title line or two ("Guest List — exported May 3"),
  // so a header a few single-cell rows down is found too.
  let headerAt = -1
  let cells: HeaderCell[] = []
  for (let i = 0; i < Math.min(filled.length, 5); i++) {
    const candidate = readHeader(filled[i])
    const cellsFilled = filled[i].filter((cell) => cell.trim())
    // "Our guest list (exported May 3)" mentions guests but is a title, not a header.
    const titleLine = cellsFilled.length === 1 && cellsFilled[0].trim().split(/\s+/).length > 3
    if (namesSomebody(candidate) && !titleLine) {
      headerAt = i
      cells = candidate
      break
    }
    if (cellsFilled.length > 1) break
  }
  const usedHeader = headerAt >= 0
  const body = usedHeader ? filled.slice(headerAt + 1) : filled
  if (!usedHeader) cells = sniffColumns(body)
  const format = usedHeader ? detectFormat(filled[headerAt]) : 'rows'

  const layout = layoutOf(cells)
  const own = layout.get('')!
  const columns: Partial<Record<Field, number>> = {}
  for (const [field, list] of Object.entries(own) as [Field, HeaderCell[]][]) columns[field] = list[0].index

  const entries: ImportEntry[] = []
  const parties = new Set<string>()
  /** Each party's first named guest, whom its unnamed plus-ones are named after. */
  const anchors = new Map<string, string>()
  const unnamedCount = new Map<string, number>()
  const unnamedGuest = (host: string) => {
    const n = (unnamedCount.get(host) ?? 0) + 1
    unnamedCount.set(host, n)
    return `${host}’s guest${n > 1 ? ` ${n}` : ''}`
  }
  body.forEach((row, rowIndex) => {
    const value = (cell: HeaderCell) => (row[cell.index] ?? '').trim()
    const pick = (list: HeaderCell[] | undefined, accept: (v: string) => boolean = Boolean) =>
      list?.map(value).find(accept) ?? ''
    const rsvpOf = (fields: SlotFields) =>
      fields.rsvp?.map((cell) => parseRsvp(value(cell))).find((rsvp) => rsvp !== undefined)
    const dietaryOf = (fields: SlotFields) => {
      const meal = pick(fields.meal, (v) => Boolean(v) && !NOTHING.test(v))
      const list = [...(meal ? [meal] : []), ...(fields.dietary ?? []).flatMap((cell) => splitList(value(cell)))]
      const unique = list.filter((item, i) => list.findIndex((x) => x.toLowerCase() === item.toLowerCase()) === i)
      return unique.length ? unique : undefined
    }
    const notesOf = (fields: SlotFields, extra: string[] = []) => {
      const parts = (fields.notes ?? []).flatMap((cell) => {
        const text = value(cell)
        if (!text || NOTHING.test(text)) return []
        return !cell.label || /^(notes?|comments?|remarks?)$/i.test(cell.label) ? [text] : [`${cell.label}: ${text}`]
      })
      const age = pick(fields.age)
      if (/child|kid|baby|infant|toddler|minor|junior/i.test(age)) parts.push(age)
      parts.push(...extra)
      return parts.length ? parts.join('; ') : undefined
    }
    const nameOf = (fields: SlotFields, fallbackLast = '') => {
      const full = pick(fields.name)
      if (full) return full
      const given = pick(fields.first)
      const family = pick(fields.last) || (given ? fallbackLast : '')
      if (!given && !family) return ''
      const title = pick(fields.title)
      return [title && !PLAIN_TITLE.test(title) ? title : '', given, family, pick(fields.suffix)]
        .filter(Boolean)
        .join(' ')
    }

    const written = nameOf(own)
    if (!written) return
    const household = pick(own.household)
    const side = pick(own.side)
    const group = pick(own.group) || household || (side ? sideGroup(side) : '') || defaultGroup
    const rsvp = rsvpOf(own)
    const party = household ? `household:${household.toLowerCase()}` : `row:${rowIndex}`
    parties.add(party)
    // A plus-one row nobody has named yet ("Guest") is named for whoever it
    // came with, so three of them don't collapse into one "Guest".
    const anchor = PLACEHOLDER_ROW.test(written) ? (anchors.get(party) ?? household) : ''
    const name = anchor ? unnamedGuest(anchor) : written
    if (!anchor && !PLACEHOLDER_ROW.test(written) && !anchors.has(party)) anchors.set(party, name)
    entries.push({
      name,
      group,
      dietary: dietaryOf(own),
      rsvp,
      notes: notesOf(own, anchor && anchors.get(party) === anchor ? [`Same party as ${anchor}`] : []),
    })

    // Everyone else on the row: partner, plus-one, Guest 2…, children.
    const ownLast = pick(own.last)
    for (const [slot, fields] of layout) {
      if (slot === '') continue
      const given = pick(fields.name) || pick(fields.first)
      if (!given || NOTHING.test(given)) continue
      const extraName =
        UNNAMED.test(given) && !pick(fields.last)
          ? unnamedGuest(name)
          : nameOf(fields, ownLast)
      entries.push({
        name: extraName,
        group,
        dietary: dietaryOf(fields),
        rsvp: rsvpOf(fields) ?? rsvp,
        notes: notesOf(fields, [`Same party as ${name}`]),
      })
    }
  })
  return { entries, columns, usedHeader, format, parties: parties.size }
}

/**
 * Reads a guest list out of pasted text, picking the shape it is actually in:
 * rows copied straight out of a spreadsheet or a planning site's export (with
 * or without a header row), or the one-per-line "Name — Group — dietary" form
 * the paste box has always taken. Columns are only trusted when the text
 * really reads as a table — a lone comma in "Flynn, Nora" is a name, not a
 * column break.
 */
export function guestImportFromText(text: string, defaultGroup?: string): SheetImport {
  const trimmed = text.trim()
  const asList = (): SheetImport => {
    const entries = parseGuestEntries(trimmed, defaultGroup)
    return { entries, columns: {}, usedHeader: false, format: 'list', parties: entries.length }
  }
  if (!trimmed || trimmed.startsWith('[')) return asList()
  const delimiter = detectDelimiter(trimmed)
  const rows = parseDelimited(trimmed, delimiter).filter((row) => row.some((cell) => cell))
  const widths = rows.map((row) => row.length)
  const columnar =
    rows.length > 0 &&
    widths.filter((width) => width >= 2).length >= Math.max(1, rows.length - 1) &&
    // Tabs and semicolons only ever separate columns; commas need more
    // evidence — a header we recognise, or a third column.
    (delimiter !== ',' || widths.filter((width) => width >= 3).length >= Math.max(1, rows.length - 1))
  const sheet = guestEntriesFromRows(rows, defaultGroup)
  if (sheet.entries.length > 0 && (columnar || sheet.usedHeader)) return sheet
  return asList()
}

/** The entries alone, for callers that don't report where the list came from. */
export function guestEntriesFromText(text: string, defaultGroup?: string): ImportEntry[] {
  return guestImportFromText(text, defaultGroup).entries
}

/**
 * Reads a guest list out of a spreadsheet the user picked — .xlsx straight
 * from Excel, Numbers, or Sheets, or any CSV/TSV export of one, including the
 * guest-list exports of Zola, The Knot and WeddingWire.
 */
export async function readSpreadsheet(file: File, defaultGroup?: string): Promise<SheetImport> {
  const isWorkbook = /\.xls[xm]$/i.test(file.name)
  if (/\.xls$/i.test(file.name)) {
    throw new SpreadsheetError('Old .xls workbooks aren’t supported — re-save it as .xlsx or CSV.')
  }
  try {
    if (isWorkbook) return guestEntriesFromRows(await readXlsx(await file.arrayBuffer()), defaultGroup)
    const text = await file.text()
    return guestEntriesFromRows(parseDelimited(text, detectDelimiter(text)), defaultGroup)
  } catch (error) {
    if (error instanceof SpreadsheetError) throw error
    if (error instanceof ZipError) throw new SpreadsheetError(error.message)
    throw new SpreadsheetError(`${file.name} could not be read as a spreadsheet.`)
  }
}
