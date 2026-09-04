import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronRight, History, MapPin, Plus, ShieldCheck, Table2, Users, type LucideIcon } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { selectCore, useStore } from '../store'
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

type SectionId = 'venue' | 'tables' | 'guests' | 'activity' | 'rules'

type SectionDefinition = {
  id: SectionId
  title: string
  icon: LucideIcon
}

const SECTIONS: SectionDefinition[] = [
  { id: 'venue', title: 'Venue', icon: MapPin },
  { id: 'tables', title: 'Tables', icon: Table2 },
  { id: 'guests', title: 'Guests', icon: Users },
  { id: 'rules', title: 'House rules', icon: ShieldCheck },
  { id: 'activity', title: 'Activity', icon: History },
]

const PRIMARY_SECTIONS = SECTIONS.filter((section) => section.id !== 'activity')
const ACTIVITY_SECTION = SECTIONS.find((section) => section.id === 'activity')!

function usePersistedSection(key: string, fallback: SectionId) {
  const [section, setSection] = useState<SectionId>(() => {
    try {
      const raw = localStorage.getItem(key) as SectionId | null
      return SECTIONS.some(({ id }) => id === raw) ? raw! : fallback
    } catch {
      return fallback
    }
  })
  const set = (next: SectionId) => {
    setSection(next)
    try {
      localStorage.setItem(key, next)
    } catch {
      // Preference simply won't stick.
    }
  }
  return [section, set] as const
}

/** Keeps each section quiet until the user chooses to add something, then
 * reveals the existing inline composer without taking them out of context. */
