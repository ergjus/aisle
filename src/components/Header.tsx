import { useStore } from '../store'
import { computeViolations, dramaScore } from '../constraints'
import { chartMarkdown, downloadText } from '../utils'
import { SAMPLE } from '../sample'
import { seatEveryone } from '../actions'
import { DramaMeter } from './DramaMeter'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

export function Header() {
  const s = useStore()
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

  return (
    <header className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-b border-hairline bg-ivory px-4 py-2">
      <h1 className="font-serif text-[28px] leading-none font-semibold tracking-wide">
        <span className="mr-1 text-[21px] text-gold">❦</span>Aisle
      </h1>
      <DramaMeter score={score} broken={violations.length} />
      <div className="min-w-2 flex-1" />
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-ink-soft"
          title="This page registers its seating tools with your browser via WebMCP (navigator.modelContext), so an AI agent can work the chart with you."
        >
          <span className={cn('h-2 w-2 rounded-full', badge.dot)} />
          {badge.text}
        </span>
        <Button
          variant={empty ? 'default' : 'outline'}
          size="sm"
          onClick={loadSample}
          title="72 guests, 10 tables, 17 seating rules — instant demo wedding"
        >
          Load Sample Wedding
        </Button>
        <Button
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
          variant="outline"
          size="sm"
          onClick={() => downloadText('seating-chart.md', chartMarkdown(s))}
          disabled={s.guestOrder.length === 0}
          title="Download the chart as a per-table Markdown list with dietary summary"
        >
          Export List
        </Button>
      </div>
    </header>
  )
}
