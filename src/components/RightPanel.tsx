import { useState } from 'react'
import { useStore } from '../store'
import { constraintStatus, constraintText } from '../constraints'
import type { ZoneId } from '../types'

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

function AddRule() {
  const s = useStore()
  const [type, setType] = useState('together')
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const isPair = type === 'together' || type === 'apart'
  const guests = s.guestOrder.map((id) => s.guests[id])

  const add = () => {
    if (!a) return
    if (isPair) {
      if (!b || a === b) return
      s.addConstraint({ type: type as 'together' | 'apart', a, b })
    } else {
      const [preference, zone] = type.split(':') as ['near' | 'far', ZoneId]
      s.addConstraint({ type: 'zone', guestId: a, zone, preference })
    }
    setA('')
    setB('')
  }

  return (
    <div className="add-constraint">
      <select value={type} onChange={(e) => setType(e.target.value)}>
        {RULE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <div className="row">
        <select value={a} onChange={(e) => setA(e.target.value)}>
          <option value="">{isPair ? 'First guest…' : 'Guest…'}</option>
          {guests.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        {isPair && (
          <select value={b} onChange={(e) => setB(e.target.value)}>
            <option value="">Second guest…</option>
            {guests
              .filter((g) => g.id !== a)
              .map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
          </select>
        )}
      </div>
      <button className="btn" onClick={add} disabled={!a || (isPair && (!b || a === b))}>
        Add rule
      </button>
    </div>
  )
}

function timeAgo(t: number): string {
  const sec = Math.max(0, Math.round((Date.now() - t) / 1000))
  if (sec < 5) return 'just now'
  if (sec < 60) return `${sec}s ago`
  const min = Math.round(sec / 60)
  return min < 60 ? `${min}m ago` : `${Math.round(min / 60)}h ago`
}

export function RightPanel() {
  const s = useStore()

  return (
    <aside className="panel panel-right">
      <section>
        <h2>
          House rules <span className="count">{s.constraints.length}</span>
        </h2>
        {s.constraints.length === 0 && (
          <p style={{ color: 'var(--ink-soft)', fontSize: 12.5 }}>
            No seating rules yet. Rules like “keep the exes apart” live here — you can add them below, or just tell your
            agent.
          </p>
        )}
        {s.constraints.map((c) => {
          const status = constraintStatus(s, c)
          return (
            <div className="constraint-row" key={c.id}>
              <span className={`status ${status}`} title={status} />
              <span className="text">
                {constraintText(s, c)}
                {c.note && <span className="note">{c.note}</span>}
              </span>
              <button className="remove" title="Remove rule" onClick={() => s.removeConstraint(c.id)}>
                ×
              </button>
            </div>
          )
        })}
        <hr className="rule" />
        <AddRule />
      </section>

      <section>
        <h2>
          Agent <span className="count">{s.agentLog.length > 0 ? `${s.agentLog.length} actions` : ''}</span>
        </h2>
        {!s.agentConnected && (
          <div className="agent-hint">
            <div className="title">Bring your agent</div>
            This page publishes <b>{s.toolNames.length || 'its'} seating tools</b> through WebMCP
            (<code>navigator.modelContext</code>). Open it in an agent‑enabled browser and just talk:
            <br />
            <i>“Seat everyone — keep the exes apart, and Grandma away from the speakers.”</i>
            <div className="sub">
              {s.webmcpAvailable
                ? 'WebMCP detected — your agent can already see the tools.'
                : 'No WebMCP in this browser (Chrome: enable chrome://flags/#enable-webmcp-for-testing). You can still plan by hand — or try aisle.call("auto_arrange", {}) in the console.'}
            </div>
          </div>
        )}
        <div className="agent-feed" style={{ marginTop: 10 }}>
          {s.agentLog.map((e) => (
            <div className="agent-entry" key={e.id}>
              <div className="tool">{e.tool}</div>
              <div className="summary">{e.summary}</div>
              <div className="when">{timeAgo(e.time)}</div>
            </div>
          ))}
        </div>
      </section>
    </aside>
  )
}
