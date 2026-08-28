import type { AisleState } from '../types'
import { formatFeet } from '../geometry'
import { FloorPlanSvg } from './FloorPlanSvg'
import {
  EXPORT_METRICS,
  PAGE_PX,
  contentHeight,
  mastheadHeight,
  type CateringBlock,
  type DirectoryItem,
  type DocModel,
  type DocPage,
  type TableCard,
} from './model'

/**
 * The printable pages. The same tree renders twice: scaled down as the live
 * preview inside the export dialog, and full-size in the hidden print root
 * that the browser paginates into the PDF. All sizing decisions were already
 * made in model.ts — this file just draws them.
 */

export function ExportPages({ state, model, idPrefix }: { state: AisleState; model: DocModel; idPrefix: string }) {
  return (
    <>
      {model.pages.map((page, i) => (
        <Page key={i} state={state} model={model} page={page} index={i} total={model.pages.length} idPrefix={idPrefix} />
      ))}
    </>
  )
}

const SECTION_TITLES: Record<Exclude<DocPage['kind'], 'plan'>, string> = {
  tables: 'Seating by table',
  directory: 'Guest directory',
  catering: 'Catering & dietary',
}

function Page(props: {
  state: AisleState
  model: DocModel
  page: DocPage
  index: number
  total: number
  idPrefix: string
}) {
  const { state, model, page, index, total, idPrefix } = props
  return (
    <section className={`export-page paper-${model.paper}`}>
      <div className="export-page-body">
        {page.masthead && <Masthead model={model} />}
        {page.kind === 'plan' ? (
          <PlanContent state={state} model={model} idPrefix={idPrefix} />
        ) : (
          <SectionContent model={model} page={page} />
        )}
      </div>
      <footer className="export-footer">
        <span className="export-footer-brand">
          <span aria-hidden="true">❦</span> Aisle
        </span>
        <span className="export-footer-title">{model.displayTitle}</span>
        <span className="export-footer-page">
          Page {index + 1} of {total}
        </span>
      </footer>
    </section>
  )
}

function Masthead({ model }: { model: DocModel }) {
  const meta = [
    model.dateLine,
    model.venueLine,
    `${model.stats.attending} guests · ${model.stats.tables} tables`,
  ].filter(Boolean)
  return (
    <header className="export-masthead">
      <p className="export-kicker">Seating plan</p>
      <h1>{model.displayTitle}</h1>
      <p className="export-masthead-meta">
        {meta.join('  ·  ')}
        <span className={`export-status${model.finalized ? ' final' : ''}`}>
          {model.finalized ? 'Final' : 'Working draft'}
        </span>
      </p>
    </header>
  )
}

function SectionContent({ model, page }: { model: DocModel; page: Exclude<DocPage, { kind: 'plan' }> }) {
  const title = SECTION_TITLES[page.kind]
  const meta =
    page.kind === 'tables'
      ? `${model.stats.tables} tables · ${model.stats.seated} of ${model.stats.attending} seated`
      : page.kind === 'directory'
        ? `${model.stats.attending} guests, A to Z`
        : `${model.stats.dietaryCount} guests with dietary notes`
  const legendLine =
    page.kind === 'tables'
      ? [
          ...model.legend.map((e, i) => `${superscript(i + 1)} ${e.label}`),
          ...(model.stats.pending > 0 ? ['† awaiting reply'] : []),
        ].join('   ')
      : page.kind === 'directory' && model.stats.pending > 0
        ? '† awaiting reply'
        : ''
  return (
    <>
      {page.continued ? (
        <p className="export-continued">{title} — continued</p>
      ) : (
        <header className="export-section-header">
          <h2>{title}</h2>
          <span>{meta}</span>
        </header>
      )}
      {!page.continued && legendLine && <p className="export-legend-line">{legendLine}</p>}
      <div className={`export-columns cols-${page.columns.length}`}>
        {page.columns.map((column, ci) => (
          <div className="export-col" key={ci}>
            {page.kind === 'tables' &&
              (column as TableCard[]).map((card) => <TableCardView key={card.id} card={card} />)}
            {page.kind === 'directory' && (column as DirectoryItem[]).map((item) => <DirectoryRow key={item.key} item={item} />)}
            {page.kind === 'catering' &&
              (column as CateringBlock[]).map((block) => <CateringBlockView key={block.key} block={block} />)}
          </div>
        ))}
      </div>
    </>
  )
}

