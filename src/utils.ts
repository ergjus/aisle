import type { AisleState, RSVP } from './types'
import { occupantsOf } from './store'

// ---- group colors ----------------------------------------------------------

const GROUP_PALETTE = [
  '#c4878b', // rose
  '#8fa878', // sage
  '#c9a45c', // gold
  '#7f9bb3', // slate
  '#a985ad', // mauve
  '#c28058', // terracotta
  '#6fa39a', // teal
  '#9d7386', // plum
  '#a8a068', // olive
  '#b3887f', // clay
]

/** Stable group → color map, assigned in groupOrder (falls back to first-appearance order). */
export function groupColors(state: AisleState): Record<string, string> {
  const map: Record<string, string> = {}
  let i = 0
  const assign = (g: string) => {
    if (!(g in map)) {
      map[g] = GROUP_PALETTE[i % GROUP_PALETTE.length]
      i++
    }
  }
  for (const g of state.groupOrder ?? []) assign(g)
  // Guard against any guest whose group isn't in groupOrder yet.
  for (const id of state.guestOrder) assign(state.guests[id].group)
  return map
}

const HONORIFICS = new Set(['grandma', 'grandpa', 'aunt', 'uncle', 'cousin', 'dr', 'dr.'])

export function initials(name: string): string {
  const words = name.split(/\s+/).filter((w) => !HONORIFICS.has(w.toLowerCase()))
  const parts = words.length > 0 ? words : name.split(/\s+/)
  const first = parts[0]?.[0] ?? '?'
  const last = parts.length > 1 ? parts[parts.length - 1][0] : ''
  return (first + last).toUpperCase()
}

export function firstName(name: string): string {
  const words = name.split(/\s+/)
  const real = words.filter((w) => !HONORIFICS.has(w.toLowerCase()))
  if (real.length > 0 && real.length < words.length) return `${words[0]} ${real[0]}`
  return words[0] ?? name
}

// ---- guest import parsing --------------------------------------------------

export interface ImportEntry {
  name: string
  group?: string
  dietary?: string[]
  rsvp?: RSVP
  notes?: string
}

export function parseGuestEntries(text: string, defaultGroup?: string): ImportEntry[] {
  const trimmed = text.trim()
  if (trimmed.startsWith('[')) {
    try {
      const arr = JSON.parse(trimmed)
      if (Array.isArray(arr)) {
        return arr
          .map((e) => ({
            name: String(e.name ?? '').trim(),
            group: e.group ? String(e.group) : defaultGroup,
            dietary: Array.isArray(e.dietary) ? e.dietary.map(String) : undefined,
            rsvp: ['yes', 'no', 'pending'].includes(e.rsvp) ? (e.rsvp as RSVP) : undefined,
            notes: e.notes ? String(e.notes) : undefined,
          }))
          .filter((e) => e.name)
      }
    } catch {
      // fall through to line parsing
    }
  }
  const entries: ImportEntry[] = []
  for (const raw of trimmed.split('\n')) {
    const line = raw.replace(/^[\s•*\-\d.]+(?=[A-Za-z])/, '').trim()
    if (!line) continue
    const parts = line.split(/\s+—\s+|\s+\|\s+|\t+| - /).map((p) => p.trim()).filter(Boolean)
    if (!parts[0]) continue
    const entry: ImportEntry = { name: parts[0], group: defaultGroup }
    for (const part of parts.slice(1)) {
      const lower = part.toLowerCase()
      if (['yes', 'no', 'pending'].includes(lower)) entry.rsvp = lower as RSVP
      else if (/vegan|vegetarian|gluten|halal|kosher|allerg|dairy|pescatarian/.test(lower)) {
        entry.dietary = [...(entry.dietary ?? []), ...part.split(',').map((d) => d.trim())]
      } else if (!entry.group || entry.group === defaultGroup) entry.group = part
      else entry.notes = entry.notes ? `${entry.notes}; ${part}` : part
    }
    entries.push(entry)
  }
  return entries
}

// ---- export ----------------------------------------------------------------

export function chartMarkdown(state: AisleState): string {
  const lines: string[] = ['# Seating chart', '']
  for (const tid of state.tableOrder) {
    const t = state.tables[tid]
    const occ = occupantsOf(state, tid)
    lines.push(`## ${t.name} (${occ.length}/${t.seats})`)
    if (occ.length === 0) lines.push('- (empty)')
    for (const gid of occ) {
      const g = state.guests[gid]
      lines.push(`- ${g.name} — ${g.group}${g.dietary.length ? ` · ${g.dietary.join(', ')}` : ''}`)
    }
    lines.push('')
  }
  const unseated = state.guestOrder.filter((id) => !state.seating[id] && state.guests[id].rsvp !== 'no')
  if (unseated.length) {
    lines.push('## Not yet seated')
    for (const id of unseated) lines.push(`- ${state.guests[id].name}`)
    lines.push('')
  }
  const dietary = state.guestOrder.map((id) => state.guests[id]).filter((g) => g.dietary.length > 0 && g.rsvp !== 'no')
  if (dietary.length) {
    lines.push('## Dietary summary')
    for (const g of dietary) lines.push(`- ${g.name}: ${g.dietary.join(', ')}`)
  }
  return lines.join('\n')
}

export function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** Small stable hash for per-chip animation stagger. */
export function hashId(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return Math.abs(h)
}
