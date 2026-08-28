import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { groupColors, parseGuestEntries } from '../utils'

export function GuestPanel() {
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
    <aside className="panel panel-left">
      <h2>
        Guests <span className="count">{s.guestOrder.length}</span>
      </h2>
      <div className="add-guest-form">
        <div className="row">
          <input
            placeholder="Add a guest…"
            aria-label="Guest name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitGuest()}
          />
        </div>
        <div className="row">
          <input
            placeholder="Group (e.g. College friends)…"
            aria-label="Guest group"
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
          <button className="btn" onClick={submitGuest} disabled={!name.trim()}>
            Add
          </button>
        </div>
        <div className="row">
          <button className="btn btn-quiet" onClick={() => setShowImport((v) => !v)} style={{ flex: 1 }}>
            {showImport ? 'Hide Paste Box' : 'Paste a List…'}
          </button>
        </div>
        {showImport && (
          <div className="import-box">
            <textarea
              placeholder={'One guest per line:\nNora Flynn — Childhood friends\nRaj Iyer — Work friends — gluten-free'}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
            />
            <button className="btn" onClick={runImport} style={{ width: '100%' }}>
              Import
            </button>
          </div>
        )}
      </div>
      <input
        className="search"
        placeholder="Search guests…"
        aria-label="Search guests"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {[...grouped.entries()].map(([groupName, ids]) => (
        <div className="guest-group" key={groupName}>
          <div className="group-head">
            <span className="group-swatch" style={{ background: colors[groupName] }} />
            {groupName}
            <span style={{ marginLeft: 'auto', letterSpacing: 0 }}>
              {ids.filter((id) => s.seating[id]).length}/{ids.filter((id) => s.guests[id].rsvp !== 'no').length}
            </span>
          </div>
          {ids.map((id) => {
            const g = s.guests[id]
            const seat = s.seating[id]
            return (
              <button
                key={id}
                className="guest-row"
                onClick={(e) => s.setSelection({ kind: 'guest', id, at: { x: e.clientX + 12, y: e.clientY - 10 } })}
              >
                <span className="name" style={g.rsvp === 'no' ? { textDecoration: 'line-through', opacity: 0.55 } : undefined}>
                  {g.name}
                </span>
                {g.rsvp === 'pending' && <span className="tag pending">rsvp?</span>}
                {g.dietary.length > 0 && <span className="tag diet">{g.dietary[0].split(' ')[0]}</span>}
                <span className={seat ? 'where' : 'where lounge'}>
                  {g.rsvp === 'no' ? '—' : seat ? s.tables[seat.tableId]?.name.replace('Table ', 'T') : 'lounge'}
                </span>
              </button>
            )
          })}
        </div>
      ))}
      {s.guestOrder.length === 0 && (
        <p style={{ color: 'var(--ink-soft)', fontSize: 13 }}>
          The list is empty. Add guests above, paste a list, or press <b>Load sample wedding</b> to see Aisle at work.
        </p>
      )}
    </aside>
  )
}