// ---- floor plan page -------------------------------------------------------

function PlanContent({ state, model, idPrefix }: { state: AisleState; model: DocModel; idPrefix: string }) {
  const m = EXPORT_METRICS
  const contentW = PAGE_PX[model.paper].w - m.padX * 2
  // Legend rows are estimated the same way model.ts estimates heights: from
  // the group count, not measurement.
  const legendItems = model.stats.groups.length + 1
  const legendRows = legendItems > 6 ? 2 : 1
  const legendH = legendRows * 20 + 14
  const planH = contentHeight(model.paper) - mastheadHeight(model.displayTitle) - legendH - 24
  const dim = state.venueDimensions
  return (
    // Plan and legend travel as one block, centered in the leftover height.
    <div className="export-plan-area" style={{ height: planH + legendH }}>
      <div className="export-plan-box">
        <FloorPlanSvg state={state} fitW={contentW} fitH={planH} idPrefix={idPrefix} />
      </div>
      <div className="export-plan-legend">
        {model.stats.groups.map((g) => (
          <span key={g.name} className="export-legend-item">
            <i className="export-dot" style={{ background: g.color }} /> {g.name} ({g.count})
          </span>
        ))}
        <span className="export-legend-item">
          <i className="export-dot open" /> open seat
        </span>
        <span className="export-legend-item dim">
          Main room {formatFeet(dim.widthFt)} × {formatFeet(dim.lengthFt)} · 5′ grid
        </span>
      </div>
    </div>
  )
}

// ---- section items ---------------------------------------------------------

const SUPERSCRIPTS = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹']

function superscript(n: number): string {
  return String(n)
    .split('')
    .map((d) => SUPERSCRIPTS[Number(d)])
    .join('')
}

function TableCardView({ card }: { card: TableCard }) {
  return (
    <article className={`export-card${card.unseated ? ' unseated' : ''}`}>
      <header>
        <h3>{card.name}</h3>
        <span>{card.unseated ? `${card.rows.length} guests` : `${card.rows.length} of ${card.seats}`}</span>
      </header>
      {card.rows.length === 0 ? (
        <p className="export-card-empty">No one seated yet</p>
      ) : (
        <ul>
          {card.rows.map((row) => (
            <li key={row.guestId}>
              <i className="export-dot" style={{ background: row.color }} />
              <span className="export-card-name">
                {row.name}
                {row.markers.length > 0 && (
                  <span className="export-marker">{row.markers.map(superscript).join(' ')}</span>
                )}
                {row.pending && <span className="export-pending">†</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {card.openSeats > 0 && (
        <p className="export-card-open">
          {card.openSeats} open seat{card.openSeats === 1 ? '' : 's'}
        </p>
      )}
    </article>
  )
}

function DirectoryRow({ item }: { item: DirectoryItem }) {
  if (item.kind === 'letter') return <h3 className="export-dir-letter">{item.letter}</h3>
  return (
    <p className="export-dir-row">
      <span className="export-dir-name">
        {item.name}
        {item.pending && <span className="export-pending">†</span>}
      </span>
      <span className="export-dir-leader" aria-hidden="true" />
      <span className={`export-dir-table${item.table ? '' : ' dim'}`}>{item.table ?? 'unseated'}</span>
    </p>
  )
}

function CateringBlockView({ block }: { block: CateringBlock }) {
  return (
    <article className="export-catering-block">
      <h3>{block.title}</h3>
      <ul>
        {block.lines.map((line) => (
          <li key={line.key} className={line.dim ? 'dim' : undefined}>
            {line.text}
          </li>
        ))}
      </ul>
    </article>
  )
}
