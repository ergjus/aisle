import { useEffect, useMemo, useRef } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '../store'
import { toolCatalog, type CatalogEntry } from '../webmcp/tools'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

/**
 * Display grouping for the toolbox page. Tools missing from every list (added
 * later by anyone) fall through to a trailing "More tools" section, so this
 * page can never silently hide a tool.
 */
const GROUPS: { title: string; blurb: string; names: string[] }[] = [
  {
    title: 'Talking to you',
    blurb: 'The agent narrates, asks, and points — so the work is a conversation, not a flicker.',
    names: ['share_plan', 'ask_human', 'point_at', 'wrap_up'],
  },
  {
    title: 'Reading the room',
    blurb: 'How the agent sees what you see — no changes, just eyes.',
    names: ['get_seating_chart', 'get_recent_activity', 'list_guests', 'list_unseated', 'list_constraints', 'list_violations', 'explain_seating'],
  },
  {
    title: 'The guest list',
    blurb: 'Who is coming, in which party, and what the kitchen should know.',
    names: ['add_guest', 'update_guest', 'remove_guest', 'import_guests'],
  },
  {
    title: 'The venue',
    blurb: 'Room size in real feet, amenities placed and sized, tables arranged.',
    names: ['update_venue_dimensions', 'update_venue', 'add_table', 'update_table', 'remove_table'],
  },
  {
    title: 'Seating the room',
    blurb: 'Moving people — one chair at a time or the whole room at once. Your pins are law.',
    names: ['seat_guest', 'unseat_guest', 'swap_guests', 'pin_guest', 'unpin_guest', 'auto_arrange', 'propose_arrangement', 'clear_seating'],
  },
  {
    title: 'Safety nets',
    blurb: 'Bold moves without fear — the same undo you have, save points, and a reset that insists on being asked.',
    names: ['undo', 'redo', 'save_checkpoint', 'restore_checkpoint', 'reset_chart'],
  },
  {
    title: 'House rules',
    blurb: 'Keep the couple together and the exes apart; the solver obeys.',
    names: ['add_constraint', 'remove_constraint'],
  },
  {
    title: 'The deliverable',
    blurb: 'The agent composes the printed seating document; you press Print.',
    names: ['export_chart', 'get_chart_document', 'finalize_chart'],
  },
  {
    title: 'Demo',
    blurb: 'A ready-made wedding to play with.',
    names: ['load_sample_wedding'],
  },
]

/** Things to say to an agent that is looking at this page — each one exercises a different corner of the toolset. */
const PROMPTS: { say: string; shows: string }[] = [
  { say: 'Seat everyone. Keep the exes apart and put Grandma far from the band.', shows: 'auto_arrange, share_plan' },
  { say: 'Why is Diane at that table?', shows: 'explain_seating' },
  { say: 'Propose a bolder arrangement and let me decide.', shows: 'propose_arrangement waits for your Keep / Revert' },
  { say: 'Ask me which side the Pembertons should sit on before you move them.', shows: 'ask_human blocks on your answer' },
  { say: 'What did I change since you last looked? Fix anything I broke, moving as few people as possible.', shows: 'get_recent_activity, auto_arrange repair' },
  { say: 'Keep Rosa exactly where I put her, then reseat the rest of the room.', shows: 'pin_guest, then auto_arrange around the pin' },
  { say: 'Show me which table is under the speakers.', shows: 'point_at' },
  { say: 'Prepare the printed seating document — title it June & Ravi.', shows: 'export_chart opens the print studio, composed' },
]

const GATE_NOTES: Record<CatalogEntry['requires'], { locked: string; open: string } | null> = {
  always: null,
  tables: { locked: 'Appears once the room has a table', open: 'Available — the room has tables' },
  content: { locked: 'Appears once the chart has guests or tables', open: 'Available — there is something to export' },
  perfect: { locked: 'Appears when everyone is seated and no rule is broken', open: 'Unlocked — the chart is perfect' },
}

