import type { AisleState, VenueFeature } from '../types'
import {
  rectTableSize,
  roomRect,
  seatPos,
  stageUnitsPerFoot,
  tableRadius,
  formatFeet,
} from '../geometry'
import { groupColors } from '../utils'

/**
 * The printed floor plan: the venue drawn to scale as plain SVG, styled like
 * an architect's sheet — double-line walls, dimension strings, a scale bar,
 * hatched dance floor, and seat dots colored by guest group.
 *
 * Furniture is drawn at its true stage-space size; lettering and line weights
 * are specified in output pixels and converted through the fitted scale, so a
 * huge ballroom and a tiny restaurant both print with the same legible labels.
 */

const INK = '#3a3428'
const INK_SOFT = '#7a7060'
const INK_FAINT = '#a99e8a'
const PAPER = '#fdfaf3'
const FLOOR = '#f8f3e7'
const GRID = '#eae1cb'
const AMENITY_FILL = '#efe8d5'

/** Zones a guest stands in (vs. furniture) print hatched with a dashed edge. */
const HATCHED = new Set(['dance_floor'])

export function FloorPlanSvg({ state, fitW, fitH, idPrefix }: {
  state: AisleState
  /** Box the plan must fit inside, px. */
  fitW: number
  fitH: number
  /** Uniquifies SVG defs ids — the plan renders twice (preview + print). */
  idPrefix: string
}) {
  const dim = state.venueDimensions
  const room = roomRect(dim)
  const colors = groupColors(state)

  // Fixed px padding around the room for dimension strings and the scale bar.
  const PAD = { l: 44, r: 16, t: 38, b: 34 }
  const k = Math.max(
    0.01,
    Math.min((fitW - PAD.l - PAD.r) / room.w, (fitH - PAD.t - PAD.b) / room.h),
  )
  /** px → stage units at the fitted scale. */
  const u = (px: number) => px / k
  const vb = {
    x: room.x - u(PAD.l),
    y: room.y - u(PAD.t),
    w: room.w + u(PAD.l + PAD.r),
    h: room.h + u(PAD.t + PAD.b),
  }

  const units = stageUnitsPerFoot(dim)
  const gridStep = units.x * 5
  const gridX: number[] = []
  for (let x = room.x + gridStep; x < room.x + room.w - 1; x += gridStep) gridX.push(x)
  const gridY: number[] = []
  for (let y = room.y + gridStep; y < room.y + room.h - 1; y += gridStep) gridY.push(y)

  const occupantColor: Record<string, Record<number, string>> = {}
  for (const [gid, seat] of Object.entries(state.seating)) {
    const g = state.guests[gid]
    if (!g || g.rsvp === 'no') continue
    ;(occupantColor[seat.tableId] ??= {})[seat.seat] = colors[g.group]
  }

  const halo = { paintOrder: 'stroke' as const, stroke: PAPER, strokeLinejoin: 'round' as const }
  const dimTop = room.y - u(18)
  const dimLeft = room.x - u(18)

  // Scale bar: two 5′ segments below the room's bottom-left corner.
  const barY = room.y + room.h + u(14)
  const seg = units.x * 5

  return (
    <svg
      width={vb.w * k}
      height={vb.h * k}
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      role="img"
      aria-label={`Floor plan, ${formatFeet(dim.widthFt)} by ${formatFeet(dim.lengthFt)}`}
      fontFamily="'Inter Variable', system-ui, sans-serif"
    >
      <defs>
        <pattern
          id={`${idPrefix}-hatch`}
          patternUnits="userSpaceOnUse"
          width={u(7)}
          height={u(7)}
          patternTransform="rotate(45)"
        >
          <line x1={0} y1={0} x2={0} y2={u(7)} stroke="#dcd2b6" strokeWidth={u(1.3)} />
        </pattern>
      </defs>

      {/* floor + grid */}
      <rect x={room.x} y={room.y} width={room.w} height={room.h} fill={FLOOR} />
      <g stroke={GRID} strokeWidth={u(0.8)} shapeRendering="crispEdges">
        {gridX.map((x) => (
          <line key={`gx${x}`} x1={x} y1={room.y} x2={x} y2={room.y + room.h} />
        ))}
        {gridY.map((y) => (
          <line key={`gy${y}`} x1={room.x} y1={y} x2={room.x + room.w} y2={y} />
        ))}
      </g>

      {/* double-line walls */}
      <rect x={room.x} y={room.y} width={room.w} height={room.h} fill="none" stroke={INK} strokeWidth={u(2.2)} />
      <rect
        x={room.x - u(4.5)}
        y={room.y - u(4.5)}
        width={room.w + u(9)}
        height={room.h + u(9)}
        fill="none"
        stroke={INK}
        strokeWidth={u(0.9)}
      />

      {/* dimension strings */}
      <g stroke={INK_SOFT} strokeWidth={u(0.9)}>
        <line x1={room.x} y1={dimTop} x2={room.x + room.w} y2={dimTop} />
        <line x1={room.x} y1={dimTop - u(4)} x2={room.x} y2={dimTop + u(4)} />
        <line x1={room.x + room.w} y1={dimTop - u(4)} x2={room.x + room.w} y2={dimTop + u(4)} />
        <line x1={dimLeft} y1={room.y} x2={dimLeft} y2={room.y + room.h} />
        <line x1={dimLeft - u(4)} y1={room.y} x2={dimLeft + u(4)} y2={room.y} />
        <line x1={dimLeft - u(4)} y1={room.y + room.h} x2={dimLeft + u(4)} y2={room.y + room.h} />
      </g>
      <text
        x={room.x + room.w / 2}
        y={dimTop + u(3.5)}
        textAnchor="middle"
        fontSize={u(10.5)}
        fontWeight={600}
        letterSpacing={u(0.6)}
        fill={INK}
        strokeWidth={u(6)}
        {...halo}
      >
        {formatFeet(dim.widthFt)}
      </text>
      <text
        x={dimLeft}
        y={room.y + room.h / 2}
        transform={`rotate(-90 ${dimLeft} ${room.y + room.h / 2})`}
        textAnchor="middle"
        dy={u(3.5)}
        fontSize={u(10.5)}
        fontWeight={600}
        letterSpacing={u(0.6)}
        fill={INK}
        strokeWidth={u(6)}
        {...halo}
      >
        {formatFeet(dim.lengthFt)}
      </text>

      {/* amenities */}
      {Object.values(state.venue).map((f) => (f.enabled ? <Amenity key={f.id} f={f} u={u} k={k} idPrefix={idPrefix} /> : null))}

      {/* tables and seats */}
      {state.tableOrder.map((tid) => {
        const t = state.tables[tid]
        const occ = occupantColor[tid] ?? {}
        const occCount = Object.keys(occ).length
        const body =
          t.shape === 'round' ? (
            <circle cx={t.x} cy={t.y} r={tableRadius(t, dim)} fill={PAPER} stroke={INK} strokeWidth={u(1.3)} />
          ) : (
            (() => {
              const size = rectTableSize(t, dim)
              return (
                <rect
                  x={t.x - size.w / 2}
                  y={t.y - size.h / 2}
                  width={size.w}
                  height={size.h}
                  rx={u(2.5)}
                  fill={PAPER}
                  stroke={INK}
                  strokeWidth={u(1.3)}
                  transform={`rotate(${t.rotation ?? 0} ${t.x} ${t.y})`}
                />
              )
            })()
          )
        return (
          <g key={tid}>
            {body}
            {Array.from({ length: t.seats }, (_, i) => {
              const p = seatPos(t, i, dim)
              const color = occ[i]
              return color ? (
                <circle key={i} cx={p.x} cy={p.y} r={u(4)} fill={color} stroke={INK} strokeWidth={u(0.7)} strokeOpacity={0.35} />
              ) : (
                <circle key={i} cx={p.x} cy={p.y} r={u(3.4)} fill={PAPER} stroke={INK_FAINT} strokeWidth={u(0.9)} />
              )
            })}
            <text
              x={t.x}
              y={t.y - u(1.5)}
              textAnchor="middle"
              fontFamily="'EB Garamond Variable', Georgia, serif"
              fontSize={u(11.5)}
              fontWeight={600}
              fill={INK}
              strokeWidth={u(5)}
              {...halo}
            >
              {t.name}
            </text>
            <text
              x={t.x}
              y={t.y + u(10)}
              textAnchor="middle"
              fontSize={u(7.5)}
              letterSpacing={u(0.4)}
              fill={INK_SOFT}
              strokeWidth={u(4)}
              {...halo}
            >
              {occCount} of {t.seats}
            </text>
          </g>
        )
      })}

      {/* scale bar */}
      <g>
        <rect x={room.x} y={barY} width={seg} height={u(4)} fill={INK} />
        <rect x={room.x + seg} y={barY} width={seg} height={u(4)} fill="none" stroke={INK} strokeWidth={u(0.8)} />
        {[0, 5, 10].map((ft) => (
          <text
            key={ft}
            x={room.x + seg * (ft / 5)}
            y={barY + u(13)}
            textAnchor="middle"
            fontSize={u(7.5)}
            fill={INK_SOFT}
          >
            {ft === 0 ? '0' : formatFeet(ft)}
          </text>
        ))}
      </g>
    </svg>
  )
}

