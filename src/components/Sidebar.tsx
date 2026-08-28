import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronRight, Plus } from 'lucide-react'
import { useStore } from '../store'
import { groupColors, parseGuestEntries } from '../utils'
import { SPREADSHEET_ACCEPT, SpreadsheetError, readSpreadsheet } from '../import/spreadsheet'
import { constraintStatus, constraintText, findDuplicateRule, zoneLabel, zoneNoun, type RuleDraft } from '../constraints'
import { feetSize, formatFeet, tableSize } from '../geometry'
import type { Constraint, TableShape, VenueFeatureId, ZoneId } from '../types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

// ---- collapsible section shell ---------------------------------------------

function usePersistedOpen(key: string, fallback: boolean) {
  const [open, setOpen] = useState(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw === null ? fallback : raw === '1'
    } catch {
      return fallback
    }
  })
  const set = (v: boolean) => {
    setOpen(v)
    try {
      localStorage.setItem(key, v ? '1' : '0')
    } catch {
      // Preference simply won't stick.
    }
  }
  return [open, set] as const
}

/** Persists a small JSON blob to localStorage, merged over `fallback` so new keys added later still get a default. */
function usePersistedJSON<T extends Record<string, unknown>>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw ? { ...fallback, ...JSON.parse(raw) } : fallback
    } catch {
      return fallback
    }
  })
  const set = (v: T) => {
    setValue(v)
    try {
      localStorage.setItem(key, JSON.stringify(v))
    } catch {
      // Preference simply won't stick.
    }
  }
  return [value, set] as const
}

type SectionId = 'venue' | 'tables' | 'guests' | 'activity' | 'rules'

/** Starting share of the sidebar's leftover height for each section, and the floor it can't be dragged below. */
const DEFAULT_WEIGHTS: Record<SectionId, number> = { venue: 210, tables: 230, guests: 300, activity: 180, rules: 180 }
const MIN_HEIGHTS: Record<SectionId, number> = { venue: 180, tables: 170, guests: 160, activity: 110, rules: 110 }

function Section(props: {
  id: SectionId
  title: string
  count?: ReactNode
  /** Shown in the header row only while the section is collapsed. */
  closedExtra?: ReactNode
  /** Shown at the end of the header row only while the section is open — a real button, sitting outside the collapse trigger. */
  headerAction?: ReactNode
  open: boolean
  onOpenChange: (v: boolean) => void
  /** Height this section never shrinks below, so it can't be squeezed away. */
  minHeight: number
  /** Its share of the leftover height, relative to the other open sections — drag the handle below a section to change it. */
  weight: number
  children: ReactNode
}) {
  const { open } = props
  return (
    <Collapsible
      data-tour={props.id}
      open={open}
      onOpenChange={props.onOpenChange}
      className={cn(
        'flex flex-col',
        // Open sections split the leftover height by weight (basis-0) and never
        // fall below minHeight, so each one scrolls inside itself instead of
        // pushing the sections below it off the bottom. No max-content cap: the
        // whole point of the drag handle is letting the weight win even when a
        // section's own content is short. Collapsed ones stay put.
        open ? 'min-h-0 basis-0 shrink' : 'flex-none',
      )}
      style={open ? { minHeight: props.minHeight, flexGrow: props.weight } : undefined}
    >
      <div className="flex w-full shrink-0 items-center gap-1">
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-2 text-left text-[11.5px] font-bold tracking-[0.12em] text-ink-soft uppercase hover:bg-accent">
          <ChevronRight className={cn('h-3 w-3 shrink-0 transition-transform', open && 'rotate-90')} aria-hidden="true" />
          {props.title}
          {props.count !== undefined && (
            <span className="text-[11px] tracking-wide text-ink-faint">{props.count}</span>
          )}
          {!open && props.closedExtra}
        </CollapsibleTrigger>
        {open && props.headerAction}
      </div>
      <CollapsibleContent className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pb-2 data-open:block">
        {props.children}
      </CollapsibleContent>
    </Collapsible>
  )
}

