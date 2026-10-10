import { useMemo, type ReactNode } from 'react'
import { ArrowRight, Check, FileSpreadsheet, LayoutTemplate, Sparkles, Wand2 } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { selectCore, useStore } from '../store'
import { computeViolations } from '../constraints'
import { formatFeet } from '../geometry'
import { SAMPLE } from '../sample'
import { seatEveryone } from '../actions'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

/** The sidebar section the floor plan should open on. Mirrors the ids in Sidebar. */
export type PlanSection = 'venue' | 'tables' | 'guests' | 'rules' | 'activity'

/** A time, as the activity list prints it: "just now", "4 min ago", "yesterday". */
function ago(time: number, now = Date.now()): string {
  const minutes = Math.round((now - time) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return days === 1 ? 'yesterday' : `${days} days ago`
}

/** "In 212 days", "Tomorrow", "Today", or nothing when the date doesn't parse. */
export function countdown(date: string, now = new Date()): string | null {
  const text = date.trim()
  if (!text) return null
  const parsed = new Date(text)
  if (Number.isNaN(parsed.getTime())) return null
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const target = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate())
  const days = Math.round((target.getTime() - start.getTime()) / 86_400_000)
  if (days < 0) return days === -1 ? 'Yesterday' : `${-days} days ago`
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days < 14) return `In ${days} days`
  const weeks = Math.round(days / 7)
  return weeks < 9 ? `In ${weeks} weeks` : `In ${days} days`
}

function EventField({
  label,
  value,
  placeholder,
  onChange,
  className,
  fit,
}: {
  label: string
  value: string
  placeholder: string
  onChange: (value: string) => void
  className?: string
  /** Size the field to its text, for fields that sit on one line with others. */
  fit?: boolean
}) {
  return (
    <label className={cn('home-field', className)}>
      <span className="sr-only">{label}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        aria-label={label}
        size={fit ? Math.max(value.length, placeholder.length) + 1 : undefined}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        autoComplete="off"
      />
    </label>
  )
}

function Tile({
  label,
  figure,
  detail,
  tone,
  onOpen,
  children,
}: {
  label: string
  figure: string
  detail: string
  tone?: 'broken' | 'complete'
  onOpen: () => void
  children?: ReactNode
}) {
  return (
    <button type="button" className={cn('home-tile', tone && `home-tile-${tone}`)} onClick={onOpen}>
      <span className="smallcaps home-tile-label">{label}</span>
      <span className="home-tile-figure figures">{figure}</span>
      <span className="home-tile-detail">{detail}</span>
      {children}
    </button>
  )
}

function StartCard({
  icon: Icon,
  title,
  text,
  action,
  onSelect,
}: {
  icon: typeof FileSpreadsheet
  title: string
  text: string
  action: string
  onSelect: () => void
}) {
  return (
    <button type="button" className="home-start" onClick={onSelect}>
      <Icon className="home-start-icon" aria-hidden="true" />
      <span className="home-start-title">{title}</span>
      <span className="home-start-text">{text}</span>
      <span className="home-start-action">
        {action}
        <ArrowRight className="size-3.5" aria-hidden="true" />
      </span>
    </button>
  )
}

/**
 * The home screen: the wedding by name, how far the seating has come, and the
 * doors into the floor plan. A couple opening the app lands here, sees where
 * they left off, and picks up from the thing that needs them — not from a
 * floor plan with three panels open.
 */
