import { useStore } from '../store'
import { computeViolations, dramaScore } from '../constraints'
import { chartMarkdown, downloadText } from '../utils'
import { SAMPLE } from '../sample'
import { seatEveryone } from '../actions'
import { DramaMeter } from './DramaMeter'

export function Header() {
  const s = useStore()
  const violations = computeViolations(s)
  const score = dramaScore(violations)
  const empty = s.guestOrder.length === 0 && s.tableOrder.length === 0
  const attending = s.guestOrder.filter((id) => s.guests[id].rsvp !== 'no')
  const unseated = attending.filter((id) => !s.seating[id]).length
  const canArrange = attending.length > 0 && s.tableOrder.length > 0

  const badge = s.agentConnected
    ? { cls: 'mcp-badge agent', text: `Agent at the table · ${s.toolNames.length} tools` }
    : s.webmcpAvailable
      ? { cls: 'mcp-badge live', text: `WebMCP · ${s.toolNames.length} tools ready` }
      : { cls: 'mcp-badge', text: 'WebMCP not detected' }

  return (
    <header className="header">
      <div className="brand">
        <h1>
          <span className="fleuron">❦</span>Aisle
        </h1>
        <span className="tagline">plan the room together</span>
      </div>
      <DramaMeter score={score} broken={violations.length} />
      <div className="header-spacer" />
      <div className="header-actions">
        <span
          className={badge.cls}
          title="This page registers its seating tools with your browser via WebMCP (navigator.modelContext), so an AI agent can work the chart with you."
        >
          <span className="dot" />
          {badge.text}
        </span>
        <button
          className={empty ? 'btn btn-gold' : 'btn'}
          onClick={() => s.loadSample(SAMPLE)}
          title="72 guests, 10 tables, 17 seating rules — instant demo wedding"
        >
          Load Sample Wedding
        </button>
        <button
          className={!empty && unseated > 0 && violations.length === 0 ? 'btn btn-gold' : 'btn'}
          onClick={() => seatEveryone('full')}
          disabled={!canArrange}
          title="Arrange the whole room automatically, honoring every rule — the same engine your agent uses"
        >
          Seat Everyone
        </button>
        <button className="btn btn-quiet" onClick={() => s.undo()} disabled={s.undoStack.length === 0} title="Undo (⌘Z)">
          Undo
        </button>
        <button className="btn btn-quiet" onClick={() => s.redo()} disabled={s.redoStack.length === 0} title="Redo (⇧⌘Z)">
          Redo
        </button>
        <button
          className="btn"
          onClick={() => downloadText('seating-chart.md', chartMarkdown(s))}
          disabled={s.guestOrder.length === 0}
          title="Download the chart as a per-table Markdown list with dietary summary"
        >
          Export List
        </button>
      </div>
    </header>
  )
}