/** Drag handle between two sections — only live when both are open, since a collapsed section has nothing to give up. */
function ResizeHandle(props: {
  above: SectionId
  below: SectionId
  active: boolean
  weights: Record<SectionId, number>
  setWeights: (w: Record<SectionId, number>) => void
}) {
  const { above, below, active, weights, setWeights } = props
  const onPointerDown = (e: React.PointerEvent) => {
    if (!active) return
    e.preventDefault()
    const startY = e.clientY
    const startAbove = weights[above]
    const startBelow = weights[below]
    const onMove = (ev: PointerEvent) => {
      const dy = ev.clientY - startY
      setWeights({
        ...weights,
        [above]: Math.max(30, startAbove + dy),
        [below]: Math.max(30, startBelow - dy),
      })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }
  return (
    <div
      className={cn('group relative z-10 -my-1.5 h-3 shrink-0 touch-none', active ? 'cursor-row-resize' : 'cursor-default')}
      onPointerDown={onPointerDown}
      role="separator"
      aria-orientation="horizontal"
      aria-label={`Resize ${above} / ${below}`}
    >
      {active && (
        <div className="absolute inset-x-2 top-1/2 h-px -translate-y-1/2 rounded-full bg-hairline transition-colors group-hover:bg-gold" />
      )}
    </div>
  )
}

// ---- venue -----------------------------------------------------------------

const VENUE_FEATURES: { id: VenueFeatureId; glyph: string }[] = [
  { id: 'entrance', glyph: '↳' },
  { id: 'dance_floor', glyph: '✦' },
  { id: 'band', glyph: '♪' },
  { id: 'bathroom', glyph: 'WC' },
  { id: 'photo_booth', glyph: '▣' },
  { id: 'bar', glyph: '◒' },
  { id: 'buffet', glyph: '≋' },
  { id: 'cake_table', glyph: '♢' },
  { id: 'gift_table', glyph: '♥' },
]

function DimensionInput(props: { label: string; value: number; min: number; max: number; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState(String(props.value))
  useEffect(() => setDraft(String(props.value)), [props.value])
  useEffect(() => {
    const value = Number(draft)
    if (!Number.isFinite(value) || value === props.value) return
    const timer = window.setTimeout(() => props.onCommit(value), 320)
    return () => window.clearTimeout(timer)
  }, [draft, props.value, props.onCommit])

  const commit = () => {
    const value = Number(draft)
    if (Number.isFinite(value)) props.onCommit(value)
    else setDraft(String(props.value))
  }

  return (
    <label className="text-[9.5px] font-semibold tracking-wide text-ink-soft uppercase">
      {props.label}
      <Input
        className="mt-1 h-7 bg-ivory px-2 text-[11px]"
        type="number"
        min={props.min}
        max={props.max}
        step={0.5}
        value={draft}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
      />
    </label>
  )
}

function VenueSection() {
  const s = useStore()

  return (
    <div className="space-y-2 pt-1">
      <div className="rounded-lg border border-hairline bg-parchment/45 p-2">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <span className="text-[10px] font-bold tracking-[0.13em] text-ink-soft uppercase">Room size</span>
          <span className="text-[10px] text-ink-faint">
            {formatFeet(s.venueDimensions.widthFt)} × {formatFeet(s.venueDimensions.lengthFt)}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <DimensionInput label="Width (ft)" value={s.venueDimensions.widthFt} min={20} max={300} onCommit={(value) => s.updateVenueDimensions({ widthFt: value })} />
          <DimensionInput label="Length (ft)" value={s.venueDimensions.lengthFt} min={15} max={200} onCommit={(value) => s.updateVenueDimensions({ lengthFt: value })} />
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <label className="text-[9.5px] font-semibold tracking-wide text-ink-soft uppercase" htmlFor="venue-snap">
            Snap grid
          </label>
          <Select
            value={String(s.venueDimensions.snapFt)}
            onValueChange={(value) => s.updateVenueDimensions({ snapFt: Number(value) })}
          >
            <SelectTrigger id="venue-snap" className="h-7 w-[92px] bg-ivory px-2 text-[10.5px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">Off</SelectItem>
              <SelectItem value="0.5">6 inches</SelectItem>
              <SelectItem value="1">1 foot</SelectItem>
              <SelectItem value="2">2 feet</SelectItem>
              <SelectItem value="5">5 feet</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <p className="px-1 text-[10.5px] leading-snug text-ink-soft">
        Resizing the room adds floor space — furniture stays put. Drag the room's walls to resize it · drag the empty floor to pan · pinch or ⌘-scroll to zoom · Alt moves freely · Shift-click selects a group.
      </p>

      <div className="grid grid-cols-1 gap-1">
        {VENUE_FEATURES.map(({ id, glyph }) => {
          const feature = s.venue[id]
          const dimensions = feetSize(feature.w, feature.h, s.venueDimensions)
          return (
            <div key={id} className="flex items-center gap-2 rounded-md border bg-parchment/55 px-2 py-1.5">
              <span
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-pine-900 text-[10px] font-bold text-gold-bright"
                aria-hidden="true"
              >
                {glyph}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11.5px] font-semibold">{feature.label}</span>
                {feature.enabled && (
                  <span className="block truncate text-[9.5px] text-ink-faint">
                    {formatFeet(dimensions.w)} × {formatFeet(dimensions.h)} · {Math.round(feature.rotation)}°
                  </span>
                )}
              </span>
              <Button
                variant={feature.enabled ? 'outline' : 'ghost'}
                size="xs"
                aria-pressed={feature.enabled}
                aria-label={`${feature.enabled ? 'Hide' : 'Show'} ${feature.label}`}
                onClick={() => {
                  s.updateVenueFeature(id, { enabled: !feature.enabled })
                  s.logActivity('venue', `${feature.enabled ? 'Hid' : 'Added'} ${feature.label}.`, 'you')
                }}
              >
                {feature.enabled ? 'Shown' : 'Add'}
              </Button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---- tables -----------------------------------------------------------------

const TABLE_SHAPE_ITEMS = [
  { value: 'round', label: 'Round' },
  { value: 'rect', label: 'Banquet' },
]

/**
 * Where tables get added by hand. The composer holds the shape and seat count
 * you keep reaching for, so adding a room's worth is one repeated click, and
 * the store finds each new table a clear patch of floor.
 */
function TablesSection() {
  const s = useStore()
  const [shape, setShape] = useState<TableShape>('round')
  const [seats, setSeats] = useState(8)

  const attending = s.guestOrder.filter((id) => s.guests[id].rsvp !== 'no').length
  const capacity = s.tableOrder.reduce((sum, id) => sum + s.tables[id].seats, 0)
  const shortfall = Math.max(0, attending - capacity)

  const shapeWord = shape === 'round' ? 'round' : 'banquet'

  const add = () => {
    const table = s.addTable({ shape, seats })
    s.logActivity('add table', `Added ${table.name} (${shapeWord}, ${table.seats} seats).`, 'you')
  }

  /** Enough tables to seat everyone still short of a chair, as one undoable step. */
  const addForShortfall = () => {
    const needed = Math.ceil(shortfall / seats)
    s.snapshot('add tables')
    for (let i = 0; i < needed; i++) s.addTable({ shape, seats }, { snapshot: false })
    s.logActivity(
      'add table',
      `Added ${needed} ${shapeWord} table${needed === 1 ? '' : 's'} to seat everyone.`,
      'you',
    )
    s.setToast(`Added ${needed} table${needed === 1 ? '' : 's'}.`)
  }

  return (
    <>
      <div className="sticky top-0 z-10 -mx-1 mb-1 bg-ivory px-1 pt-1 pb-2">
        <div className="flex flex-col gap-1.5 rounded-lg border bg-parchment/70 p-2">
          <div className="flex items-center gap-1.5">
            <span className="shrink-0 pl-0.5 text-[10.5px] font-bold tracking-[0.1em] text-ink-soft uppercase">
              Shape
            </span>
            <Select
              items={TABLE_SHAPE_ITEMS}
              value={shape}
              onValueChange={(v) => v !== null && setShape(v as TableShape)}
            >
              <SelectTrigger className="min-w-0 flex-1" size="sm" aria-label="Shape for the new table">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TABLE_SHAPE_ITEMS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="shrink-0 pl-0.5 text-[10.5px] font-bold tracking-[0.1em] text-ink-soft uppercase">
              Seats
            </span>
            <div className="flex flex-1 items-center justify-end gap-2">
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="One seat fewer"
                disabled={seats <= 2}
                onClick={() => setSeats((n) => Math.max(2, n - 1))}
              >
                −
              </Button>
              <span className="min-w-5 text-center text-[13px] font-bold">{seats}</span>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="One seat more"
                disabled={seats >= 16}
                onClick={() => setSeats((n) => Math.min(16, n + 1))}
              >
                +
              </Button>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={add}>
            <Plus className="h-3 w-3 shrink-0" aria-hidden="true" />
            Add Table
          </Button>
          {shortfall > 0 && (
            <Button variant="ghost" size="xs" onClick={addForShortfall}>
              {shortfall} guest{shortfall === 1 ? '' : 's'} without a seat — add {Math.ceil(shortfall / seats)} more
            </Button>
          )}
        </div>
        {s.tableOrder.length > 0 && (
          <p className="mt-1.5 px-1 text-xs font-bold">
            <span className={cn(shortfall > 0 ? 'text-brick' : 'text-sage')}>
              {capacity} seat{capacity === 1 ? '' : 's'}
            </span>
            <span className="text-ink-faint"> · {attending} attending</span>
          </p>
        )}
      </div>
      {s.tableOrder.length === 0 && (
        <p className="my-1.5 px-1 text-[12.5px] text-ink-soft">
          No tables yet. Add one above — or ask your agent for “ten rounds of eight”.
        </p>
      )}
      {s.tableOrder.map((id) => {
        const t = s.tables[id]
        const occ = Object.values(s.seating).filter((a) => a.tableId === id).length
        const footprint = tableSize(t, s.venueDimensions)
        const size = feetSize(footprint.w, footprint.h, s.venueDimensions)
        return (
          <div key={id} className="group flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-accent">
            <button
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
              onClick={(e) => s.setSelection({ kind: 'table', id, at: { x: e.clientX + 12, y: e.clientY - 10 } })}
            >
              <span
                className={cn(
                  'h-3 w-3 shrink-0 border border-ink-faint',
                  t.shape === 'round' ? 'rounded-full' : 'rounded-[2px]',
                )}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{t.name}</span>
              <span className="text-[10px] whitespace-nowrap text-ink-faint">
                {formatFeet(size.w)} × {formatFeet(size.h)}
              </span>
              <span className={cn('text-[11px] whitespace-nowrap', occ > t.seats ? 'text-brick' : 'text-ink-faint')}>
                {occ}/{t.seats}
              </span>
            </button>
            <button
              className="shrink-0 px-1 text-[15px] leading-none text-ink-faint opacity-0 group-hover:opacity-100 hover:text-brick"
              title={`Remove ${t.name}`}
              aria-label={`Remove ${t.name}`}
              onClick={() => {
                s.logActivity('remove table', `Removed ${t.name}.`, 'you')
                s.removeTable(id)
              }}
            >
              ×
            </button>
          </div>
        )
      })}
    </>
  )
}

// ---- guests ----------------------------------------------------------------

function GroupBlock(props: {
  name: string
  color: string
  ids: string[]
  seatedTotal: number
  attendingTotal: number
  removable: boolean
  children: ReactNode
}) {
  const s = useStore()
  const [open, setOpen] = usePersistedOpen(`aisle:group:${props.name}`, true)
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mb-1">
      <div className="group mt-2 mb-0.5 flex items-center gap-1.5 px-1">
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-0.5 text-left text-[11px] font-bold tracking-[0.12em] text-ink-soft uppercase hover:bg-parchment">
          <ChevronRight className={cn('h-3 w-3 shrink-0 transition-transform', open && 'rotate-90')} aria-hidden="true" />
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: props.color }} />
          <span className="truncate">{props.name}</span>
          <span className="ml-auto shrink-0 tracking-normal">
            {props.seatedTotal}/{props.attendingTotal}
          </span>
        </CollapsibleTrigger>
        {props.removable && (
          <button
            className="shrink-0 px-1 text-[13px] leading-none text-ink-faint opacity-0 group-hover:opacity-100 hover:text-brick"
            title={`Remove empty group "${props.name}"`}
            aria-label={`Remove empty group ${props.name}`}
            onClick={() => {
              s.logActivity('remove group', `Removed empty group "${props.name}".`, 'you')
              s.removeGroup(props.name)
            }}
          >
            ×
          </button>
        )}
      </div>
      <CollapsibleContent>{props.children}</CollapsibleContent>
    </Collapsible>
  )
}

/**
 * The one place a group gets named — opened either from the composer's group
 * picker or from the “New group” row at the foot of the list.
 */
function NewGroupRow(props: { onCreated?: (name: string) => void; onClose: () => void }) {
  const s = useStore()
  const [name, setName] = useState('')
  const submit = () => {
    const added = s.addGroup(name)
    if (!added) return
    s.logActivity('add group', `Added group "${added}".`, 'you')
    props.onCreated?.(added)
    props.onClose()
  }
  return (
    <div className="flex gap-1.5">
      <Input
        autoFocus
        placeholder="New group name…"
        aria-label="New group name"
        className="min-w-0 flex-1"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
          if (e.key === 'Escape') props.onClose()
        }}
      />
      <Button variant="outline" size="sm" onClick={submit} disabled={!name.trim()}>
        Create
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Cancel new group" onClick={props.onClose}>
        ×
      </Button>
    </div>
  )
}

function GuestsSection() {
  const s = useStore()
  const [query, setQuery] = useState('')
  const [name, setName] = useState('')
  const [group, setGroup] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [importText, setImportText] = useState('')
  const [showNewGroup, setShowNewGroup] = useState(false)
  const [showListGroup, setShowListGroup] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const NEW_GROUP = '__new_group__'

  const colors = useMemo(() => groupColors(s), [s.guests, s.guestOrder, s.groupOrder])

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase()
    const out = new Map<string, string[]>()
    for (const grp of s.groupOrder) out.set(grp, [])
    for (const id of s.guestOrder) {
      const g = s.guests[id]
      if (!out.has(g.group)) out.set(g.group, [])
      out.get(g.group)!.push(id)
    }
    if (!q) return out
    const filtered = new Map<string, string[]>()
    for (const [grp, ids] of out) {
      if (grp.toLowerCase().includes(q)) {
        filtered.set(grp, ids)
        continue
      }
      const matches = ids.filter((id) => s.guests[id].name.toLowerCase().includes(q))
      if (matches.length > 0) filtered.set(grp, matches)
    }
    return filtered
  }, [s.guests, s.guestOrder, s.groupOrder, query])

  // A brand-new chart has no groups yet, so offer the default the store uses.
  const groupChoices = s.groupOrder.length > 0 ? s.groupOrder : ['Guests']
  // Survives the chosen group being renamed or removed out from under us.
  const activeGroup = groupChoices.includes(group) ? group : groupChoices[0]

  const submitGuest = () => {
    if (!name.trim()) return
    const guest = s.addGuest({ name: name.trim(), group: activeGroup })
    s.logActivity('add guest', `Added ${guest.name} (${guest.group}).`, 'you')
    setName('')
  }

  const runImport = () => {
    const entries = parseGuestEntries(importText)
    if (entries.length === 0) {
      s.setToast('No guest names found in that text.')
      return
    }
    const added = s.importGuests(entries)
    s.setToast(`Imported ${added.length} guest${added.length === 1 ? '' : 's'}.`)
    s.logActivity('import guests', `Imported ${added.length} guest${added.length === 1 ? '' : 's'} from a pasted list.`, 'you')
    setImportText('')
    setShowImport(false)
  }

  // A spreadsheet is where guest lists actually live, so the file goes
  // straight in: the sheet's own header row decides which column is which,
  // and the composer's group only fills in rows that name none.
  const runFileImport = async (file: File) => {
    try {
      const sheet = await readSpreadsheet(file, activeGroup)
      if (sheet.entries.length === 0) {
        s.setToast(`No guest names found in ${file.name}.`)
        return
      }
      const added = s.importGuests(sheet.entries)
      const skipped = sheet.entries.length - added.length
      const detail = skipped > 0 ? ` (${skipped} already on the list)` : ''
      s.setToast(`Imported ${added.length} guest${added.length === 1 ? '' : 's'} from ${file.name}${detail}.`)
      s.logActivity(
        'import guests',
        `Imported ${added.length} guest${added.length === 1 ? '' : 's'} from ${file.name}${detail}.`,
        'you',
      )
    } catch (error) {
      s.setToast(error instanceof SpreadsheetError ? error.message : `${file.name} could not be imported.`)
    }
  }

  return (
    <>
      {/* Pinned: the composer and the search box stay put while the list under
          them scrolls. Kept compact so the list still gets most of the room. */}
      <div className="sticky top-0 z-10 -mx-1 mb-1 bg-ivory px-1 pt-1 pb-2">
      <div className="flex flex-col gap-1.5 rounded-lg border bg-parchment/70 p-2">
        <div className="flex gap-1.5">
          <Input
            placeholder="Add a guest…"
            aria-label="Guest name"
            className="min-w-0 flex-1"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitGuest()}
          />
          <Button variant="outline" size="sm" onClick={submitGuest} disabled={!name.trim()}>
            Add
          </Button>
        </div>
        {/* The group belongs to the guest you're adding, so it rides along in
            the same card — and creating one happens right here, in place. */}
        <div className="flex items-center gap-1.5">
          <span className="shrink-0 pl-0.5 text-[10.5px] font-bold tracking-[0.1em] text-ink-soft uppercase">
            Group
          </span>
          <Select
            value={activeGroup}
            onValueChange={(v) => {
              if (v === NEW_GROUP) setShowNewGroup(true)
              else if (v) setGroup(v)
            }}
          >
            <SelectTrigger className="min-w-0 flex-1" size="sm" aria-label="Group for the new guest">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {groupChoices.map((g) => (
                <SelectItem key={g} value={g}>
                  {g}
                </SelectItem>
              ))}
              <SelectSeparator />
              <SelectItem value={NEW_GROUP}>＋ New group…</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {showNewGroup && (
          <NewGroupRow onCreated={(g) => setGroup(g)} onClose={() => setShowNewGroup(false)} />
        )}
        <div className="flex flex-col gap-0.5">
          <Button variant="ghost" size="xs" onClick={() => fileRef.current?.click()}>
            Import a Spreadsheet…
          </Button>
          <Button variant="ghost" size="xs" onClick={() => setShowImport((v) => !v)}>
            {showImport ? 'Hide Paste Box' : 'Paste a List…'}
          </Button>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            accept={SPREADSHEET_ACCEPT}
            aria-label="Guest list spreadsheet"
            onChange={(e) => {
              const file = e.target.files?.[0]
              // Reset first, so picking the same file twice still fires.
              e.target.value = ''
              if (file) void runFileImport(file)
            }}
          />
        </div>
        {showImport && (
          <div className="flex flex-col gap-1.5">
            <Textarea
              className="min-h-[100px] text-xs"
              placeholder={'One guest per line:\nNora Flynn — Childhood friends\nRaj Iyer — Work friends — gluten-free'}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
            />
            <Button variant="outline" size="sm" onClick={runImport}>
              Import
            </Button>
          </div>
        )}
      </div>
      <Input
        className="mt-1.5"
        placeholder="Search guests…"
        aria-label="Search guests"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      </div>
      {[...grouped.entries()].map(([groupName, ids]) => (
        <GroupBlock
          key={groupName}
          name={groupName}
          color={colors[groupName]}
          ids={ids}
          seatedTotal={ids.filter((id) => s.seating[id]).length}
          attendingTotal={ids.filter((id) => s.guests[id].rsvp !== 'no').length}
          removable={ids.length === 0}
        >
          {ids.length === 0 && (
            <p className="px-1 pb-1 text-[11.5px] text-ink-faint italic">No guests yet.</p>
          )}
          {ids.map((id) => {
            const g = s.guests[id]
            const seat = s.seating[id]
            return (
              <button
                key={id}
                className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-accent"
                onClick={(e) => s.setSelection({ kind: 'guest', id, at: { x: e.clientX + 12, y: e.clientY - 10 } })}
              >
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate text-[13px] font-semibold',
                    g.rsvp === 'no' && 'line-through opacity-55',
                  )}
                >
                  {g.name}
                </span>
                {g.rsvp === 'pending' && (
                  <span className="rounded-full bg-secondary px-1.5 text-[10px] font-bold whitespace-nowrap text-ink-soft">
                    rsvp?
                  </span>
                )}
                {g.dietary.length > 0 && (
                  <span className="rounded-full bg-sage/15 px-1.5 text-[10px] font-bold whitespace-nowrap text-sage">
                    {g.dietary[0].split(' ')[0]}
                  </span>
                )}
                <span
                  className={cn('text-[11px] whitespace-nowrap text-ink-faint', !seat && g.rsvp !== 'no' && 'italic')}
                >
                  {g.rsvp === 'no' ? '—' : seat ? s.tables[seat.tableId]?.name.replace('Table ', 'T') : 'lounge'}
                </span>
              </button>
            )
          })}
        </GroupBlock>
      ))}
      {/* A group can also be started from where you're actually looking at
          them — the foot of the list, in place, no dialog. */}
      {!query.trim() &&
        (showListGroup ? (
          <div className="mt-2 px-1">
            <NewGroupRow onClose={() => setShowListGroup(false)} />
          </div>
        ) : (
          <button
            className="mt-2 flex w-full items-center gap-2 rounded-md border border-dashed border-hairline px-2 py-1.5 text-[11px] font-bold tracking-[0.12em] text-ink-soft uppercase hover:border-sage hover:bg-accent hover:text-primary"
            onClick={() => setShowListGroup(true)}
          >
            <Plus className="h-3 w-3 shrink-0" aria-hidden="true" />
            New group
          </button>
        ))}
      {s.guestOrder.length === 0 && (
        <p className="my-1.5 px-1 text-[12.5px] text-ink-soft">
          The list is empty. Add guests above, paste a list, or press <b>Load Sample Wedding</b> to see Aisle at work.
        </p>
      )}
    </>
  )
}

