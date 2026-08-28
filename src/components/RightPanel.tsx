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
    <div className="add-constraint">
      <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Kind of rule">
        {RULE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <div className="row">
        <select value={a} onChange={(e) => setA(e.target.value)} aria-label={isPair ? 'First guest' : 'Guest'}>
          <option value="">{isPair ? 'First guest…' : 'Guest…'}</option>
          {guests.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        {isPair && (
          <select value={b} onChange={(e) => setB(e.target.value)} aria-label="Second guest">
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
        Add Rule
      </button>
    </div>
  )
}

function RuleSummary() {
  const s = useStore()
  const counts = { ok: 0, violated: 0, pending: 0 }
  for (const c of s.constraints) counts[constraintStatus(s, c)]++
  return (
    <p className="rule-summary">
      <span className="k ok">{counts.ok} kept</span>
      {counts.violated > 0 && <span className="k violated"> · {counts.violated} broken</span>}
      {counts.pending > 0 && <span className="k pending"> · {counts.pending} waiting on seats</span>}
    </p>
  )
}

function timeAgo(t: number): string {
  const sec = Math.max(0, Math.round((Date.now() - t) / 1000))
  if (sec < 5) return 'just now'
  if (sec < 60) return `${sec}s ago`
  const min = Math.round(sec / 60)
  return min < 60 ? `${min}m ago` : `${Math.round(min / 60)}h ago`
}

const RULES_OPEN_KEY = 'aisle:rules-open'

export function RightPanel() {
  const s = useStore()
  const [rulesOpen, setRulesOpen] = useState(() => {
    try {
      return localStorage.getItem(RULES_OPEN_KEY) !== '0'
    } catch {
      return true
    }
  })
  const brokenCount = s.constraints.filter((c) => constraintStatus(s, c) === 'violated').length

  const toggleRules = () => {
    setRulesOpen((open) => {
      try {
        localStorage.setItem(RULES_OPEN_KEY, open ? '0' : '1')
      } catch {
        // Preference simply won't stick.
      }
      return !open
    })
  }

  return (
    <aside className="panel panel-right">
      <section>
        <h2>
          Activity <span className="count">{s.agentLog.length > 0 ? `${s.agentLog.length} steps` : ''}</span>
        </h2>
        {s.agentLog.length === 0 && (
          <p className="feed-empty">
            Every step lands here — yours and your agent's. Seat someone, or ask your agent to arrange the room.
          </p>
        )}
        <div className="agent-feed" style={{ marginTop: 8 }}>
          {s.agentLog.map((e) => (
            <div className={e.source === 'you' ? 'agent-entry you' : 'agent-entry'} key={e.id}>
              <div className="tool">
                {e.source === 'you' ? 'You' : 'Agent'} · {e.tool}
              </div>
              <div className="summary">{e.summary}</div>
              <div className="when">{timeAgo(e.time)}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="rules-section">
        <button className="section-toggle" onClick={toggleRules} aria-expanded={rulesOpen}>
          <span className="chev" aria-hidden="true">
            {rulesOpen ? '▾' : '▸'}
          </span>
          House rules
          <span className="count">{s.constraints.length}</span>
          {!rulesOpen && brokenCount > 0 && <span className="k violated">· {brokenCount} broken</span>}
        </button>
        {rulesOpen && (
          <div className="rules-body">
            {s.constraints.length > 0 && <RuleSummary />}
            {s.constraints.length === 0 && (
              <p className="feed-empty">
                Rules like “keep the exes apart” live here — add one below, or just tell your agent.
              </p>
            )}
            {s.constraints.map((c) => {
              const status = constraintStatus(s, c)
              const statusText = status === 'ok' ? 'kept' : status === 'violated' ? 'broken' : 'waiting — someone is unseated'
              return (
                <div className="constraint-row" key={c.id}>
                  <span className={`status ${status}`} title={statusText} aria-label={statusText} role="img" />
                  <span className="text">
                    {constraintText(s, c)}
                    {c.note && <span className="note">{c.note}</span>}
                  </span>
                  <button
                    className="remove"
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
            <hr className="rule" />
            <AddRule />
          </div>
        )}
      </section>
    </aside>
  )
}