export function Home({ onOpenChart }: { onOpenChart: (section?: PlanSection) => void }) {
  const s = useStore(useShallow((state) => ({
    ...selectCore(state),
    event: state.event,
    updateEvent: state.updateEvent,
    agentLog: state.agentLog,
    loadSample: state.loadSample,
    logActivity: state.logActivity,
  })))

  const guestCount = s.guestOrder.length
  const tableCount = s.tableOrder.length
  const empty = guestCount === 0 && tableCount === 0
  const attendingIds = s.guestOrder.filter((id) => s.guests[id].rsvp !== 'no')
  const attending = attendingIds.length
  const declined = guestCount - attending
  const pending = s.guestOrder.filter((id) => s.guests[id].rsvp === 'pending').length
  const seated = attendingIds.filter((id) => Boolean(s.seating[id])).length
  const seats = s.tableOrder.reduce((sum, id) => sum + s.tables[id].seats, 0)
  const violations = useMemo(
    () => computeViolations(s),
    [s.constraints, s.guestOrder, s.guests, s.seating, s.tableOrder, s.tables, s.venue],
  )
  const broken = violations.length
  const complete = attending > 0 && seated === attending && broken === 0
  const share = attending > 0 ? seated / attending : 0
  const recent = s.agentLog.slice(0, 4)
  const yes = s.guestOrder.filter((id) => s.guests[id].rsvp === 'yes').length
  const canArrange = attending > 0 && tableCount > 0
  const groups = s.groupOrder
    .map((name) => ({ name, count: s.guestOrder.filter((id) => s.guests[id].group === name).length }))
    .filter((g) => g.count > 0)
    .sort((a, b) => b.count - a.count)
  const roomSet = Object.values(s.venue).some((f) => f.enabled && f.id !== 'entrance' && f.id !== 'bathroom') || tableCount > 0
  const when = countdown(s.event.date)

  // The road from an empty chart to a printed one, with where this wedding is on it.
  const journey: { label: string; done: boolean; detail: string; section?: PlanSection }[] = [
    { label: 'Guest list', done: guestCount > 0, detail: guestCount > 0 ? `${guestCount} on the list` : 'Paste or import names', section: 'guests' },
    { label: 'Room', done: roomSet, detail: roomSet ? `${formatFeet(s.venueDimensions.widthFt)} × ${formatFeet(s.venueDimensions.lengthFt)}` : 'Size it, add the dance floor', section: 'venue' },
    { label: 'Tables', done: tableCount > 0 && seats >= attending, detail: tableCount > 0 ? `${seats} seats for ${attending}` : 'Place the tables', section: 'tables' },
    { label: 'Rules', done: s.constraints.length > 0 && broken === 0, detail: s.constraints.length === 0 ? 'Who sits with whom' : broken > 0 ? `${broken} broken` : `${s.constraints.length} kept`, section: 'rules' },
    { label: 'Seated', done: attending > 0 && seated === attending, detail: attending === 0 ? 'No one attending yet' : `${seated} of ${attending}` },
    { label: 'Final', done: s.finalized, detail: s.finalized ? 'Marked final' : 'Print when it is done' },
  ]
  const stage = journey.findIndex((step) => !step.done)

  const seeExample = () => {
    s.loadSample(SAMPLE)
    s.logActivity('load sample', 'Loaded the sample wedding: 72 guests, 10 tables, 17 rules.', 'you')
    onOpenChart()
  }

  // What the seating needs next, in one line.
  const next = empty
    ? 'Nothing is on the chart yet.'
    : attending === 0
      ? 'No one is attending yet — add guests, or mark some as coming.'
      : tableCount === 0
        ? 'There are no tables yet — set up the room before seating anyone.'
        : broken > 0
          ? `${broken} rule${broken === 1 ? '' : 's'} broken — Fix moves as few people as possible.`
          : seated < attending
            ? `${attending - seated} guest${attending - seated === 1 ? '' : 's'} still need${attending - seated === 1 ? 's' : ''} a seat.`
            : seats < attending
              ? `Only ${seats} seats for ${attending} guests.`
              : 'Everyone has a seat and every rule is kept.'

  return (
    <main className="home">
      <div className="home-inner">
        <section className="home-event" aria-label="The wedding">
          <p className="smallcaps home-kicker">Seating chart for</p>
          <EventField
            label="Wedding name"
            className="home-field-title"
            value={s.event.title}
            placeholder="Name the wedding"
            onChange={(title) => s.updateEvent({ title })}
          />
          <div className="home-event-line">
            <EventField
              label="Date"
              value={s.event.date}
              placeholder="Add the date"
              fit
              onChange={(date) => s.updateEvent({ date })}
            />
            {when && <span className="home-event-when">{when}</span>}
            <span className="home-event-sep" aria-hidden="true">·</span>
            <EventField
              label="Venue"
              value={s.event.venueName}
              placeholder="Add the venue"
              fit
              onChange={(venueName) => s.updateEvent({ venueName })}
            />
          </div>
        </section>

        {empty ? (
          <section className="home-start-grid" aria-label="Start">
            <StartCard
              icon={FileSpreadsheet}
              title="Add your guest list"
              text="Paste names out of a spreadsheet or a planning site, or type them in one at a time."
              action="Open the guest list"
              onSelect={() => onOpenChart('guests')}
            />
            <StartCard
              icon={LayoutTemplate}
              title="Set up the room"
              text={`Size the room, place the tables, mark the dance floor and the bar. It starts at ${formatFeet(s.venueDimensions.widthFt)} × ${formatFeet(s.venueDimensions.lengthFt)}.`}
              action="Open the room"
              onSelect={() => onOpenChart('venue')}
            />
            <StartCard
              icon={Sparkles}
              title="See an example"
              text="A sample wedding — 72 guests, 10 tables, 17 rules — to try the seating and the agent on before your own list is ready."
              action="Load the sample"
              onSelect={seeExample}
            />
          </section>
        ) : (
          <>
            <section className={cn('home-progress', complete && 'home-progress-complete', broken > 0 && 'home-progress-broken')} aria-label="How the seating stands">
              <div className="home-progress-text">
                <p className="home-progress-headline">
                  <span className="figures">{seated}</span> of <span className="figures">{attending}</span> seated
                </p>
                <p className="home-progress-next">{next}</p>
              </div>
              <div className="home-progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={attending} aria-valuenow={seated} aria-label="Guests seated">
                <span style={{ width: `${Math.round(share * 100)}%` }} />
              </div>
              <div className="home-progress-actions">
                {broken > 0 ? (
                  <Button variant="outline" className="h-9 px-4 text-[13px]" onClick={() => { seatEveryone('repair'); onOpenChart() }} title="Runs the solver in repair mode, moving as few guests as possible">
                    <Wand2 data-icon="inline-start" className="size-4" aria-hidden="true" />
                    Fix the rules
                  </Button>
                ) : canArrange && seated < attending ? (
                  <Button variant="outline" className="h-9 px-4 text-[13px]" onClick={() => { seatEveryone('full'); onOpenChart() }} title="Arranges the whole room automatically, honoring every rule">
                    <Wand2 data-icon="inline-start" className="size-4" aria-hidden="true" />
                    Seat everyone
                  </Button>
                ) : null}
                <Button className="h-9 px-4 text-[13px] font-semibold" onClick={() => onOpenChart()}>
                  Open the floor plan
                  <ArrowRight data-icon="inline-end" className="size-4" aria-hidden="true" />
                </Button>
              </div>
            </section>

            <ol className="home-journey" aria-label="Where things stand">
              {journey.map((step, i) => (
                <li key={step.label} className={cn('home-journey-step', step.done && 'home-journey-done', i === stage && 'home-journey-now')}>
                  {step.section ? (
                    <button type="button" onClick={() => onOpenChart(step.section)}>
                      <span className="home-journey-mark" aria-hidden="true">{step.done ? <Check /> : i + 1}</span>
                      <span className="home-journey-label">{step.label}</span>
                      <span className="home-journey-detail">{step.detail}</span>
                    </button>
                  ) : (
                    <div>
                      <span className="home-journey-mark" aria-hidden="true">{step.done ? <Check /> : i + 1}</span>
                      <span className="home-journey-label">{step.label}</span>
                      <span className="home-journey-detail">{step.detail}</span>
                    </div>
                  )}
                </li>
              ))}
            </ol>

            <section className="home-tiles" aria-label="On the chart">
              <Tile
                label="Guests"
                figure={String(guestCount)}
                detail={
                  pending > 0
                    ? `${pending} still to RSVP${declined > 0 ? `, ${declined} not coming` : ''}`
                    : declined > 0
                      ? `${declined} not coming`
                      : guestCount === 0
                        ? 'None yet'
                        : 'All replied'
                }
                onOpen={() => onOpenChart('guests')}
              >
                {guestCount > 0 && (
                  <>
                    <span className="home-rsvp" role="img" aria-label={`${yes} coming, ${pending} pending, ${declined} not coming`}>
                      <span className="home-rsvp-yes" style={{ width: `${(yes / guestCount) * 100}%` }} />
                      <span className="home-rsvp-pending" style={{ width: `${(pending / guestCount) * 100}%` }} />
                    </span>
                    <span className="home-tile-foot">
                      {groups.length} group{groups.length === 1 ? '' : 's'}
                      {groups.length > 0 && ` · ${groups.slice(0, 3).map((g) => `${g.name} ${g.count}`).join(', ')}${groups.length > 3 ? '…' : ''}`}
                    </span>
                  </>
                )}
              </Tile>
              <Tile
                label="Tables"
                figure={String(tableCount)}
                detail={tableCount === 0 ? 'None yet' : `${seats} seat${seats === 1 ? '' : 's'} for ${attending} guest${attending === 1 ? '' : 's'}`}
                tone={tableCount > 0 && seats < attending ? 'broken' : undefined}
                onOpen={() => onOpenChart('tables')}
              >
                {tableCount > 0 && (
                  <span className="home-tile-foot">
                    {seats - seated > 0 ? `${seats - seated} seats free` : 'Every seat taken'}
                    {Object.keys(s.pinned).length > 0 && ` · ${Object.keys(s.pinned).length} pinned`}
                  </span>
                )}
              </Tile>
              <Tile
                label="Rules"
                figure={String(s.constraints.length)}
                detail={broken > 0 ? `${broken} broken` : s.constraints.length === 0 ? 'None yet' : 'All kept'}
                tone={broken > 0 ? 'broken' : s.constraints.length > 0 ? 'complete' : undefined}
                onOpen={() => onOpenChart('rules')}
              >
                {s.constraints.length > 0 && (
                  <span className="home-tile-foot">
                    {[
                      [s.constraints.filter((c) => c.type === 'apart').length, 'apart'],
                      [s.constraints.filter((c) => c.type === 'together').length, 'together'],
                      [s.constraints.filter((c) => c.type === 'zone').length, 'near or far'],
                    ].filter(([n]) => Number(n) > 0).map(([n, kind]) => `${n} ${kind}`).join(' · ')}
                  </span>
                )}
              </Tile>
            </section>
          </>
        )}

        {recent.length > 0 && (
          <section className="home-recent" aria-label="Recent changes">
            <div className="home-recent-head">
              <span className="smallcaps home-kicker">Recent changes</span>
              <button type="button" className="home-link" onClick={() => onOpenChart('activity')}>
                All activity
              </button>
            </div>
            <ul>
              {recent.map((entry) => (
                <li key={entry.id}>
                  <span className={cn('home-recent-who', entry.source === 'agent' && 'home-recent-agent')}>
                    {entry.source === 'agent' ? 'Agent' : 'You'}
                  </span>
                  <span className="home-recent-text">{entry.summary}</span>
                  <span className="home-recent-when figures">{ago(entry.time)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  )
}
