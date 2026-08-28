import type { RSVP } from '../types'
import type { ImportEntry } from '../utils'
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

type Column = 'name' | 'first' | 'last' | 'group' | 'rsvp' | 'dietary' | 'notes'

/** Header words we recognise, longest-lived synonyms first. */
const COLUMN_WORDS: [Column, RegExp][] = [
  ['first', /^(first|given|fore)\s*(name)?$/],
  ['last', /^(last|sur|family)\s*(name)?$/],
  ['name', /\b(name|guest|attendee|invitee|person)\b/],
  ['group', /\b(group|party|side|category|household|family|table group|relation)\b/],
  ['rsvp', /\b(rsvp|attending|response|status|confirmed)\b/],
  ['dietary', /\b(dietary|diet|meal|food|allerg|restriction)\b/],
  ['notes', /\b(note|notes|comment|remark|detail)\b/],
]

function classifyHeader(cell: string): Column | null {
  const text = cell.trim().toLowerCase()
  if (!text) return null
  for (const [column, pattern] of COLUMN_WORDS) if (pattern.test(text)) return column
  return null
}

const RSVP_WORDS: [RSVP, RegExp][] = [
  ['yes', /^(y|yes|true|1|attending|accepted|coming|confirmed|going)$/],
  ['no', /^(n|no|false|0|declined|regrets|not attending|not coming|cannot)$/],
  ['pending', /^(pending|maybe|invited|awaiting|unknown|tbd|no response|\?)$/],
]

function parseRsvp(cell: string): RSVP | undefined {
  const text = cell.trim().toLowerCase()
  if (!text) return undefined
  for (const [rsvp, pattern] of RSVP_WORDS) if (pattern.test(text)) return rsvp
  return undefined
}

function splitList(cell: string): string[] {
  return cell.split(/[,;/]/).map((part) => part.trim()).filter(Boolean)
}

export interface SheetImport {
  entries: ImportEntry[]
  /** Which column each field came from, so the UI can say what it understood. */
  columns: Partial<Record<Column, number>>
  /** True when the first row was consumed as a header rather than a guest. */
  usedHeader: boolean
}

/**
 * Reads a sheet of rows as guests. A header row is used when one is there —
 * so a planner's own spreadsheet, with its columns in its own order, imports
 * as-is — and otherwise the columns fall back to name, group, RSVP, dietary,
 * notes, which is the order these lists are usually written in.
 */
export function guestEntriesFromRows(rows: string[][], defaultGroup?: string): SheetImport {
  const filled = rows.filter((row) => row.some((cell) => cell.trim()))
  if (filled.length === 0) return { entries: [], columns: {}, usedHeader: false }

  const columns: Partial<Record<Column, number>> = {}
  const header = filled[0]
  header.forEach((cell, index) => {
    const column = classifyHeader(cell)
    if (column && columns[column] === undefined) columns[column] = index
  })
  // A header only counts if it names somebody — a sheet whose first row is a
  // guest shouldn't lose that guest to a stray "notes" column.
  const usedHeader = columns.name !== undefined || columns.first !== undefined
  if (!usedHeader) {
    for (const key of Object.keys(columns) as Column[]) delete columns[key]
    columns.name = 0
    columns.group = 1
    columns.rsvp = 2
    columns.dietary = 3
    columns.notes = 4
  }

  const at = (row: string[], column: Column | undefined) =>
    column !== undefined && columns[column] !== undefined ? (row[columns[column]!] ?? '').trim() : ''

  const entries: ImportEntry[] = []
  for (const row of usedHeader ? filled.slice(1) : filled) {
    const name = [at(row, 'name'), [at(row, 'first'), at(row, 'last')].filter(Boolean).join(' ')]
      .find(Boolean)
      ?.trim()
    if (!name) continue
    const group = at(row, 'group')
    const dietary = splitList(at(row, 'dietary'))
    const notes = at(row, 'notes')
    entries.push({
      name,
      group: group || defaultGroup,
      dietary: dietary.length ? dietary : undefined,
      rsvp: parseRsvp(at(row, 'rsvp')),
      notes: notes || undefined,
    })
  }
  return { entries, columns, usedHeader }
}

/**
 * Reads a guest list out of a spreadsheet the user picked — .xlsx straight
 * from Excel, Numbers, or Sheets, or any CSV/TSV export of one.
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
