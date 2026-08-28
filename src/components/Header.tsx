import { useStore } from '../store'
import { computeViolations, dramaScore } from '../constraints'
import { chartMarkdown, downloadText } from '../utils'
import { SAMPLE } from '../sample'
import { DramaMeter } from './DramaMeter'

export function Header() {
  const s = useStore()
  const violations = computeViolations(s)
  const score = dramaScore(violations)
  const empty = s.guestOrder.length === 0 && s.tableOrder.length === 0

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
      <DramaMeter score={score} />
      <div className="header-spacer" />
      <div className="header-actions">
        <span
          className={badge.cls}
          title="This page registers its seating tools with your browser via WebMCP (navigator.modelContext), so an AI agent can work the chart with you."
        >
          <span className="dot" />
          {badge.text}
        </span>
        <button className={empty ? 'btn btn-gold' : 'btn'} onClick={() => s.loadSample(SAMPLE)}>
          Load sample wedding
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
        >
          Export
        </button>
      </div>
    </header>
  )
}
