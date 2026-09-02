import { useEffect } from 'react'
import { useStore, type Selection } from '../store'
import type { RSVP } from '../types'
import { formatFeet, roomRect, stageUnitsPerFoot } from '../geometry'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

function clampPos(at: { x: number; y: number }, w = 264, h = 340) {
  return {
    left: Math.max(8, Math.min(at.x, window.innerWidth - w - 12)),
    top: Math.max(8, Math.min(at.y, window.innerHeight - h - 12)),
  }
}

function Field(props: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1 text-[10.5px] font-bold tracking-[0.1em] text-ink-soft uppercase">
      {props.label}
      {props.children}
    </label>
  )
}

const cardCls =
  'animate-in fade-in zoom-in-95 fixed z-[60] flex w-[264px] flex-col gap-2 rounded-xl border border-input bg-card p-3 shadow-2xl'

function GuestEditor({ sel }: { sel: Selection }) {
  const s = useStore()
  const g = s.guests[sel.id]
  if (!g) return null
  const seat = s.seating[g.id]
  const groups = s.groupOrder

  return (
    <div className={cardCls} style={clampPos(sel.at)}>
      <h3 className="font-serif text-lg leading-tight font-semibold">{g.name}</h3>
      <Field label="Name">
        <Input value={g.name} onChange={(e) => s.updateGuest(g.id, { name: e.target.value })} />
      </Field>
      <div className="flex gap-1.5">
        <Field label="Group">
          <Input value={g.group} list="group-options" onChange={(e) => s.updateGuest(g.id, { group: e.target.value })} />
          <datalist id="group-options">
            {groups.map((grp) => (
              <option key={grp} value={grp} />
            ))}
          </datalist>
        </Field>
        <Field label="RSVP">
          <Select value={g.rsvp} onValueChange={(v) => s.updateGuest(g.id, { rsvp: v as RSVP })}>
            <SelectTrigger className="w-full" aria-label="RSVP">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="yes">Yes</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="no">No</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>
      <Field label="Dietary (comma separated)">
        <Input
          value={g.dietary.join(', ')}
          placeholder="vegetarian, nut allergy…"
          onChange={(e) =>
            s.updateGuest(g.id, {
              dietary: e.target.value.split(',').map((d) => d.trim()).filter(Boolean),
            })
          }
        />
      </Field>
      <Field label="Notes">
        <Input
          value={g.notes ?? ''}
          placeholder="family politics, quirks…"
          onChange={(e) => s.updateGuest(g.id, { notes: e.target.value })}
        />
      </Field>
      <div className="text-xs text-ink-soft">
        {seat
          ? `Seated at ${s.tables[seat.tableId]?.name}${s.pinned[g.id] ? ' · pinned — the solver and the agent leave them here' : ''}`
          : 'Not seated — drag their chip onto a table.'}
      </div>
      <div className="mt-1 flex justify-between gap-1.5">
        <Button
          variant="destructive"
          size="sm"
          onClick={() => {
            s.logActivity('remove guest', `Removed ${g.name} from the guest list.`, 'you')
            s.removeGuest(g.id)
          }}
        >
          Remove
        </Button>
        {seat && (
          <Button
            variant={s.pinned[g.id] ? 'secondary' : 'outline'}
            size="sm"
            title={s.pinned[g.id] ? 'Let the solver and the agent move this guest again' : 'Keep this guest exactly here through Seat Everyone, repairs, and agent moves (P)'}
            onClick={() => {
              const next = !s.pinned[g.id]
              s.pinGuest(g.id, next)
              s.logActivity('pin', next ? `Pinned ${g.name} at ${s.tables[seat.tableId]?.name}.` : `Unpinned ${g.name}.`, 'you')
            }}
          >
            {s.pinned[g.id] ? 'Unpin' : 'Pin seat'}
          </Button>
        )}
        {seat && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              s.unseatGuest(g.id)
              s.logActivity('unseat', `Sent ${g.name} back to the lounge.`, 'you')
            }}
          >
            Unseat
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => s.setSelection(null)}>
          Done
        </Button>
      </div>
    </div>
  )
}

function TableEditor({ sel }: { sel: Selection }) {
  const s = useStore()
  const t = s.tables[sel.id]
  if (!t) return null
  const occ = Object.values(s.seating).filter((a) => a.tableId === t.id).length
  const room = roomRect(s.venueDimensions)
  const units = stageUnitsPerFoot(s.venueDimensions)
  const xFt = (t.x - room.x) / units.x
  const yFt = (t.y - room.y) / units.y

  return (
    <div className={cardCls} style={clampPos(sel.at, 264, 320)}>
      <h3 className="font-serif text-lg leading-tight font-semibold">{t.name}</h3>
      <Field label="Name">
        <Input value={t.name} onChange={(e) => s.updateTable(t.id, { name: e.target.value })} />
      </Field>
      <div className="flex gap-1.5">
        <Field label="Seats">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              aria-label="Remove a seat"
              onClick={() => s.updateTable(t.id, { seats: t.seats - 1 })}
              disabled={t.seats <= 2}
            >
              −
            </Button>
            <span className="text-sm font-bold">{t.seats}</span>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              aria-label="Add a seat"
              onClick={() => s.updateTable(t.id, { seats: t.seats + 1 })}
              disabled={t.seats >= 16}
            >
              +
            </Button>
          </div>
        </Field>
        <Field label="Shape">
          <Select value={t.shape} onValueChange={(v) => s.updateTable(t.id, { shape: v as 'round' | 'rect' })}>
            <SelectTrigger className="w-full" aria-label="Shape">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="round">Round</SelectItem>
              <SelectItem value="rect">Banquet</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>
      <div className="flex gap-1.5">
        <Field label="Rotation">
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="icon" className="h-7 w-7" aria-label="Rotate table left 15 degrees" onClick={() => s.updateTable(t.id, { rotation: ((t.rotation ?? 0) + 345) % 360 })}>↶</Button>
            <span className="min-w-9 text-center text-sm font-bold">{Math.round(t.rotation ?? 0)}°</span>
            <Button variant="outline" size="icon" className="h-7 w-7" aria-label="Rotate table right 15 degrees" onClick={() => s.updateTable(t.id, { rotation: ((t.rotation ?? 0) + 15) % 360 })}>↷</Button>
          </div>
        </Field>
        <Field label="Position">
          <span className="flex h-7 items-center text-xs font-semibold text-ink-soft">{formatFeet(xFt)} from left · {formatFeet(yFt)} down</span>
        </Field>
      </div>
      <div className="text-xs text-ink-soft">
        {occ}/{t.seats} seats taken · Shift-click to multi-select · press R to rotate
      </div>
      <div className="mt-1 flex justify-between gap-1.5">
        <Button
          variant="destructive"
          size="sm"
          onClick={() => {
            s.logActivity('remove table', `Removed ${t.name}.`, 'you')
            s.removeTable(t.id)
          }}
        >
          Remove Table
        </Button>
        <Button variant="ghost" size="sm" onClick={() => s.setSelection(null)}>
          Done
        </Button>
      </div>
    </div>
  )
}

export function Editors() {
  const sel = useStore((s) => s.selection)
  const setSelection = useStore((s) => s.setSelection)

  useEffect(() => {
    if (!sel) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelection(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sel, setSelection])

  if (!sel) return null
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 55 }} onPointerDown={() => setSelection(null)} />
      {sel.kind === 'guest' ? <GuestEditor sel={sel} /> : <TableEditor sel={sel} />}
    </>
  )
}
