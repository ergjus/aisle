import { useId, useMemo, useState } from 'react'
import { Copy, Search, X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { occupantsOf, selectCore, useStore } from '../store'
import { copySharedChartToMine, exitSharedView } from '../share/viewer'
import type { AisleState } from '../types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

/** Lowercase, accent-free — so "jose" finds "José". */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

/** Guests whose name contains every word typed, best (prefix) matches first. */
export function findGuests(state: Pick<AisleState, 'guestOrder' | 'guests'>, query: string, limit = 6): string[] {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  const scored: { id: string; score: number }[] = []
  for (const id of state.guestOrder) {
    const name = fold(state.guests[id].name)
    if (!words.every((w) => name.includes(w))) continue
    const parts = name.split(/\s+/)
    const score = words.reduce((sum, w) => sum + (parts.some((p) => p.startsWith(w)) ? 2 : 0) + (name.startsWith(w) ? 1 : 0), 0)
    scored.push({ id, score })
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.id)
}

/**
 * The strip under the masthead while a share link is open: says plainly that
 * this is someone else's chart, view only; offers "find your seat"; and
 * carries the two ways out — make an editable copy, or go back to your own.
 */
export function SharedViewBar() {
  const core = useStore(useShallow(selectCore))
  const { sharedView, foundGuest, setFoundGuest } = useStore(useShallow((state) => ({
    sharedView: state.sharedView,
    foundGuest: state.foundGuest,
    setFoundGuest: state.setFoundGuest,
  })))
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const listId = useId()

  const matches = useMemo(() => findGuests(core, query), [core.guestOrder, core.guests, query])

  if (!sharedView) return null

  const choose = (id: string) => {
    setFoundGuest(id)
    setQuery(core.guests[id].name)
    setOpen(false)
  }

  const clear = () => {
    setFoundGuest(null)
    setQuery('')
    setOpen(false)
  }

  const found = foundGuest ? core.guests[foundGuest] : null
  const seat = foundGuest ? core.seating[foundGuest] : undefined
  const table = seat ? core.tables[seat.tableId] : undefined
  const tablemates = seat ? occupantsOf(core, seat.tableId).filter((id) => id !== foundGuest).map((id) => core.guests[id].name) : []
  const ready = sharedView.status === 'ready'

  return (
    <div className="relative z-20 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-hairline bg-parchment/70 px-4 py-2" role="region" aria-label="Shared seating chart">
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="smallcaps text-[13px] whitespace-nowrap text-gold-ink">Shared seating chart · view only</span>
        {ready && sharedView.title && (
          <span className="truncate font-heading text-[17px] leading-none text-ink">{sharedView.title}</span>
        )}
        {sharedView.status === 'loading' && <span className="text-[12.5px] text-ink-soft italic">Opening…</span>}
      </div>

      {ready && (
        <div className="relative w-full max-w-[300px] min-w-[200px] flex-1 sm:w-auto">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-faint" aria-hidden="true" />
          <input
            type="search"
            role="combobox"
            aria-expanded={open && matches.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-label="Find your seat — type a name"
            placeholder="Find your seat — type a name"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
              setOpen(true)
              if (!e.target.value.trim()) setFoundGuest(null)
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault()
                setOpen(true)
                if (matches.length) setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length)
              } else if (e.key === 'Enter' && matches[active]) {
                e.preventDefault()
                choose(matches[active])
              } else if (e.key === 'Escape') {
                clear()
              }
            }}
            className="h-8 w-full rounded-md border border-hairline bg-card pr-7 pl-8 text-[12.5px] text-ink outline-none placeholder:text-ink-faint focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              className="absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 items-center justify-center rounded text-ink-faint hover:text-ink"
              aria-label="Clear the search"
              onClick={clear}
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          )}
          {open && matches.length > 0 && (
            <ul
              id={listId}
              role="listbox"
              className="absolute top-[calc(100%+4px)] right-0 left-0 z-[70] rounded-md border border-hairline bg-card p-1 shadow-[0_14px_34px_-14px_rgba(41,36,29,0.45)]"
            >
              {matches.map((id, i) => {
                const where = core.seating[id] ? core.tables[core.seating[id].tableId]?.name : core.guests[id].rsvp === 'no' ? 'Not attending' : 'Not seated yet'
                return (
                  <li
                    key={id}
                    role="option"
                    aria-selected={i === active}
                    className={cn(
                      'flex cursor-pointer items-baseline justify-between gap-3 rounded-[4px] px-2.5 py-1.5 text-[12.5px] text-ink',
                      i === active && 'bg-parchment',
                    )}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      choose(id)
                    }}
                  >
                    <span className="truncate">{core.guests[id].name}</span>
                    <span className="figures shrink-0 text-[11px] text-ink-soft">{where}</span>
                  </li>
                )
              })}
            </ul>
          )}
          {open && query.trim() && matches.length === 0 && (
            <p className="absolute top-[calc(100%+4px)] right-0 left-0 z-[70] rounded-md border border-hairline bg-card px-3 py-2 text-[12px] text-ink-soft shadow-[0_14px_34px_-14px_rgba(41,36,29,0.45)]">
              No guest by that name on this chart.
            </p>
          )}
        </div>
      )}

      {ready && found && (
        <p className="min-w-0 text-[12.5px] leading-snug text-ink" role="status" aria-live="polite">
          <span className="font-semibold">{found.name}</span>
          {table && seat ? (
            <>
              {' '}— <span className="font-semibold text-gold-ink">{table.name}</span>
              <span className="figures text-ink-soft"> · seat {seat.seat + 1}</span>
              {tablemates.length > 0 && (
                <span className="text-ink-soft"> · with {tablemates.slice(0, 4).join(', ')}{tablemates.length > 4 ? ` and ${tablemates.length - 4} more` : ''}</span>
              )}
            </>
          ) : (
            <span className="text-ink-soft"> — {found.rsvp === 'no' ? 'not attending' : 'not seated yet'}</span>
          )}
        </p>
      )}

      <div className="min-w-2 flex-1" />

      <div className="flex items-center gap-2">
        {ready && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 rounded-md px-3 text-[12.5px]"
            onClick={() => copySharedChartToMine()}
            title="Save a copy of this chart in this browser as your own, editable chart"
          >
            <Copy data-icon="inline-start" className="size-3.5" aria-hidden="true" />
            Make a copy to edit
          </Button>
        )}
        <Button variant="ghost" size="sm" className="h-8 px-2.5 text-[12.5px] text-ink-soft" onClick={() => exitSharedView()}>
          Back to my chart
        </Button>
      </div>
    </div>
  )
}

/** Shown in place of the floor plan when a share link can't be opened. */
export function SharedViewError({ message }: { message: string }) {
  return (
    <div className="flex min-h-0 items-center justify-center bg-pine-900 p-6">
      <div className="max-w-md rounded-lg border border-hairline bg-ivory p-6 text-center shadow-[0_24px_60px_-30px_rgba(0,0,0,0.6)]" role="alert">
        <p className="smallcaps text-[13px] text-gold-ink">Shared seating chart</p>
        <h2 className="mt-1 font-serif text-[26px] leading-tight font-semibold text-ink">This link can’t be opened</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">{message}</p>
        <p className="mt-2 text-[12px] text-ink-faint">Your own chart hasn’t been touched.</p>
        <Button className="mt-4" size="sm" onClick={() => exitSharedView()}>
          Go to my chart
        </Button>
      </div>
    </div>
  )
}
