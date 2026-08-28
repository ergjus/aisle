import { useState } from 'react'
import { useStore } from '../store'
import { computeViolations, dramaScore } from '../constraints'
import { ToolsPage } from './ToolsPage'
import { ExportDialog } from './ExportDialog'
import { SAMPLE } from '../sample'
import { seatEveryone } from '../actions'
import { DramaMeter } from './DramaMeter'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

export function Header({ onWelcomeGuide }: { onWelcomeGuide: () => void }) {
  const s = useStore()
  const [showTools, setShowTools] = useState(false)
  const violations = computeViolations(s)
  const score = dramaScore(violations)
  const empty = s.guestOrder.length === 0 && s.tableOrder.length === 0
  const attending = s.guestOrder.filter((id) => s.guests[id].rsvp !== 'no')
  const unseated = attending.filter((id) => !s.seating[id]).length
  const canArrange = attending.length > 0 && s.tableOrder.length > 0

  const badge = s.agentConnected
    ? { dot: 'bg-gold animate-pulse', text: `Agent at the table · ${s.toolNames.length} tools` }
    : s.webmcpAvailable
      ? { dot: 'bg-ok', text: `WebMCP · ${s.toolNames.length} tools ready` }
      : { dot: 'bg-ink-faint', text: 'WebMCP not detected' }

  const loadSample = () => {
    s.loadSample(SAMPLE)
    s.logActivity('load sample', 'Loaded the sample wedding: 72 guests, 10 tables, 17 rules.', 'you')
  }

  // The default sample is recognized structurally. A personalized sample uses
  // persisted metadata because its table count and IDs depend on onboarding;
  // structural guest/table edits clear that marker in the store.
  const sampleGuestIds = new Set(SAMPLE.guests.map((g) => g.id))
  const sampleTableIds = new Set(SAMPLE.tables.map((t) => t.id))
  const isDefaultSample =
    s.guestOrder.length === SAMPLE.guests.length &&
    s.tableOrder.length === SAMPLE.tables.length &&
    s.guestOrder.every((id) => sampleGuestIds.has(id)) &&
    s.tableOrder.every((id) => sampleTableIds.has(id))
  const isSample = Boolean(s.demoMetadata) || isDefaultSample

  const removeSample = () => {
    s.resetAll()
    s.logActivity('remove sample', 'Removed the sample wedding.', 'you')
  }

  const reset = () => {
    if (empty) return
    if (!window.confirm('Reset the whole chart? Every guest, table, and rule will be cleared. (You can still Undo right after.)')) return
    s.resetAll()
    s.logActivity('reset', 'Cleared the chart back to empty.', 'you')
  }

  return (
    <header className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-b border-hairline bg-ivory px-4 py-2">
      <h1 className="font-serif text-[28px] leading-none font-semibold tracking-wide">
        <span className="mr-1 text-[21px] text-gold">❦</span>Aisle
      </h1>
      <DramaMeter score={score} broken={violations.length} />
      <div className="min-w-2 flex-1" />
      <div className="flex flex-wrap items-center gap-2">
        <Button data-tour="welcome-guide" variant="ghost" size="sm" onClick={onWelcomeGuide}>
          Welcome guide
        </Button>
        <button
          data-tour="webmcp-badge"
          className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-ink-soft transition-colors hover:border-gold hover:bg-accent"
          title="This page registers its seating tools with your browser via WebMCP (navigator.modelContext), so an AI agent can work the chart with you. Click to browse every tool."
          onClick={() => setShowTools(true)}
        >
          <span className={cn('h-2 w-2 rounded-full', badge.dot)} />
          {badge.text}
          <span aria-hidden="true" className="text-ink-faint">›</span>
        </button>
        <Button
          variant={isSample ? 'outline' : empty ? 'default' : 'outline'}
          size="sm"
          onClick={isSample ? removeSample : loadSample}
          title={isSample ? 'Clear the demo wedding back to an empty room' : '72 guests, 10 tables, 17 seating rules — instant demo wedding'}
        >
          {isSample ? 'Remove Sample Wedding' : 'Load Sample Wedding'}
        </Button>
        <Button
          data-tour="seat-everyone"
          variant={!empty && unseated > 0 && violations.length === 0 ? 'default' : 'outline'}
          size="sm"
          onClick={() => seatEveryone('full')}
          disabled={!canArrange}
          title="Arrange the whole room automatically, honoring every rule — the same engine your agent uses"
        >
          Seat Everyone
        </Button>
        <Button variant="ghost" size="sm" onClick={() => s.undo()} disabled={s.undoStack.length === 0} title="Undo (⌘Z)">
          Undo
        </Button>
        <Button variant="ghost" size="sm" onClick={() => s.redo()} disabled={s.redoStack.length === 0} title="Redo (⇧⌘Z)">
          Redo
        </Button>
        <Button
          data-tour="export"
          variant="outline"
          size="sm"
          onClick={() => s.requestExport()}
          disabled={empty}
          title="A print-ready seating document — floor plan, table charts, guest directory, catering notes — plus Markdown and CSV"
        >
          Export…
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="text-brick hover:bg-destructive/10 hover:text-brick"
          onClick={reset}
          disabled={empty}
          title="Clear every guest, table, and rule and start from an empty room"
        >
          Reset
        </Button>
      </div>
      {showTools && <ToolsPage onClose={() => setShowTools(false)} />}
      {s.exportOpen && <ExportDialog onClose={() => s.setExportOpen(false)} />}
    </header>
  )
}