function ToolCard({ entry }: { entry: CatalogEntry }) {
  const gate = GATE_NOTES[entry.requires]
  return (
    <article
      className={cn(
        'rounded-md border bg-card p-4',
        entry.requires === 'perfect' && 'border-gold/60',
        !entry.available && 'border-dashed bg-card/50',
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <code className={cn('font-mono text-[13px] font-semibold tracking-tight text-pine-800', !entry.available && 'text-ink-soft')}>
          {entry.name}
        </code>
        <span
          className={cn(
            'figures rounded-[3px] px-1.5 py-0.5 text-[11px] font-medium',
            entry.readOnly ? 'bg-sage/12 text-sage' : 'bg-gold/15 text-gold-ink',
          )}
        >
          {entry.readOnly ? 'read-only' : 'changes the chart'}
        </span>
      </div>
      {gate && (
        <p className={cn('mt-1 text-[11px] font-semibold', entry.available ? 'text-sage' : 'text-ink-faint italic')}>
          {entry.available ? gate.open : gate.locked}
        </p>
      )}
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-soft">{entry.description}</p>
      {entry.params.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {entry.params.map((p) => (
            <span
              key={p.name}
              title={p.description || undefined}
              className={cn(
                'cursor-help rounded-[3px] border px-1.5 py-0.5 font-mono text-[11.5px] font-medium',
                p.required ? 'border-gold/70 bg-gold/10 text-gold-ink' : 'border-hairline bg-parchment/60 text-ink-soft',
              )}
            >
              {p.name}
              {p.required && '*'}
            </span>
          ))}
        </div>
      )}
    </article>
  )
}

export function ToolsPage({ onClose }: { onClose: () => void }) {
  const { webmcpAvailable, agentConnected, toolNames } = useStore(useShallow((state) => ({
    webmcpAvailable: state.webmcpAvailable,
    agentConnected: state.agentConnected,
    toolNames: state.toolNames,
  })))
  const pageRef = useRef<HTMLDivElement>(null)

  // toolNames changes whenever gating flips, so the catalog stays live.
  const catalog = useMemo(() => toolCatalog(), [toolNames])

  const grouped = useMemo(() => {
    const byName = new Map(catalog.map((e) => [e.name, e]))
    const placed = new Set<string>()
    const sections = GROUPS.map((g) => ({
      ...g,
      entries: g.names
        .map((n) => {
          placed.add(n)
          return byName.get(n)
        })
        .filter(Boolean) as CatalogEntry[],
    })).filter((g) => g.entries.length > 0)
    const rest = catalog.filter((e) => !placed.has(e.name))
    if (rest.length > 0) {
      sections.push({ title: 'More tools', blurb: 'Recent additions not yet sorted above.', names: [], entries: rest })
    }
    return sections
  }, [catalog])

  useEffect(() => {
    pageRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const liveCount = catalog.filter((e) => e.available).length

  return (
    <div
      ref={pageRef}
      tabIndex={-1}
      className="animate-in fade-in fixed inset-0 z-[100] overflow-y-auto bg-ivory outline-none duration-150"
      role="dialog"
      aria-modal="true"
      aria-label="The agent's toolbox"
    >
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-hairline bg-ivory/95 px-5 py-2 backdrop-blur">
        <Button variant="ghost" size="sm" onClick={onClose}>
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Back to the room
        </Button>
        <div className="flex-1" />
        <span className="inline-flex items-center gap-1.5 rounded-[3px] border bg-card px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-ink-soft">
          <span
            className={cn(
              'h-2 w-2 rounded-full',
              agentConnected ? 'bg-gold animate-pulse' : webmcpAvailable ? 'bg-ok' : 'bg-ink-faint',
            )}
          />
          {agentConnected
            ? 'Agent at the table'
            : webmcpAvailable
              ? 'WebMCP ready — waiting for an agent'
              : 'WebMCP not detected in this browser'}
        </span>
      </header>

      <main className="mx-auto max-w-5xl px-5 pt-10 pb-16">
        <p className="smallcaps text-[14px] text-gold-ink">Aisle · WebMCP reference</p>
        <h1 className="mt-1 font-serif text-[42px] leading-tight font-semibold tracking-wide">
          <span className="mr-2 text-[30px] text-gold">❦</span>The Agent&rsquo;s Toolbox
        </h1>
        <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-ink-soft">
          The moment this page loads, it registers these tools with your browser via{' '}
          <span className="font-semibold text-ink">WebMCP</span> — so an AI agent can plan the wedding with you, on the
          same chart, in real time. Every move it makes is performed in the open: the gold cursor walks the floor, chips
          glide to their chairs, and each step lands in the activity log where you can undo it.
        </p>
        <p className="figures mt-2 text-[12px] text-ink-soft">
          {liveCount} of {catalog.length} tools live right now · hover a{' '}
          <span className="rounded-[3px] border border-hairline bg-parchment/60 px-1.5 py-px text-[11px] font-medium text-ink-soft">
            parameter
          </span>{' '}
          to see what it takes · * means required
        </p>

        <section className="mt-9 rounded-md border border-hairline bg-card/70 p-5">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <h2 className="font-serif text-[24px] font-semibold tracking-wide">Things to try saying</h2>
            <p className="text-[12.5px] text-ink-soft italic">Each one reaches a different corner of the toolset.</p>
          </div>
          <ul className="mt-3 grid gap-x-6 gap-y-2 md:grid-cols-2">
            {PROMPTS.map((p) => (
              <li key={p.say} className="flex flex-col gap-0.5 border-t border-hairline/70 pt-2">
                <span className="font-heading text-[15px] leading-snug text-ink">“{p.say}”</span>
                <span className="figures text-[11.5px] text-ink-faint">→ {p.shows}</span>
              </li>
            ))}
          </ul>
        </section>

        {grouped.map((section) => (
          <section key={section.title} className="mt-9">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <h2 className="font-serif text-[24px] font-semibold tracking-wide">{section.title}</h2>
              <p className="text-[12.5px] text-ink-soft italic">{section.blurb}</p>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {section.entries.map((entry) => (
                <ToolCard key={entry.name} entry={entry} />
              ))}
            </div>
          </section>
        ))}

        <footer className="mt-12 rounded-md border border-hairline bg-parchment/50 p-4 text-[12px] leading-relaxed text-ink-soft">
          <p className="smallcaps text-[14px] text-ink-soft">No agent handy?</p>
          <p className="mt-1">
            The same tools answer from this page&rsquo;s console:{' '}
            <code className="rounded bg-pine-950 px-1.5 py-0.5 font-mono text-[11px] text-linen">
              aisle.call('auto_arrange', {'{'}mode: 'full'{'}'})
            </code>{' '}
            — or list them all with{' '}
            <code className="rounded bg-pine-950 px-1.5 py-0.5 font-mono text-[11px] text-linen">aisle.tools()</code>.
          </p>
        </footer>
      </main>
    </div>
  )
}
