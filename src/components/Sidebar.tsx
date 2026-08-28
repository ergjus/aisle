import { useMemo, useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { useStore } from '../store'
import { groupColors, parseGuestEntries } from '../utils'
import { constraintStatus, constraintText } from '../constraints'
import type { ZoneId } from '../types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Select,
  SelectContent,
  SelectItem,
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

function Section(props: {
  id: string
  title: string
  count?: ReactNode
  /** Shown in the header row only while the section is collapsed. */
  closedExtra?: ReactNode
  defaultOpen: boolean
  children: ReactNode
}) {
  const [open, setOpen] = usePersistedOpen(`aisle:sec:${props.id}`, props.defaultOpen)
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-b border-hairline/70 pb-1.5 last:border-0">
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md px-1.5 py-2 text-left text-[11.5px] font-bold tracking-[0.12em] text-ink-soft uppercase hover:bg-parchment">
        <ChevronRight className={cn('h-3 w-3 shrink-0 transition-transform', open && 'rotate-90')} aria-hidden="true" />
        {props.title}
        {props.count !== undefined && (
          <span className="text-[11px] tracking-wide text-ink-faint">{props.count}</span>
        )}
        {!open && props.closedExtra}
      </CollapsibleTrigger>
      <CollapsibleContent className="px-1 pt-1 pb-2">{props.children}</CollapsibleContent>
    </Collapsible>
  )
}

// ---- guests ----------------------------------------------------------------

