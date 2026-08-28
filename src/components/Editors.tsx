import { useEffect } from 'react'
import { useStore, type Selection } from '../store'
import type { RSVP } from '../types'

function clampPos(at: { x: number; y: number }, w = 258, h = 340) {
  return {
    left: Math.max(8, Math.min(at.x, window.innerWidth - w - 12)),
    top: Math.max(8, Math.min(at.y, window.innerHeight - h - 12)),
  }
}

function GuestEditor({ sel }: { sel: Selection }) {
  const s = useStore()
  const g = s.guests[sel.id]
  if (!g) return null
  const seat = s.seating[g.id]
  const groups = [...new Set(s.guestOrder.map((id) => s.guests[id].group))]

  return (
    <div className="editor" style={clampPos(sel.at)}>
      <h3>{g.name}</h3>
      <label>
        Name
        <input value={g.name} onChange={(e) => s.updateGuest(g.id, { name: e.target.value })} />
      </label>
      <div className="row">
        <label>
          Group
          <input
            value={g.group}
            list="group-options"
            onChange={(e) => s.updateGuest(g.id, { group: e.target.value })}
          />
        </label>
        <label>
          RSVP
          <select value={g.rsvp} onChange={(e) => s.updateGuest(g.id, { rsvp: e.target.value as RSVP })}>
            <option value="yes">Yes</option>
            <option value="pending">Pending</option>
            <option value="no">No</option>
          </select>
        </label>
      </div>
      <label>
        Dietary (comma separated)
        <input
          value={g.dietary.join(', ')}
          placeholder="vegetarian, nut allergy…"
          onChange={(e) =>
            s.updateGuest(g.id, {
              dietary: e.target.value.split(',').map((d) => d.trim()).filter(Boolean),
            })
          }
        />
      </label>
      <label>
        Notes
        <input
          value={g.notes ?? ''}
          placeholder="family politics, quirks…"
          onChange={(e) => s.updateGuest(g.id, { notes: e.target.value })}
        />
      </label>
      <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
        {seat ? `Seated at ${s.tables[seat.tableId]?.name}` : 'Not seated — drag their chip onto a table.'}
      </div>
      <div className="actions">
        <button className="btn btn-danger" onClick={() => s.removeGuest(g.id)}>
          Remove
        </button>
        {seat && (
          <button className="btn" onClick={() => s.unseatGuest(g.id)}>
            Unseat
          </button>
        )}
        <button className="btn btn-quiet" onClick={() => s.setSelection(null)}>
          Done
        </button>
      </div>
    </div>
  )
}

function TableEditor({ sel }: { sel: Selection }) {
  const s = useStore()
  const t = s.tables[sel.id]
  if (!t) return null
  const occ = Object.values(s.seating).filter((a) => a.tableId === t.id).length

  return (
    <div className="editor" style={clampPos(sel.at, 258, 260)}>
      <h3>{t.name}</h3>
      <label>
        Name
        <input value={t.name} onChange={(e) => s.updateTable(t.id, { name: e.target.value })} />
      </label>
      <div className="row">
        <label>
          Seats
          <div className="stepper">
            <button aria-label="Remove a seat" onClick={() => s.updateTable(t.id, { seats: t.seats - 1 })} disabled={t.seats <= 2}>
              −
            </button>
            <span style={{ fontWeight: 700 }}>{t.seats}</span>
            <button aria-label="Add a seat" onClick={() => s.updateTable(t.id, { seats: t.seats + 1 })} disabled={t.seats >= 16}>
              +
            </button>
          </div>
        </label>
        <label>
          Shape
          <select
            value={t.shape}
            onChange={(e) => s.updateTable(t.id, { shape: e.target.value as 'round' | 'rect' })}
          >
            <option value="round">Round</option>
            <option value="rect">Banquet</option>
          </select>
        </label>
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
        {occ}/{t.seats} seats taken · drag the table to move it around the room
      </div>
      <div className="actions">
        <button className="btn btn-danger" onClick={() => s.removeTable(t.id)}>
          Remove Table
        </button>
        <button className="btn btn-quiet" onClick={() => s.setSelection(null)}>
          Done
        </button>
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
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 55 }}
        onPointerDown={() => setSelection(null)}
      />
      {sel.kind === 'guest' ? <GuestEditor sel={sel} /> : <TableEditor sel={sel} />}
    </>
  )
}