// ---- activity ---------------------------------------------------------------

function timeAgo(t: number): string {
  const sec = Math.max(0, Math.round((Date.now() - t) / 1000))
  if (sec < 5) return 'just now'
  if (sec < 60) return `${sec}s ago`
  const min = Math.round(sec / 60)
  return min < 60 ? `${min}m ago` : `${Math.round(min / 60)}h ago`
}

function ActivitySection() {
  const s = useStore()
  return (
    <>
      {s.agentLog.length === 0 && (
        <p className="my-1.5 px-1 text-[12.5px] text-ink-soft">
          Every step lands here — yours and your agent's. Seat someone, or ask your agent to arrange the room.
        </p>
      )}
      {/* A quiet ledger rather than a stack of cards: hairline rail, a marker
          per entry (gold = agent, open = you), the sentence itself as the
          content, and one faint who·when line beneath. */}
      <div className="ml-[5px] flex flex-col border-l border-ink-faint/25 pr-0.5">
        {s.agentLog.map((e) => (
          <div key={e.id} className="animate-in fade-in slide-in-from-top-1 relative py-[5px] pl-3.5">
            <span
              aria-hidden="true"
              className={cn(
                'absolute top-[10px] -left-[4px] h-[7px] w-[7px] rounded-full border',
                e.source === 'you' ? 'border-ink-faint bg-parchment' : 'border-gold-ink/60 bg-gold',
              )}
            />
            <div className="text-[12.5px] leading-snug text-ink">{e.summary}</div>
            <div className="mt-px text-[10.5px] text-ink-faint">
              {e.source === 'you' ? 'You' : 'Agent'} · {timeAgo(e.time)}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

// ---- house rules ------------------------------------------------------------

const ZONES: ZoneId[] = ['dance_floor', 'band', 'entrance']

// items props let SelectValue show these labels without the popup ever opening.
const VERB_ITEMS = [
  { value: 'keep', label: 'Keep' },
  { value: 'seat', label: 'Seat' },
]
const PAIR_ITEMS = [
  { value: 'together', label: 'together' },
  { value: 'apart', label: 'apart' },
]
const PREFERENCE_ITEMS = [
  { value: 'near', label: 'near' },
  { value: 'far', label: 'away from' },
]

function GuestPicker(props: {
  value: string
  onChange: (id: string) => void
  placeholder: string
  exclude?: string
}) {
  const s = useStore()
  const items = s.guestOrder
    .filter((id) => id !== props.exclude)
    .map((id) => ({ value: id, label: s.guests[id].name }))
  const selected = items.find((i) => i.value === props.value) ?? null
  return (
    <Combobox items={items} value={selected} onValueChange={(item) => props.onChange(item?.value ?? '')}>
      <ComboboxInput size="sm" placeholder={props.placeholder} aria-label={props.placeholder} />
      <ComboboxContent>
        <ComboboxEmpty>No guest matches.</ComboboxEmpty>
        <ComboboxList>
          {(item: { value: string; label: string }) => (
            <ComboboxItem key={item.value} value={item}>
              {item.label}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}

/** The composer builds the rule as the sentence it will become:
 *  "Keep [A] and [B] [together]" / "Seat [A] [near] [the dance floor]". */
function AddRule() {
  const s = useStore()
  const [verb, setVerb] = useState<'keep' | 'seat'>('keep')
  const [pairKind, setPairKind] = useState<'together' | 'apart'>('together')
  const [preference, setPreference] = useState<'near' | 'far'>('near')
  const [zone, setZone] = useState<ZoneId>('dance_floor')
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [note, setNote] = useState('')

  const isPair = verb === 'keep'
  const complete = isPair ? Boolean(a && b && a !== b) : Boolean(a)
  const candidate: RuleDraft | null = !complete
    ? null
    : isPair
      ? { type: pairKind, a, b }
      : { type: 'zone', guestId: a, zone, preference }
  const dup = candidate ? findDuplicateRule(s, candidate) : undefined
  const zoneHidden = !isPair && !s.venue[zone]?.enabled

  const add = () => {
    if (!candidate || dup || zoneHidden) return
    const added = s.addConstraint({ ...candidate, note: note.trim() || undefined })
    s.logActivity('add rule', `Added rule: ${constraintText(s, added)}.`, 'you')
    setA('')
    setB('')
    setNote('')
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border bg-parchment/70 p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Select items={VERB_ITEMS} value={verb} onValueChange={(v) => v !== null && setVerb(v as 'keep' | 'seat')}>
          <SelectTrigger size="sm" className="shrink-0" aria-label="Kind of rule">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {VERB_ITEMS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="min-w-[120px] flex-1">
          <GuestPicker value={a} onChange={setA} placeholder="a guest…" exclude={isPair ? b : undefined} />
        </div>
        {isPair ? (
          <>
            <span className="text-[12.5px] text-ink-soft">and</span>
            <div className="min-w-[120px] flex-1">
              <GuestPicker value={b} onChange={setB} placeholder="another guest…" exclude={a} />
            </div>
            <Select items={PAIR_ITEMS} value={pairKind} onValueChange={(v) => v !== null && setPairKind(v as 'together' | 'apart')}>
              <SelectTrigger size="sm" className="shrink-0" aria-label="Together or apart">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAIR_ITEMS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        ) : (
          <>
            <Select items={PREFERENCE_ITEMS} value={preference} onValueChange={(v) => v !== null && setPreference(v as 'near' | 'far')}>
              <SelectTrigger size="sm" className="shrink-0" aria-label="Near or away from">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PREFERENCE_ITEMS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              items={ZONES.map((z) => ({ value: z, label: zoneNoun(z) }))}
              value={zone}
              onValueChange={(v) => v !== null && setZone(v as ZoneId)}
            >
              <SelectTrigger size="sm" className="min-w-0 flex-1" aria-label="Which spot">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ZONES.map((z) => (
                  <SelectItem key={z} value={z}>
                    {zoneNoun(z)}
                    {!s.venue[z]?.enabled && ' (hidden)'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}
      </div>
      <Input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Why? e.g. “recently divorced” (optional)"
        aria-label="Why this rule exists (optional)"
        className="h-7 text-[12.5px]"
      />
      {dup && (
        <p className="px-0.5 text-[11.5px] text-brick">Already a rule: “{constraintText(s, dup)}”.</p>
      )}
      {zoneHidden && !dup && (
        <p className="px-0.5 text-[11.5px] text-ink-soft">
          {zoneLabel(zone)} is hidden on the floor plan — show it in the Venue section first.
        </p>
      )}
      <Button variant="outline" size="sm" onClick={add} disabled={!complete || !!dup || zoneHidden}>
        Add Rule
      </Button>
    </div>
  )
}

function RulesSection() {
  const s = useStore()
  const counts = { ok: 0, violated: 0, pending: 0 }
  for (const c of s.constraints) counts[constraintStatus(s, c)]++

  // Broken rules surface first, then ones waiting on seats, then kept ones.
  const STATUS_ORDER = { violated: 0, pending: 1, ok: 2 }
  const sorted = [...s.constraints].sort(
    (x, y) => STATUS_ORDER[constraintStatus(s, x)] - STATUS_ORDER[constraintStatus(s, y)],
  )

  const highlight = (c: Constraint) =>
    s.setRuleHighlight(
      c.type === 'zone' ? { guestIds: [c.guestId], zone: c.zone } : { guestIds: [c.a, c.b], zone: null },
    )
  // Don't leave a spotlight stuck on the canvas when the section collapses mid-hover.
  useEffect(() => () => useStore.getState().setRuleHighlight(null), [])

  return (
    <>
      {/* Pinned like the guest composer, so the form stays reachable however
          long the rule list gets. */}
      <div className="sticky top-0 z-10 -mx-1 mb-1 bg-ivory px-1 pt-1 pb-2">
        <AddRule />
        {s.constraints.length > 0 && (
          <p className="mt-1.5 px-1 text-xs font-bold">
            <span className="text-sage">{counts.ok} kept</span>
            {counts.violated > 0 && <span className="text-brick"> · {counts.violated} broken</span>}
            {counts.pending > 0 && <span className="text-ink-faint"> · {counts.pending} waiting on seats</span>}
          </p>
        )}
      </div>
      {s.constraints.length === 0 && (
        <p className="my-1.5 px-1 text-[12.5px] text-ink-soft">
          Rules like “keep the exes apart” live here — add one above, or just tell your agent.
        </p>
      )}
      {sorted.map((c) => {
        const status = constraintStatus(s, c)
        const statusText = status === 'ok' ? 'kept' : status === 'violated' ? 'broken' : 'waiting — someone is unseated'
        return (
          <div
            key={c.id}
            className="flex items-start gap-2 rounded-md px-1.5 py-1.5 hover:bg-accent"
            onPointerEnter={() => highlight(c)}
            onPointerLeave={() => s.setRuleHighlight(null)}
            onFocusCapture={() => highlight(c)}
            onBlurCapture={() => s.setRuleHighlight(null)}
          >
            <span
              className={cn(
                'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                status === 'ok' && 'bg-ok',
                status === 'violated' && 'bg-brick ring-[3px] ring-brick/25',
                status === 'pending' && 'bg-ink-faint',
              )}
              title={statusText}
              aria-label={statusText}
              role="img"
            />
            <span className="flex-1 text-[12.5px]">
              {constraintText(s, c)}
              {c.note && <span className="block text-[11.5px] text-ink-faint italic">{c.note}</span>}
            </span>
            <button
              className="px-1 text-[15px] leading-tight text-ink-faint hover:text-brick"
              title="Remove rule"
              aria-label={`Remove rule: ${constraintText(s, c)}`}
              onClick={() => {
                s.logActivity('remove rule', `Removed rule: ${constraintText(s, c)}.`, 'you')
                s.removeConstraint(c.id)
              }}
            >
              ×
            </button>
          </div>
        )
      })}
    </>
  )
}

// ---- the sidebar ------------------------------------------------------------

export function Sidebar() {
  const s = useStore()
  const brokenCount = s.constraints.filter((c) => constraintStatus(s, c) === 'violated').length

  const [open, setOpenMap] = usePersistedJSON<Record<SectionId, boolean>>('aisle:sidebar:open', {
    venue: true,
    tables: true,
    guests: true,
    activity: true,
    rules: false,
  })
  const setOpen = (id: SectionId, v: boolean) => setOpenMap({ ...open, [id]: v })

  // A drag (or agent move) that breaks a rule pops the section open, so the
  // cause of the new warning is on screen next to its effect.
  const prevBroken = useRef(brokenCount)
  useEffect(() => {
    if (brokenCount > prevBroken.current && !open.rules) setOpen('rules', true)
    prevBroken.current = brokenCount
  })

  const [weights, setWeights] = usePersistedJSON<Record<SectionId, number>>('aisle:sidebar:weights', DEFAULT_WEIGHTS)

  return (
    <aside className="hidden min-h-0 flex-col overflow-hidden border-r border-hairline bg-ivory px-2 pt-1 pb-2 md:flex">
      <Section
        id="venue"
        title="Venue"
        count={`${Object.values(s.venue).filter((feature) => feature.enabled).length}/${VENUE_FEATURES.length}`}
        open={open.venue}
        onOpenChange={(v) => setOpen('venue', v)}
        minHeight={MIN_HEIGHTS.venue}
        weight={weights.venue}
      >
        <VenueSection />
      </Section>
      <ResizeHandle above="venue" below="tables" active={open.venue && open.tables} weights={weights} setWeights={setWeights} />
      <Section
        id="tables"
        title="Tables"
        count={s.tableOrder.length}
        open={open.tables}
        onOpenChange={(v) => setOpen('tables', v)}
        minHeight={MIN_HEIGHTS.tables}
        weight={weights.tables}
      >
        <TablesSection />
      </Section>
      <ResizeHandle above="tables" below="guests" active={open.tables && open.guests} weights={weights} setWeights={setWeights} />
      <Section
        id="guests"
        title="Guests"
        count={s.guestOrder.length}
        open={open.guests}
        onOpenChange={(v) => setOpen('guests', v)}
        minHeight={MIN_HEIGHTS.guests}
        weight={weights.guests}
      >
        <GuestsSection />
      </Section>
      <ResizeHandle above="guests" below="activity" active={open.guests && open.activity} weights={weights} setWeights={setWeights} />
      <Section
        id="activity"
        title="Activity"
        count={s.agentLog.length > 0 ? `${s.agentLog.length} steps` : undefined}
        open={open.activity}
        onOpenChange={(v) => setOpen('activity', v)}
        minHeight={MIN_HEIGHTS.activity}
        weight={weights.activity}
        headerAction={
          s.agentLog.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0"
              onClick={() => {
                s.clearActivity()
                s.setToast('Activity cleared.')
              }}
            >
              Clear
            </Button>
          )
        }
      >
        <ActivitySection />
      </Section>
      <ResizeHandle above="activity" below="rules" active={open.activity && open.rules} weights={weights} setWeights={setWeights} />
      <Section
        id="rules"
        title="House rules"
        count={s.constraints.length}
        open={open.rules}
        onOpenChange={(v) => setOpen('rules', v)}
        minHeight={MIN_HEIGHTS.rules}
        weight={weights.rules}
        closedExtra={brokenCount > 0 ? <span className="text-[11px] text-brick">· {brokenCount} broken</span> : undefined}
      >
        <RulesSection />
      </Section>
    </aside>
  )
}