function InlineAddPanel(props: {
  buttonLabel: string
  title: string
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
}) {
  const panelId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(false)

  useEffect(() => {
    if (props.open) {
      const panel = panelRef.current
      const target = panel?.querySelector<HTMLElement>('[data-add-autofocus]')
        ?? panel?.querySelector<HTMLElement>('input:not([type="hidden"]), button:not([disabled])')
      target?.focus()
    } else if (wasOpen.current) {
      triggerRef.current?.focus()
    }
    wasOpen.current = props.open
  }, [props.open])

  if (!props.open) {
    return (
      <Button
        ref={triggerRef}
        variant="outline"
        size="sm"
        className="w-full"
        aria-expanded={false}
        aria-controls={panelId}
        onClick={() => props.onOpenChange(true)}
      >
        <Plus data-icon="inline-start" aria-hidden="true" />
        {props.buttonLabel}
      </Button>
    )
  }

  return (
    <div
      ref={panelRef}
      id={panelId}
      className="flex flex-col gap-1.5 rounded-md bg-parchment/70 p-2"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="smallcaps pl-0.5 text-[13.5px] text-ink-soft">
          {props.title}
        </span>
        <Button variant="ghost" size="xs" onClick={() => props.onOpenChange(false)}>
          Done
        </Button>
      </div>
      {props.children}
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
    <label className="smallcaps text-[13px] text-ink-soft">
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
  const s = useStore(useShallow((state) => ({
    venue: state.venue,
    venueDimensions: state.venueDimensions,
    updateVenueDimensions: state.updateVenueDimensions,
    updateVenueFeature: state.updateVenueFeature,
    logActivity: state.logActivity,
  })))
  const [addingFeature, setAddingFeature] = useState(false)
  const [roomSettingsOpen, setRoomSettingsOpen] = useState(false)
  const enabledFeatures = VENUE_FEATURES.filter(({ id }) => s.venue[id].enabled)
  const availableFeatures = VENUE_FEATURES.filter(({ id }) => !s.venue[id].enabled)

  return (
    <div className="flex flex-col gap-2 pt-1">
      <Collapsible open={roomSettingsOpen} onOpenChange={setRoomSettingsOpen}>
        <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md bg-parchment/45 px-2.5 py-2 text-left hover:bg-accent">
          <span className="min-w-0 flex-1">
            <span className="smallcaps block text-[13.5px] text-ink-soft">Room settings</span>
            <span className="figures block truncate text-[11.5px] text-ink-faint">
              {formatFeet(s.venueDimensions.widthFt)} × {formatFeet(s.venueDimensions.lengthFt)} · {s.venueDimensions.snapFt === 0 ? 'grid off' : `${formatFeet(s.venueDimensions.snapFt)} grid`}
            </span>
          </span>
          <ChevronRight
            className={cn('size-3.5 shrink-0 text-ink-faint transition-transform', roomSettingsOpen && 'rotate-90')}
            aria-hidden="true"
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-1.5">
          <div className="rounded-md bg-parchment/45 p-2">
            <div className="grid grid-cols-2 gap-1.5">
              <DimensionInput label="Width (ft)" value={s.venueDimensions.widthFt} min={20} max={300} onCommit={(value) => s.updateVenueDimensions({ widthFt: value })} />
              <DimensionInput label="Length (ft)" value={s.venueDimensions.lengthFt} min={15} max={200} onCommit={(value) => s.updateVenueDimensions({ lengthFt: value })} />
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <label className="smallcaps text-[13px] text-ink-soft" htmlFor="venue-snap">
                Snap grid
              </label>
              <Select
                value={String(s.venueDimensions.snapFt)}
                onValueChange={(value) => s.updateVenueDimensions({ snapFt: Number(value) })}
              >
                <SelectTrigger id="venue-snap" className="h-7 w-[92px] bg-ivory px-2 text-[11.5px]">
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
            <p className="mt-2 text-[11.5px] leading-snug text-ink-soft">
              Furniture stays put when the room grows. Drag the walls on the floor plan to resize directly.
            </p>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {availableFeatures.length > 0 && (
        <InlineAddPanel
          buttonLabel="Add venue item"
          title="Add venue items"
          open={addingFeature}
          onOpenChange={setAddingFeature}
        >
          <div className="grid grid-cols-2 gap-1">
            {availableFeatures.map(({ id, glyph }) => {
              const feature = s.venue[id]
              return (
                <Button
                  key={id}
                  variant="ghost"
                  size="sm"
                  className="justify-start"
                  data-add-autofocus={id === availableFeatures[0]?.id ? '' : undefined}
                  onClick={() => {
                    s.updateVenueFeature(id, { enabled: true })
                    s.logActivity('venue', `Added ${feature.label}.`, 'you')
                    setAddingFeature(false)
                  }}
                >
                  <span className="font-bold text-gold-ink" aria-hidden="true">{glyph}</span>
                  {feature.label}
                </Button>
              )
            })}
          </div>
        </InlineAddPanel>
      )}

      <div className="grid grid-cols-1 gap-1">
        {enabledFeatures.map(({ id, glyph }) => {
          const feature = s.venue[id]
          const dimensions = feetSize(feature.w, feature.h, s.venueDimensions)
          return (
            <div key={id} className="flex items-center gap-2 rounded-md bg-parchment/55 px-2 py-1.5">
              <span
                className="w-5 shrink-0 text-center font-serif text-[15px] leading-none font-bold text-gold-ink"
                aria-hidden="true"
              >
                {glyph}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-semibold">{feature.label}</span>
                <span className="figures block truncate text-[11px] text-ink-faint">
                  {formatFeet(dimensions.w)} × {formatFeet(dimensions.h)} · {Math.round(feature.rotation)}°
                </span>
              </span>
              <Button
                variant="ghost"
                size="xs"
                aria-label={`Hide ${feature.label}`}
                onClick={() => {
                  s.updateVenueFeature(id, { enabled: false })
                  s.logActivity('venue', `Hid ${feature.label}.`, 'you')
                }}
              >
                Hide
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
  const s = useStore(useShallow((state) => ({
    guestOrder: state.guestOrder,
    guests: state.guests,
    seating: state.seating,
    tableOrder: state.tableOrder,
    tables: state.tables,
    venueDimensions: state.venueDimensions,
    addTable: state.addTable,
    logActivity: state.logActivity,
    removeTable: state.removeTable,
    setSelection: state.setSelection,
    setToast: state.setToast,
    snapshot: state.snapshot,
  })))
  const [addingTable, setAddingTable] = useState(false)
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
        <InlineAddPanel
          buttonLabel="Add table"
          title="New table"
          open={addingTable}
          onOpenChange={setAddingTable}
        >
          <div className="flex items-center gap-1.5">
            <span className="smallcaps shrink-0 pl-0.5 text-[13.5px] text-ink-soft">
              Shape
            </span>
            <Select
              items={TABLE_SHAPE_ITEMS}
              value={shape}
              onValueChange={(v) => v !== null && setShape(v as TableShape)}
            >
              <SelectTrigger
                className="min-w-0 flex-1"
                size="sm"
                aria-label="Shape for the new table"
                data-add-autofocus
              >
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
            <span className="smallcaps shrink-0 pl-0.5 text-[13.5px] text-ink-soft">
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
            <Plus data-icon="inline-start" aria-hidden="true" />
            Add Table
          </Button>
          {shortfall > 0 && (
            <Button variant="ghost" size="xs" onClick={addForShortfall}>
              {shortfall} guest{shortfall === 1 ? '' : 's'} without a seat — add {Math.ceil(shortfall / seats)} more
            </Button>
          )}
        </InlineAddPanel>
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
          No tables yet. Use Add table above — or ask your agent for “ten rounds of eight”.
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
              <span className="figures text-[11px] whitespace-nowrap text-ink-faint">
                {formatFeet(size.w)} × {formatFeet(size.h)}
              </span>
              <span className={cn('figures text-[11.5px] whitespace-nowrap', occ > t.seats ? 'text-brick' : 'text-ink-faint')}>
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
  const logActivity = useStore((state) => state.logActivity)
  const removeGroup = useStore((state) => state.removeGroup)
  const [open, setOpen] = usePersistedOpen(`aisle:group:${props.name}`, true)
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mb-1">
      <div className="group mt-2 mb-0.5 flex items-center gap-1.5 px-1">
        <CollapsibleTrigger className="smallcaps flex min-w-0 flex-1 items-center gap-2 rounded-md py-0.5 text-left text-[14px] text-ink-soft hover:bg-parchment">
          <ChevronRight className={cn('h-3 w-3 shrink-0 transition-transform', open && 'rotate-90')} aria-hidden="true" />
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: props.color }} />
          <span className="truncate">{props.name}</span>
          <span className="figures ml-auto shrink-0 text-[11.5px] font-normal">
            {props.seatedTotal}/{props.attendingTotal}
          </span>
        </CollapsibleTrigger>
        {props.removable && (
          <button
            className="shrink-0 px-1 text-[13px] leading-none text-ink-faint opacity-0 group-hover:opacity-100 hover:text-brick"
            title={`Remove empty group "${props.name}"`}
            aria-label={`Remove empty group ${props.name}`}
            onClick={() => {
              logActivity('remove group', `Removed empty group "${props.name}".`, 'you')
              removeGroup(props.name)
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
  const addGroup = useStore((state) => state.addGroup)
  const logActivity = useStore((state) => state.logActivity)
  const [name, setName] = useState('')
  const submit = () => {
    const added = addGroup(name)
    if (!added) return
    logActivity('add group', `Added group "${added}".`, 'you')
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
  const s = useStore(useShallow((state) => ({
    guests: state.guests,
    guestOrder: state.guestOrder,
    groupOrder: state.groupOrder,
    seating: state.seating,
    tables: state.tables,
    addGuest: state.addGuest,
    importGuests: state.importGuests,
    logActivity: state.logActivity,
    setSelection: state.setSelection,
    setToast: state.setToast,
  })))
  const [addingGuest, setAddingGuest] = useState(false)
  const [query, setQuery] = useState('')
  const [name, setName] = useState('')
  const [group, setGroup] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [importText, setImportText] = useState('')
  const [showNewGroup, setShowNewGroup] = useState(false)
  const [showListGroup, setShowListGroup] = useState(false)
  const guestNameRef = useRef<HTMLInputElement>(null)
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
    guestNameRef.current?.focus()
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
      <InlineAddPanel
        buttonLabel="Add guest"
        title="New guests"
        open={addingGuest}
        onOpenChange={(open) => {
          setAddingGuest(open)
          if (!open) {
            setShowImport(false)
            setShowNewGroup(false)
          }
        }}
      >
        <div className="flex gap-1.5">
          <Input
            ref={guestNameRef}
            placeholder="Add a guest…"
            aria-label="Guest name"
            data-add-autofocus
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
          <span className="smallcaps shrink-0 pl-0.5 text-[13.5px] text-ink-soft">
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
      </InlineAddPanel>
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
                  <span className="rounded-full bg-secondary px-1.5 text-[11px] font-bold whitespace-nowrap text-ink-soft">
                    rsvp?
                  </span>
                )}
                {g.dietary.length > 0 && (
                  <span className="rounded-full bg-sage/15 px-1.5 text-[11px] font-bold whitespace-nowrap text-sage">
                    {g.dietary[0].split(' ')[0]}
                  </span>
                )}
                <span
                  className={cn('figures text-[11.5px] whitespace-nowrap text-ink-faint', !seat && g.rsvp !== 'no' && 'italic')}
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
            className="mt-2 flex w-full items-center gap-2 rounded-md border border-dashed border-hairline px-2 py-1.5 text-[12px] font-medium text-ink-soft hover:border-sage hover:bg-accent hover:text-primary"
            onClick={() => setShowListGroup(true)}
          >
            <Plus className="h-3 w-3 shrink-0" aria-hidden="true" />
            New group
          </button>
        ))}
      {s.guestOrder.length === 0 && (
        <p className="my-1.5 px-1 text-[12.5px] text-ink-soft">
          The list is empty. Use Add guest above, or press <b>Load Sample Wedding</b> to see Aisle at work.
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
  const agentLog = useStore((state) => state.agentLog)
  return (
    <>
      {agentLog.length === 0 && (
        <p className="my-1.5 px-1 text-[12.5px] text-ink-soft">
          Every step lands here — yours and your agent's. Seat someone, or ask your agent to arrange the room.
        </p>
      )}
      {/* A quiet ledger rather than a stack of cards: hairline rail, a marker
          per entry (gold = agent, open = you), the sentence itself as the
          content, and one faint who·when line beneath. */}
      <div className="ml-[5px] flex flex-col border-l border-ink-faint/25 pr-0.5">
        {agentLog.map((e) => (
          <div key={e.id} className="animate-in fade-in slide-in-from-top-1 relative py-[5px] pl-3.5">
            <span
              aria-hidden="true"
              className={cn(
                'absolute top-[10px] -left-[4px] h-[7px] w-[7px] rounded-full border',
                e.source === 'you' ? 'border-ink-faint bg-parchment' : 'border-gold-ink/60 bg-gold',
              )}
            />
            <div className="text-[12.5px] leading-snug text-ink">{e.summary}</div>
            <div className="figures mt-px text-[11px] text-ink-faint">
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
  autoFocus?: boolean
}) {
  const { guestOrder, guests } = useStore(useShallow((state) => ({
    guestOrder: state.guestOrder,
    guests: state.guests,
  })))
  const items = guestOrder
    .filter((id) => id !== props.exclude)
    .map((id) => ({ value: id, label: guests[id].name }))
  const selected = items.find((i) => i.value === props.value) ?? null
  return (
    <Combobox items={items} value={selected} onValueChange={(item) => props.onChange(item?.value ?? '')}>
      <ComboboxInput
        size="sm"
        placeholder={props.placeholder}
        aria-label={props.placeholder}
        autoFocus={props.autoFocus}
        data-add-autofocus={props.autoFocus ? '' : undefined}
      />
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
  const s = useStore(useShallow((state) => ({
    ...selectCore(state),
    addConstraint: state.addConstraint,
    logActivity: state.logActivity,
  })))
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
    <div className="flex flex-col gap-1.5">
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
          <GuestPicker
            value={a}
            onChange={setA}
            placeholder="a guest…"
            exclude={isPair ? b : undefined}
            autoFocus
          />
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
  const s = useStore(useShallow((state) => ({
    ...selectCore(state),
    logActivity: state.logActivity,
    removeConstraint: state.removeConstraint,
    setRuleHighlight: state.setRuleHighlight,
  })))
  const [addingRule, setAddingRule] = useState(false)
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
        <InlineAddPanel
          buttonLabel="Add rule"
          title="New rules"
          open={addingRule}
          onOpenChange={setAddingRule}
        >
          <AddRule />
        </InlineAddPanel>
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
          Rules like “keep the exes apart” live here — use Add rule above, or just tell your agent.
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

/**
 * One entry in the plan's table of contents. Set like a program's running
 * heads — a serif title over a mono line of figures — with the open section
 * marked by a shift in the paper rather than a box or a colored bar.
 */
function SectionNavButton(props: {
  section: SectionDefinition
  summary: string
  active: boolean
  attention?: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      data-tour={props.section.id}
      aria-pressed={props.active}
      aria-controls="sidebar-workspace-panel"
      onClick={props.onSelect}
      className={cn(
        'group flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        props.active ? 'bg-parchment' : 'hover:bg-parchment/55',
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5">
          <span
            className={cn(
              'truncate font-serif text-[16.5px] leading-none font-semibold',
              props.active ? 'text-ink' : 'text-ink-soft group-hover:text-ink',
            )}
          >
            {props.section.title}
          </span>
          {props.attention ? <span className="size-1.5 shrink-0 rounded-full bg-brick" aria-hidden="true" /> : null}
        </span>
        <span className={cn('figures mt-[3px] block truncate text-[11.5px]', props.attention ? 'text-brick' : 'text-ink-faint')}>
          {props.summary}
        </span>
      </span>
      <ChevronRight
        className={cn(
          'size-3.5 shrink-0 text-ink-faint/70 transition-transform',
          props.active && 'rotate-90 text-gold-ink',
        )}
        aria-hidden="true"
      />
    </button>
  )
}

/** The chevron that folds the whole sidebar away and brings it back. */
function CollapseToggle(props: { open: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md border border-hairline bg-parchment/60 text-ink-soft hover:border-sage hover:bg-accent hover:text-primary"
      aria-expanded={props.open}
      aria-controls="sidebar-panel"
      aria-label={props.open ? 'Collapse the sidebar' : 'Expand the sidebar'}
      title={`${props.open ? 'Collapse' : 'Expand'} the sidebar (⌘B)`}
      onClick={props.onClick}
    >
      <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', props.open && 'rotate-180')} aria-hidden="true" />
    </button>
  )
}

/**
 * The sidebar folded away to a rail. It stays useful rather than becoming a
 * dead strip: each section name is a button that opens the sidebar back up
 * on that section, so getting to the guest list is one click, not two.
 */
function SidebarRail(props: {
  active: SectionId
  onExpand: () => void
  onOpenSection: (id: SectionId) => void
  counts: Record<SectionId, ReactNode>
  attention: boolean
}) {
  return (
    <aside
      id="sidebar-panel"
      className="hidden min-h-0 flex-col items-center overflow-hidden border-r border-hairline bg-ivory px-1.5 pt-1 pb-3 md:flex"
    >
      <CollapseToggle open={false} onClick={props.onExpand} />
      {/* Each section keeps its icon and its count, set as a legible pair
          rather than a badge riding on a corner; the section that will open
          is marked the same way as in the full sidebar — by a shift in the paper. */}
      <nav className="mt-2 flex min-h-0 flex-col items-center gap-1 overflow-hidden" aria-label="Plan sections">
        {SECTIONS.map(({ id, title, icon: Icon }) => {
          const warn = id === 'rules' && props.attention
          return (
            <button
              key={id}
              type="button"
              className={cn(
                'flex w-11 shrink-0 flex-col items-center gap-[3px] rounded-md py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                props.active === id ? 'bg-parchment text-ink' : 'text-ink-soft hover:bg-parchment/60 hover:text-ink',
              )}
              aria-label={`Open ${title}`}
              title={`Open ${title}`}
              onClick={() => props.onOpenSection(id)}
            >
              <Icon className="size-[15px]" aria-hidden="true" strokeWidth={1.75} />
              <span className={cn('figures text-[10.5px] leading-none', warn ? 'font-semibold text-brick' : 'text-ink-faint')}>
                {props.counts[id] || '–'}
              </span>
            </button>
          )
        })}
      </nav>
      <div className="min-h-2 flex-1" />
      <span className="smallcaps shrink-0 text-[13px] text-ink-faint [writing-mode:vertical-rl] rotate-180" aria-hidden="true">
        The plan
      </span>
    </aside>
  )
}

export function Sidebar({ open: sidebarOpen, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const s = useStore(useShallow((state) => {
    return {
      ...selectCore(state),
      agentLog: state.agentLog,
      clearActivity: state.clearActivity,
      setToast: state.setToast,
    }
  }))
  const [activeSection, setActiveSection] = usePersistedSection('aisle:sidebar:active', 'guests')
  const { brokenCount, pendingRuleCount } = useMemo(() => {
    let broken = 0
    let pending = 0
    for (const constraint of s.constraints) {
      const status = constraintStatus(s, constraint)
      if (status === 'violated') broken++
      else if (status === 'pending') pending++
    }
    return { brokenCount: broken, pendingRuleCount: pending }
  }, [s.constraints, s.seating, s.tables, s.tableOrder, s.venue, s.venueDimensions])
  const enabledVenueCount = Object.values(s.venue).filter((feature) => feature.enabled).length
  const attendingCount = s.guestOrder.filter((id) => s.guests[id].rsvp !== 'no').length
  const capacity = s.tableOrder.reduce((sum, id) => sum + s.tables[id].seats, 0)

  const counts: Record<SectionId, ReactNode> = {
    venue: enabledVenueCount,
    tables: s.tableOrder.length,
    guests: s.guestOrder.length,
    activity: s.agentLog.length,
    rules: brokenCount > 0 ? '!' : s.constraints.length,
  }

  const summaries: Record<SectionId, string> = {
    venue: `${enabledVenueCount} items · ${formatFeet(s.venueDimensions.widthFt)} × ${formatFeet(s.venueDimensions.lengthFt)}`,
    tables: s.tableOrder.length > 0
      ? `${s.tableOrder.length} table${s.tableOrder.length === 1 ? '' : 's'} · ${capacity} seats`
      : 'No tables yet',
    guests: s.guestOrder.length > 0
      ? `${s.guestOrder.length} guest${s.guestOrder.length === 1 ? '' : 's'} · ${attendingCount} attending`
      : 'No guests yet',
    rules: brokenCount > 0
      ? `${brokenCount} broken · ${s.constraints.length} total`
      : s.constraints.length > 0
        ? `${s.constraints.length} total · ${pendingRuleCount > 0 ? `${pendingRuleCount} waiting` : 'all clear'}`
        : 'No rules yet',
    activity: s.agentLog.length > 0
      ? `${s.agentLog.length} recent update${s.agentLog.length === 1 ? '' : 's'}`
      : 'No recent activity',
  }

  if (!sidebarOpen) {
    return (
      <SidebarRail
        active={activeSection}
        attention={brokenCount > 0}
        counts={counts}
        onExpand={() => onOpenChange(true)}
        onOpenSection={(id) => {
          setActiveSection(id)
          onOpenChange(true)
        }}
      />
    )
  }

  return (
    <aside
      id="sidebar-panel"
      className="hidden min-h-0 flex-col overflow-hidden border-r border-hairline bg-ivory px-2 pt-1 pb-2 md:flex"
    >
      {/* A slim rail of its own above the sections, so the control sits in the
          same place whether the sidebar is open or folded away. */}
      <div className="mb-0.5 flex shrink-0 items-center justify-between gap-2 border-b border-hairline/70 pb-1">
        <span className="smallcaps pl-1 text-[13.5px] text-ink-faint">The plan</span>
        <CollapseToggle open onClick={() => onOpenChange(false)} />
      </div>
      <nav className="flex shrink-0 flex-col gap-0.5 border-b border-hairline/70 px-0.5 py-1" aria-label="Plan sections">
        {PRIMARY_SECTIONS.map((section) => (
          <SectionNavButton
            key={section.id}
            section={section}
            summary={summaries[section.id]}
            active={activeSection === section.id}
            attention={section.id === 'rules' && brokenCount > 0}
            onSelect={() => setActiveSection(section.id)}
          />
        ))}
      </nav>

      <section
        id="sidebar-workspace-panel"
        role="region"
        aria-label={`${SECTIONS.find(({ id }) => id === activeSection)?.title ?? 'Plan'} workspace`}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pb-2"
      >
        {activeSection === 'venue' ? <VenueSection /> : null}
        {activeSection === 'tables' ? <TablesSection /> : null}
        {activeSection === 'guests' ? <GuestsSection /> : null}
        {activeSection === 'rules' ? <RulesSection /> : null}
        {activeSection === 'activity' ? (
          <div className="flex flex-col gap-1 pt-1">
            <div className="sticky top-0 z-10 -mx-1 flex items-center justify-between gap-2 bg-ivory px-2 py-1.5">
              <span className="smallcaps text-[13.5px] text-ink-soft">Recent activity</span>
              {s.agentLog.length > 0 ? (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    s.clearActivity()
                    s.setToast('Activity cleared.')
                  }}
                >
                  Clear
                </Button>
              ) : null}
            </div>
            <ActivitySection />
          </div>
        ) : null}
      </section>

      <div className="shrink-0 border-t border-hairline/70 px-0.5 pt-1">
        <SectionNavButton
          section={ACTIVITY_SECTION}
          summary={summaries.activity}
          active={activeSection === 'activity'}
          onSelect={() => setActiveSection('activity')}
        />
      </div>
    </aside>
  )
}