function Amenity({ f, u, k, idPrefix }: { f: VenueFeature; u: (px: number) => number; k: number; idPrefix: string }) {
  const cx = f.x + f.w / 2
  const cy = f.y + f.h / 2
  const hatched = HATCHED.has(f.id)
  // The label stays horizontal even when the shape rotates; small shapes get
  // just their first word ("Band & speakers" → "Band").
  const label = (Math.min(f.w, f.h) * k < 56 || f.w * k < 84 ? f.label.split(/\s|&/)[0] : f.label).toUpperCase()
  return (
    <g>
      <rect
        x={f.x}
        y={f.y}
        width={f.w}
        height={f.h}
        rx={u(3)}
        fill={hatched ? `url(#${idPrefix}-hatch)` : AMENITY_FILL}
        stroke={INK_SOFT}
        strokeWidth={u(1)}
        strokeDasharray={hatched ? `${u(4)} ${u(3)}` : undefined}
        transform={`rotate(${f.rotation ?? 0} ${cx} ${cy})`}
      />
      <text
        x={cx}
        y={cy + u(3)}
        textAnchor="middle"
        fontSize={u(8)}
        fontWeight={600}
        letterSpacing={u(1.1)}
        fill={INK_SOFT}
        paintOrder="stroke"
        stroke={hatched ? PAPER : AMENITY_FILL}
        strokeWidth={u(4)}
        strokeLinejoin="round"
      >
        {label}
      </text>
    </g>
  )
}
