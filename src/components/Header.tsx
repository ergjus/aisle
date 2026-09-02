import { useEffect, useState } from 'react'
import { Printer } from 'lucide-react'
import { useStore } from '../store'
import { computeViolations, dramaScore } from '../constraints'
import { formatFeet } from '../geometry'
import { ToolsPage } from './ToolsPage'
import { ExportDialog } from './ExportDialog'
import { SAMPLE } from '../sample'
import { seatEveryone } from '../actions'
import { DramaMeter } from './DramaMeter'
import { HeaderMenu, type MenuEntry } from './HeaderMenu'
import { ShortcutsDialog } from './ShortcutsDialog'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

/**
 * The masthead. Reads like the top of a printed program — the wordmark, a
 * dateline of what is on the chart, the drama gauge — with the agent's place
 * card and a single primary action on the right. Everything rarely pressed
 * lives behind the ⋯ menu.
 */
export function Header({ onWelcomeGuide }: { onWelcomeGuide: () => void }) {
  const s = useStore()
  const [showTools, setShowTools] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const violations = computeViolations(s)
  const score = dramaScore(violations)
  const empty = s.guestOrder.length === 0 && s.tableOrder.length === 0
  const attending = s.guestOrder.filter((id) => s.guests[id].rsvp !== 'no')
  const canArrange = attending.length > 0 && s.tableOrder.length > 0

  // "?" opens the shortcut sheet from anywhere that isn't a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?' || e.metaKey || e.ctrlKey || e.altKey) return
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement)?.isContentEditable) return
      e.preventDefault()
      setShowShortcuts((v) => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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

  const menu: MenuEntry[] = [
    isSample
      ? { label: 'Remove the sample wedding', onSelect: removeSample }
      : { label: 'Load the sample wedding', hint: '72 guests', onSelect: loadSample },
    { label: 'Welcome guide', onSelect: onWelcomeGuide },
    { label: 'Keyboard & gestures', hint: '?', onSelect: () => setShowShortcuts(true) },
    'separator',
    { label: 'Reset the chart…', onSelect: reset, danger: true, disabled: empty },
  ]

  const dateline = empty
    ? `An empty room · ${formatFeet(s.venueDimensions.widthFt)} × ${formatFeet(s.venueDimensions.lengthFt)}`
    : `${s.guestOrder.length} guests · ${s.tableOrder.length} table${s.tableOrder.length === 1 ? '' : 's'} · ${s.constraints.length} rule${s.constraints.length === 1 ? '' : 's'}`

  return (
    <header className="masthead">
      <div className="flex min-w-0 items-center gap-4">
        <h1 className="masthead-wordmark">
          <span className="masthead-fleuron" aria-hidden="true">❦</span>
          Aisle
        </h1>
        <div className="masthead-rule" aria-hidden="true" />
        <div className="hidden min-w-0 flex-col leading-none lg:flex">
          <span className="smallcaps text-[13px] text-ink-soft">On the chart</span>
          <span className="figures mt-0.5 truncate text-[12px] text-ink-soft">{dateline}</span>
        </div>
        <div className="masthead-rule hidden lg:block" aria-hidden="true" />
        <DramaMeter score={score} broken={violations.length} />
      </div>

      <div className="min-w-2 flex-1" />

      <div className="flex items-center gap-2.5">
        <AgentPlacecard onClick={() => setShowTools(true)} />
        <Button
          data-tour="seat-everyone"
          size="sm"
          className="h-8 px-3.5 text-[12.5px] font-semibold shadow-[0_1px_0_rgba(255,255,255,0.08)_inset,0_6px_14px_-8px_rgba(20,31,24,0.6)]"
          onClick={() => seatEveryone('full')}
          disabled={!canArrange}
          title="Arrange the whole room automatically, honoring every rule — the same engine your agent uses"
        >
          Seat everyone
        </Button>
        <div className="masthead-icongroup" role="group" aria-label="History">
          <button type="button" onClick={() => s.undo()} disabled={s.undoStack.length === 0} title="Undo (⌘Z)" aria-label="Undo">
            <span aria-hidden="true">↶</span>
          </button>
          <button type="button" onClick={() => s.redo()} disabled={s.redoStack.length === 0} title="Redo (⇧⌘Z)" aria-label="Redo">
            <span aria-hidden="true">↷</span>
          </button>
        </div>
        <Button
          data-tour="export"
          variant="outline"
          size="sm"
          className="h-8 rounded-md px-3 text-[12.5px]"
          onClick={() => s.requestExport()}
          disabled={empty}
          title="A print-ready seating document — floor plan, table charts, guest directory, catering notes — plus Markdown and CSV"
        >
          <Printer data-icon="inline-start" className="size-3.5" aria-hidden="true" />
          Print…
        </Button>
        <HeaderMenu entries={menu} />
      </div>

      {showTools && <ToolsPage onClose={() => setShowTools(false)} />}
      {s.exportOpen && <ExportDialog onClose={() => s.setExportOpen(false)} />}
      <ShortcutsDialog open={showShortcuts} onOpenChange={setShowShortcuts} />
    </header>
  )
}

/**
 * The agent's place card — a seat set for it at the table. Lit gold while an
 * agent is working the chart, sage while WebMCP is ready and waiting, plain
 * when the browser has no agent surface at all. Click to open the toolbox.
 */
function AgentPlacecard({ onClick }: { onClick: () => void }) {
  const agentConnected = useStore((s) => s.agentConnected)
  const webmcpAvailable = useStore((s) => s.webmcpAvailable)
  const toolCount = useStore((s) => s.toolNames.length)

  const card = agentConnected
    ? { tone: 'live', name: 'The agent', meta: `at the table · ${toolCount} tools` }
    : webmcpAvailable
      ? { tone: 'ready', name: 'A seat for your agent', meta: `${toolCount} tools laid out · WebMCP ready` }
      : { tone: 'quiet', name: 'A seat for your agent', meta: `${toolCount} tools · no WebMCP in this browser` }

  return (
    <button
      type="button"
      data-tour="webmcp-badge"
      className={cn('placecard', `placecard-${card.tone}`)}
      title="This page registers its seating tools with your browser via WebMCP (navigator.modelContext), so an AI agent can work the chart with you. Click to browse every tool."
      onClick={onClick}
    >
      <span className="placecard-dot" aria-hidden="true" />
      <span className="flex min-w-0 flex-col items-start leading-none">
        <span className="placecard-name">{card.name}</span>
        <span className="placecard-meta">{card.meta}</span>
      </span>
    </button>
  )
}