function GuestsSection() {
  const s = useStore()
  const [query, setQuery] = useState('')
  const [name, setName] = useState('')
  const [group, setGroup] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [importText, setImportText] = useState('')

  const colors = useMemo(() => groupColors(s), [s.guests, s.guestOrder])

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase()
    const out = new Map<string, string[]>()
    for (const id of s.guestOrder) {
      const g = s.guests[id]
      if (q && !g.name.toLowerCase().includes(q) && !g.group.toLowerCase().includes(q)) continue
      if (!out.has(g.group)) out.set(g.group, [])
      out.get(g.group)!.push(id)
    }
    return out
  }, [s.guests, s.guestOrder, query])

  const groups = [...new Set(s.guestOrder.map((id) => s.guests[id].group))]

  const submitGuest = () => {
    if (!name.trim()) return
    const guest = s.addGuest({ name: name.trim(), group: group.trim() || undefined })
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

  return (
    <>
      <div className="flex flex-col gap-1.5 rounded-xl border bg-card p-2.5">
        <Input
          placeholder="Add a guest…"
          aria-label="Guest name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submitGuest()}
        />
        <div className="flex gap-1.5">
          <Input
            placeholder="Group (e.g. College friends)…"
            aria-label="Guest group"
            className="min-w-0 flex-1"
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitGuest()}
            list="group-options"
          />
          <datalist id="group-options">
            {groups.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
          <Button variant="outline" size="sm" onClick={submitGuest} disabled={!name.trim()}>
            Add
          </Button>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setShowImport((v) => !v)}>
          {showImport ? 'Hide Paste Box' : 'Paste a List…'}
        </Button>
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
        className="my-2"
        placeholder="Search guests…"
        aria-label="Search guests"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {[...grouped.entries()].map(([groupName, ids]) => (
        <div key={groupName} className="mb-1">
          <div className="mt-2 mb-0.5 flex items-center gap-2 px-1 text-[11px] font-bold tracking-[0.12em] text-ink-soft uppercase">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: colors[groupName] }} />
            <span className="truncate">{groupName}</span>
            <span className="ml-auto tracking-normal">
              {ids.filter((id) => s.seating[id]).length}/{ids.filter((id) => s.guests[id].rsvp !== 'no').length}
            </span>
          </div>
          {ids.map((id) => {
            const g = s.guests[id]
            const seat = s.seating[id]
            return (
              <button
                key={id}
                className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-parchment"
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
                  <span className="rounded-full bg-[#efe3bc] px-1.5 text-[10px] font-bold whitespace-nowrap text-[#8a6d1f]">
                    rsvp?
                  </span>
                )}
                {g.dietary.length > 0 && (
                  <span className="rounded-full bg-[#e2e8d9] px-1.5 text-[10px] font-bold whitespace-nowrap text-sage">
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
        </div>
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
      <div className="flex max-h-[46vh] flex-col gap-2 overflow-y-auto overscroll-contain pr-0.5">
        {s.agentLog.map((e) => (
          <div
            key={e.id}
            className={cn(
              'animate-in fade-in slide-in-from-top-1 rounded-lg border border-l-[3px] bg-card px-2.5 py-1.5',
              e.source === 'you' ? 'border-l-ink-faint' : 'border-l-gold',
            )}
          >
            <div
              className={cn(
                'text-[10.5px] font-bold tracking-[0.1em] uppercase',
                e.source === 'you' ? 'text-ink-soft' : 'text-[#9c8446]',
              )}
            >
              {e.source === 'you' ? 'You' : 'Agent'} · {e.tool}
            </div>
            <div className="text-[12.5px] whitespace-pre-wrap">{e.summary}</div>
            <div className="text-[10.5px] text-ink-faint">{timeAgo(e.time)}</div>
          </div>
        ))}
      </div>
    </>
  )
}

// ---- house rules ------------------------------------------------------------

const RULE_OPTIONS = [
  { value: 'together', label: 'Must sit together' },
  { value: 'apart', label: 'Must sit apart' },
  { value: 'near:dance_floor', label: 'Near the dance floor' },
  { value: 'far:dance_floor', label: 'Away from the dance floor' },
  { value: 'near:band', label: 'Near the band' },
  { value: 'far:band', label: 'Away from the band' },
  { value: 'near:entrance', label: 'Near the entrance' },
  { value: 'far:entrance', label: 'Away from the entrance' },
]

function GuestSelect(props: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  exclude?: string
}) {
  const s = useStore()
  return (
    <Select value={props.value} onValueChange={(v) => v !== null && props.onChange(v)}>
      <SelectTrigger className="w-full min-w-0" size="sm" aria-label={props.placeholder}>
        <SelectValue placeholder={props.placeholder} />
      </SelectTrigger>
      <SelectContent>
        {s.guestOrder
          .filter((id) => id !== props.exclude)
          .map((id) => (
            <SelectItem key={id} value={id}>
              {s.guests[id].name}
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  )
}

function AddRule() {
  const s = useStore()
  const [type, setType] = useState('together')
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const isPair = type === 'together' || type === 'apart'

  const add = () => {
    if (!a) return
    let added
    if (isPair) {
      if (!b || a === b) return
      added = s.addConstraint({ type: type as 'together' | 'apart', a, b })
    } else {
      const [preference, zone] = type.split(':') as ['near' | 'far', ZoneId]
      added = s.addConstraint({ type: 'zone', guestId: a, zone, preference })
    }
    s.logActivity('add rule', `Added rule: ${constraintText(s, added)}.`, 'you')
    setA('')
    setB('')
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-xl border bg-card p-2.5">
      <Select value={type} onValueChange={(v) => v !== null && setType(v)}>
        <SelectTrigger className="w-full" size="sm" aria-label="Kind of rule">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {RULE_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex min-w-0 gap-1.5 *:flex-1">
        <GuestSelect value={a} onChange={setA} placeholder={isPair ? 'First guest…' : 'Guest…'} />
        {isPair && <GuestSelect value={b} onChange={setB} placeholder="Second guest…" exclude={a} />}
      </div>
      <Button variant="outline" size="sm" onClick={add} disabled={!a || (isPair && (!b || a === b))}>
        Add Rule
      </Button>
    </div>
  )
}

function RulesSection() {
  const s = useStore()
  const counts = { ok: 0, violated: 0, pending: 0 }
  for (const c of s.constraints) counts[constraintStatus(s, c)]++

  return (
    <>
      {s.constraints.length > 0 && (
        <p className="my-1 px-1 text-xs font-bold">
          <span className="text-sage">{counts.ok} kept</span>
          {counts.violated > 0 && <span className="text-brick"> · {counts.violated} broken</span>}
          {counts.pending > 0 && <span className="text-ink-faint"> · {counts.pending} waiting on seats</span>}
        </p>
      )}
      {s.constraints.length === 0 && (
        <p className="my-1.5 px-1 text-[12.5px] text-ink-soft">
          Rules like “keep the exes apart” live here — add one below, or just tell your agent.
        </p>
      )}
      {s.constraints.map((c) => {
        const status = constraintStatus(s, c)
        const statusText = status === 'ok' ? 'kept' : status === 'violated' ? 'broken' : 'waiting — someone is unseated'
        return (
          <div key={c.id} className="flex items-start gap-2 rounded-md px-1.5 py-1.5 hover:bg-parchment">
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
      <Separator className="my-2" />
      <AddRule />
    </>
  )
}

// ---- the sidebar ------------------------------------------------------------

export function Sidebar() {
  const s = useStore()
  const brokenCount = s.constraints.filter((c) => constraintStatus(s, c) === 'violated').length

  return (
    <aside className="hidden min-h-0 flex-col overflow-y-auto overscroll-contain border-r border-hairline bg-ivory px-2.5 pt-1 pb-6 md:flex">
      <Section id="guests" title="Guests" count={s.guestOrder.length} defaultOpen>
        <GuestsSection />
      </Section>
      <Section id="activity" title="Activity" count={s.agentLog.length > 0 ? `${s.agentLog.length} steps` : undefined} defaultOpen>
        <ActivitySection />
      </Section>
      <Section
        id="rules"
        title="House rules"
        count={s.constraints.length}
        defaultOpen={false}
        closedExtra={brokenCount > 0 ? <span className="text-[11px] text-brick">· {brokenCount} broken</span> : undefined}
      >
        <RulesSection />
      </Section>
    </aside>
  )
}
