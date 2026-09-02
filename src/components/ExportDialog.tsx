import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Printer } from 'lucide-react'
import { getCore, useStore } from '../store'
import { computeViolations } from '../constraints'
import { formatFeet } from '../geometry'
import { chartMarkdown, downloadText } from '../utils'
import {
  PAGE_PX,
  availableSections,
  buildDocModel,
  chartCSV,
  exportFileName,
  type ExportOptions,
  type ExportSections,
  type PaperSize,
} from '../export/model'
import { ExportPages } from '../export/ExportPages'
import { loadExportOptions, saveExportOptions } from '../export/options'
import '../export/export.css'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/**
 * The export studio: compose a print-ready seating document (floor plan,
 * table charts, directory, catering notes) with a live page preview, then
 * hand it to the browser's print pipeline — which is also how it becomes a
 * PDF. Markdown and CSV ride along as flat data formats.
 */
export function ExportDialog({ onClose }: { onClose: () => void }) {
  const s = useStore()
  const core = useMemo(() => getCore(), [s])
  const [options, setOptionsState] = useState(loadExportOptions)
  const setOptions = (next: ExportOptions) => {
    setOptionsState(next)
    saveExportOptions(next)
  }

  // The agent's export_chart tool writes options then bumps exportRequest —
  // reload so an already-open dialog reflects what the agent just composed.
  useEffect(() => {
    setOptionsState(loadExportOptions())
  }, [s.exportRequest])

  const avail = useMemo(() => availableSections(core), [core])
  const model = useMemo(() => buildDocModel(core, options), [core, options])
  const violations = useMemo(() => computeViolations(core), [core])
  const stats = model.stats

  // While the dialog is open, printing the page prints the export document.
  useEffect(() => {
    document.body.classList.add('aisle-export-printing')
    return () => document.body.classList.remove('aisle-export-printing')
  }, [])

  // The preview shows the real pages, uniformly scaled to the pane's width.
  // A callback ref (not an effect) because the dialog body mounts through a
  // portal after this component's effects have already run.
  const [previewW, setPreviewW] = useState(0)
  const previewObserver = useRef<ResizeObserver | null>(null)
  const previewRef = (el: HTMLDivElement | null) => {
    previewObserver.current?.disconnect()
    previewObserver.current = null
    if (!el) return
    const ro = new ResizeObserver(() => setPreviewW(el.clientWidth))
    ro.observe(el)
    previewObserver.current = ro
    setPreviewW(el.clientWidth)
  }

  const page = PAGE_PX[options.paper]
  const scale = previewW > 0 ? Math.min(1, previewW / page.w) : 0

  const setSection = (key: keyof ExportSections, value: boolean) =>
    setOptions({ ...options, sections: { ...options.sections, [key]: value } })

  const includedSummary = () => {
    const names: Record<keyof ExportSections, string> = {
      floorPlan: 'floor plan',
      tables: 'table charts',
      directory: 'guest directory',
      catering: 'catering notes',
    }
    return (Object.keys(names) as (keyof ExportSections)[])
      .filter((k) => options.sections[k] && avail[k])
      .map((k) => names[k])
      .join(', ')
  }

  const handlePrint = () => {
    // Browsers name the saved PDF after the document title.
    const previous = document.title
    document.title = `${model.displayTitle} — Seating`
    const restore = () => {
      document.title = previous
    }
    window.addEventListener('afterprint', restore, { once: true })
    window.setTimeout(restore, 60_000)
    s.logActivity('export', `Prepared the printable seating document (${includedSummary()}).`, 'you')
    // Two frames: let the hidden print pages commit before the print snapshot.
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()))
  }

  const handleMarkdown = () => {
    downloadText(exportFileName(model.displayTitle, 'md'), chartMarkdown(core))
    s.logActivity('export', 'Downloaded the chart as Markdown.', 'you')
  }

  const handleCsv = () => {
    downloadText(exportFileName(model.displayTitle, 'csv'), chartCSV(core), 'text/csv')
    s.logActivity('export', 'Downloaded the guest list as CSV.', 'you')
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[min(780px,94vh)] w-[min(1100px,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden rounded-lg p-0 sm:max-w-none">
        <DialogHeader className="border-b border-hairline px-6 py-4">
          <DialogTitle className="text-[20px]">Export the chart</DialogTitle>
          <DialogDescription>
            A print-ready seating document with the Aisle look — save it as a PDF or send it straight to paper.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[304px_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col border-b border-hairline md:border-r md:border-b-0">
            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
              <section className="space-y-1">
                <h3 className="mb-2 text-[11px] font-bold tracking-[0.12em] text-ink-soft uppercase">In the document</h3>
                <SectionRow
                  label="Floor plan"
                  caption={
                    avail.floorPlan
                      ? `To scale · ${formatFeet(core.venueDimensions.widthFt)} × ${formatFeet(core.venueDimensions.lengthFt)} · ${stats.tables} tables`
                      : 'Add a table or an amenity first'
                  }
                  checked={options.sections.floorPlan}
                  disabled={!avail.floorPlan}
                  onChange={(v) => setSection('floorPlan', v)}
                />
                <SectionRow
                  label="Seating by table"
                  caption={avail.tables ? `${stats.tables} tables · ${stats.seated} of ${stats.attending} seated` : 'Add a table first'}
                  checked={options.sections.tables}
                  disabled={!avail.tables}
                  onChange={(v) => setSection('tables', v)}
                />
                <SectionRow
                  label="Guest directory"
                  caption={avail.directory ? `${stats.attending} attending guests, A to Z` : 'Add guests first'}
                  checked={options.sections.directory}
                  disabled={!avail.directory}
                  onChange={(v) => setSection('directory', v)}
                />
                <SectionRow
                  label="Catering & dietary"
                  caption={
                    avail.catering
                      ? stats.dietaryCount > 0
                        ? `${stats.dietaryCount} guests with dietary notes`
                        : 'Headcounts only — no dietary notes yet'
                      : 'Add guests first'
                  }
                  checked={options.sections.catering}
                  disabled={!avail.catering}
                  onChange={(v) => setSection('catering', v)}
                />
              </section>

              <section className="space-y-3">
                <h3 className="text-[11px] font-bold tracking-[0.12em] text-ink-soft uppercase">On the masthead</h3>
                <div className="space-y-1.5">
                  <Label htmlFor="export-title">Event title</Label>
                  <Input
                    id="export-title"
                    value={options.eventTitle}
                    placeholder="e.g. June & Ravi"
                    maxLength={80}
                    onChange={(e) => setOptions({ ...options, eventTitle: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="export-date">Date</Label>
                  <Input
                    id="export-date"
                    value={options.eventDate}
                    placeholder="e.g. Saturday, June 14, 2026"
                    maxLength={60}
                    onChange={(e) => setOptions({ ...options, eventDate: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="export-venue">Venue</Label>
                  <Input
                    id="export-venue"
                    value={options.venueName}
                    placeholder="e.g. The Orchard House"
                    maxLength={60}
                    onChange={(e) => setOptions({ ...options, venueName: e.target.value })}
                  />
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="text-[11px] font-bold tracking-[0.12em] text-ink-soft uppercase">Paper</h3>
                <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-card p-1" role="radiogroup" aria-label="Paper size">
                  {(
                    [
                      ['letter', 'Letter'],
                      ['a4', 'A4'],
                    ] as [PaperSize, string][]
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={options.paper === value}
                      className={cn(
                        'rounded-md px-2 py-1 text-xs font-medium transition-colors',
                        options.paper === value
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:bg-accent hover:text-primary',
                      )}
                      onClick={() => setOptions({ ...options, paper: value })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </section>

              {(stats.unseated > 0 || violations.length > 0) && (
                <section className="space-y-1.5 rounded-lg bg-secondary/60 px-3 py-2.5 text-xs text-ink-soft">
                  {stats.unseated > 0 && (
                    <p>
                      {stats.unseated} attending guest{stats.unseated === 1 ? ' is' : 's are'} not seated yet — they'll
                      appear under “Not yet seated.”
                    </p>
                  )}
                  {violations.length > 0 && (
                    <p className="text-brick">
                      {violations.length} seating rule{violations.length === 1 ? ' is' : 's are'} still broken; the
                      document prints as-is.
                    </p>
                  )}
                </section>
              )}
            </div>

            <div className="space-y-3 border-t border-hairline px-6 py-4">
              <Button className="w-full" onClick={handlePrint} disabled={model.pages.length === 0}>
                <Printer data-icon="inline-start" /> Print · Save as PDF
              </Button>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Data formats</span>
                <span className="flex gap-1">
                  <Button variant="ghost" size="xs" onClick={handleMarkdown} disabled={core.guestOrder.length === 0}>
                    Markdown
                  </Button>
                  <Button variant="ghost" size="xs" onClick={handleCsv} disabled={core.guestOrder.length === 0}>
                    CSV
                  </Button>
                </span>
              </div>
            </div>
          </aside>

          <div className="min-h-0 overflow-y-auto bg-pine-900 px-6 py-5">
            <p className="mb-3 text-center text-[11px] font-semibold tracking-[0.14em] text-linen-dim uppercase">
              {model.pages.length === 0
                ? 'Nothing selected'
                : `${model.pages.length} page${model.pages.length === 1 ? '' : 's'} · ${options.paper === 'a4' ? 'A4' : 'Letter'}`}
            </p>
            <div ref={previewRef} className="w-full">
              {model.pages.length === 0 ? (
                <p className="mt-16 text-center text-sm text-linen-dim">
                  Tick at least one section on the left to compose the document.
                </p>
              ) : (
                scale > 0 && (
                  <div className="export-preview-stack" style={{ height: model.pages.length * (page.h + 24) * scale }}>
                    <div style={{ width: page.w, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
                      <ExportPages state={core} model={model} idPrefix="pv" />
                    </div>
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      </DialogContent>

      {/* Full-size pages for the browser's print pipeline — hidden on screen. */}
      {model.pages.length > 0 &&
        createPortal(
          <div className="export-print-root" aria-hidden="true">
            <style>{`@page { size: ${options.paper === 'a4' ? 'A4' : 'letter'} portrait; margin: 0; }`}</style>
            <ExportPages state={core} model={model} idPrefix="pr" />
          </div>,
          document.body,
        )}
    </Dialog>
  )
}

function SectionRow(props: {
  label: string
  caption: string
  checked: boolean
  disabled: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label
      className={cn(
        '-mx-2 flex items-start gap-2.5 rounded-lg px-2 py-1.5',
        props.disabled ? 'opacity-55' : 'cursor-pointer hover:bg-accent',
      )}
    >
      <Checkbox
        className="mt-0.5"
        checked={props.checked && !props.disabled}
        disabled={props.disabled}
        onCheckedChange={(checked) => props.onChange(checked === true)}
      />
      <span className="min-w-0">
        <span className="block text-[13px] font-medium">{props.label}</span>
        <span className="block text-xs text-muted-foreground">{props.caption}</span>
      </span>
    </label>
  )
}
