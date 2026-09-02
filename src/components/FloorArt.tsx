/*
 * Top-down architectural artwork for the floor plan — the venue amenities,
 * tabletops, and chairs, drawn as inline SVG in stage units so every element
 * stays true to its real-world footprint at any size or zoom. The style is
 * "gold ink on pine": thin gold/linen line work over translucent washes,
 * matching the design tokens in index.css.
 *
 * All of it is decorative — every svg is aria-hidden and pointer-events:none;
 * interaction and accessibility live on the surrounding elements in Canvas.
 */

import { useId } from 'react'
import { ft } from '../geometry'
import type { Table, VenueFeature } from '../types'

const GOLD_LINE = 'rgba(197, 165, 94, 0.55)'
const GOLD_SOFT = 'rgba(197, 165, 94, 0.32)'
const GOLD_WASH = 'rgba(197, 165, 94, 0.1)'
const LINEN_LINE = 'rgba(236, 223, 195, 0.55)'
const LINEN_SOFT = 'rgba(236, 223, 195, 0.3)'
const LINEN_WASH = 'rgba(236, 223, 195, 0.07)'
const SAGE_LINE = 'rgba(143, 160, 138, 0.55)'
const SAGE_WASH = 'rgba(143, 160, 138, 0.12)'
const DARK_FILL = 'rgba(20, 31, 24, 0.45)'
const INK_LINE = 'rgba(41, 36, 25, 0.24)'
const INK_FAINT = 'rgba(41, 36, 25, 0.1)'

/** Evenly spread n points along [from, to], centered in each slot. */
function spread(n: number, from: number, to: number): number[] {
  const step = (to - from) / n
  return Array.from({ length: n }, (_, i) => from + step * (i + 0.5))
}

// ---- amenities --------------------------------------------------------------

function DanceFloorArt({ w, h, uid }: { w: number; h: number; uid: string }) {
  const pat = `${uid}-parquet`
  const showMedallion = Math.min(w, h) >= ft(12)
  const cx = w / 2
  const cy = h / 2
  const star = ft(1.05)
  const corners: Array<[number, number]> = [
    [9, 9],
    [w - 9, 9],
    [9, h - 9],
    [w - 9, h - 9],
  ]
  return (
    <>
      <defs>
        {/* Chevron parquet: one plank-pair per foot of floor. */}
        <pattern id={pat} width={ft(2)} height={ft(1)} patternUnits="userSpaceOnUse">
          <path
            d={`M0 ${ft(1)} L ${ft(1)} 0 L ${ft(2)} ${ft(1)}`}
            fill="none"
            stroke={GOLD_SOFT}
            strokeWidth="1.4"
          />
        </pattern>
      </defs>
      <rect x="4.5" y="4.5" width={w - 9} height={h - 9} rx="4" fill="rgba(197, 165, 94, 0.05)" />
      <rect x="10" y="10" width={w - 20} height={h - 20} fill={`url(#${pat})`} />
      {/* Double inlay border, the way a rented parquet floor edges its panels. */}
      <rect x="4.5" y="4.5" width={w - 9} height={h - 9} rx="4" fill="none" stroke={GOLD_LINE} strokeWidth="1.5" />
      <rect x="9" y="9" width={w - 18} height={h - 18} rx="2" fill="none" stroke={GOLD_SOFT} strokeWidth="1" />
      {corners.map(([x, y], i) => (
        <path key={i} d={`M ${x - 4} ${y} L ${x} ${y - 4} L ${x + 4} ${y} L ${x} ${y + 4} Z`} fill={GOLD_SOFT} />
      ))}
      {showMedallion && (
        <>
          <circle cx={cx} cy={cy} r={ft(1.7)} fill="rgba(20, 31, 24, 0.3)" stroke={GOLD_LINE} strokeWidth="1.3" />
          <circle cx={cx} cy={cy} r={ft(0.95)} fill="none" stroke={GOLD_SOFT} strokeWidth="1" />
          <path
            d={`M ${cx} ${cy - star} L ${cx + star * 0.28} ${cy} L ${cx} ${cy + star} L ${cx - star * 0.28} ${cy} Z`}
            fill={GOLD_SOFT}
          />
          <path
            d={`M ${cx - star} ${cy} L ${cx} ${cy - star * 0.28} L ${cx + star} ${cy} L ${cx} ${cy + star * 0.28} Z`}
            fill={GOLD_SOFT}
          />
        </>
      )}
    </>
  )
}

function Speaker({ x, y, tilt }: { x: number; y: number; tilt: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${tilt})`}>
      <rect x="-7.5" y="-17" width="15" height="34" rx="3" fill="rgba(23, 35, 27, 0.9)" stroke={LINEN_SOFT} strokeWidth="1" />
      <circle cx="0" cy="7" r="5" fill="none" stroke={LINEN_SOFT} strokeWidth="1.2" />
      <circle cx="0" cy="-7" r="2.4" fill={LINEN_SOFT} />
    </g>
  )
}

function BandArt({ w, h }: { w: number; h: number }) {
  const planks: number[] = []
  for (let x = ft(1.5); x < w - 4; x += ft(1.5)) planks.push(x)
  const showKit = w >= ft(8) && h >= ft(5)
  const showSpeakers = w >= ft(6) && h >= ft(3.5)
  const showMic = h >= ft(4.5)
  return (
    <>
      {/* Stage decking. */}
      {planks.map((x) => (
        <line key={x} x1={x} y1="4" x2={x} y2={h - 4} stroke="rgba(236, 223, 195, 0.06)" strokeWidth="1" />
      ))}
      {/* The stage lip, facing the room. */}
      <line x1="5" y1={h - 3.5} x2={w - 5} y2={h - 3.5} stroke={GOLD_SOFT} strokeWidth="2" />
      {showKit && (
        <>
          <circle cx={w / 2} cy={ft(1.2)} r={ft(0.85)} fill="rgba(23, 35, 27, 0.4)" stroke={GOLD_LINE} strokeWidth="1.3" />
          <circle cx={w / 2} cy={ft(1.2)} r={ft(0.3)} fill="none" stroke={GOLD_SOFT} strokeWidth="1" />
          <circle cx={w / 2 - ft(1.35)} cy={ft(1)} r={ft(0.4)} fill="none" stroke={GOLD_SOFT} strokeWidth="1" />
          <circle cx={w / 2 + ft(1.35)} cy={ft(1)} r={ft(0.4)} fill="none" stroke={GOLD_SOFT} strokeWidth="1" />
        </>
      )}
      {showSpeakers && (
        <>
          <Speaker x={14} y={h - 24} tilt={-12} />
          <Speaker x={w - 14} y={h - 24} tilt={12} />
        </>
      )}
      {showMic && (
        <>
          <circle cx={w / 2} cy={h - ft(1.3)} r="3" fill={LINEN_LINE} />
          <line x1={w / 2} y1={h - ft(1.3) + 3} x2={w / 2} y2={h - ft(1.3) + 11} stroke={LINEN_SOFT} strokeWidth="1.2" />
        </>
      )}
    </>
  )
}

function BarArt({ w, h }: { w: number; h: number }) {
  const showShelf = h >= ft(3.2)
  const counterY = h * 0.44
  const counterH = h * 0.26
  const bottles = showShelf ? spread(Math.max(3, Math.floor((w - 24) / ft(0.7))), 12, w - 12) : []
  const glasses = spread(Math.max(2, Math.floor((w - 40) / ft(1.9))), 20, w - 20)
  const stools = spread(Math.max(2, Math.floor(w / ft(2.6))), 12, w - 12)
  return (
    <>
      {showShelf && (
        <>
          {/* The back bar: a shelf of bottles. */}
          <rect x="6" y="5" width={w - 12} height={ft(0.8)} rx="3" fill="rgba(23, 35, 27, 0.35)" stroke="rgba(236, 223, 195, 0.16)" strokeWidth="1" />
          {bottles.map((x, i) => (
            <circle key={i} cx={x} cy={5 + ft(0.4)} r={i % 2 ? 2.4 : 3.1} fill={i % 3 ? GOLD_SOFT : LINEN_SOFT} />
          ))}
        </>
      )}
      {/* The counter itself, with a hint of wood grain. */}
      <rect x="6" y={counterY} width={w - 12} height={counterH} rx="5" fill="rgba(197, 165, 94, 0.16)" stroke={GOLD_LINE} strokeWidth="1.2" />
      <line x1="12" y1={counterY + counterH * 0.35} x2={w - 12} y2={counterY + counterH * 0.35} stroke="rgba(197, 165, 94, 0.22)" strokeWidth="0.8" />
      <line x1="12" y1={counterY + counterH * 0.68} x2={w - 12} y2={counterY + counterH * 0.68} stroke="rgba(197, 165, 94, 0.16)" strokeWidth="0.8" />
      {glasses.map((x, i) => (
        <circle key={i} cx={x} cy={counterY + counterH / 2} r="2.2" fill="none" stroke={LINEN_LINE} strokeWidth="1" />
      ))}
      {/* Stools pulled up to the front. */}
      {stools.map((x, i) => (
        <g key={i}>
          <circle cx={x} cy={h * 0.86} r={ft(0.33)} fill="rgba(23, 35, 27, 0.5)" stroke={LINEN_LINE} strokeWidth="1.3" />
          <circle cx={x} cy={h * 0.86} r="2" fill={LINEN_SOFT} />
        </g>
      ))}
    </>
  )
}

function BuffetArt({ w, h }: { w: number; h: number }) {
  const startX = ft(1.7)
  const count = Math.max(2, Math.floor((w - startX - ft(0.9)) / ft(2.1)))
  const dishes = spread(count, startX, w - ft(0.9))
  return (
    <>
      <rect x="3" y="3" width={w - 6} height={h - 6} rx="4" fill={LINEN_WASH} stroke="rgba(236, 223, 195, 0.2)" strokeWidth="1" />
      {/* A stack of plates at the head of the line… */}
      <circle cx={ft(0.85)} cy={h / 2} r="7" fill="none" stroke={LINEN_LINE} strokeWidth="1.2" />
      <circle cx={ft(0.85)} cy={h / 2} r="4.4" fill="none" stroke={LINEN_SOFT} strokeWidth="1" />
      {/* …then the chafing dishes, alternating trays and rounds. */}
      {dishes.map((x, i) =>
        i % 2 === 0 ? (
          <g key={i}>
            <rect x={x - ft(0.75)} y={h / 2 - ft(0.5)} width={ft(1.5)} height={ft(1)} rx="4" fill={GOLD_WASH} stroke={GOLD_LINE} strokeWidth="1.1" />
            <circle cx={x} cy={h / 2} r="1.6" fill={GOLD_LINE} />
          </g>
        ) : (
          <g key={i}>
            <circle cx={x} cy={h / 2} r={ft(0.5)} fill={GOLD_WASH} stroke={GOLD_LINE} strokeWidth="1.1" />
            <circle cx={x} cy={h / 2} r="1.6" fill={GOLD_LINE} />
          </g>
        ),
      )}
    </>
  )
}

function CakeTableArt({ w, h }: { w: number; h: number }) {
  const min = Math.min(w, h)
  const cx = w / 2
  const cy = h / 2
  return (
    <>
      <circle cx={cx} cy={cy} r={min / 2 - 2} fill={LINEN_WASH} />
      {/* A lace edge on the cloth. */}
      <circle
        cx={cx}
        cy={cy}
        r={min / 2 - 5}
        fill="none"
        stroke={LINEN_SOFT}
        strokeWidth="1.6"
        strokeDasharray="1.5 5"
        strokeLinecap="round"
      />
      {/* The cake, tier by tier. */}
      <circle cx={cx} cy={cy} r={min * 0.3} fill="rgba(236, 223, 195, 0.16)" stroke={GOLD_LINE} strokeWidth="1.2" />
      <circle cx={cx} cy={cy} r={min * 0.21} fill="rgba(236, 223, 195, 0.14)" stroke={GOLD_LINE} strokeWidth="1.1" />
      <circle cx={cx} cy={cy} r={min * 0.12} fill="rgba(236, 223, 195, 0.12)" stroke={GOLD_LINE} strokeWidth="1" />
      <circle cx={cx} cy={cy} r="2" fill={GOLD_LINE} />
    </>
  )
}

function GiftBox({ x, y, w, h, tilt }: { x: number; y: number; w: number; h: number; tilt: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${tilt})`}>
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx="1.5" fill={DARK_FILL} stroke={LINEN_LINE} strokeWidth="1.2" />
      <line x1={-w / 2} y1="0" x2={w / 2} y2="0" stroke={GOLD_LINE} strokeWidth="1.2" />
      <line x1="0" y1={-h / 2} x2="0" y2={h / 2} stroke={GOLD_LINE} strokeWidth="1.2" />
      <circle cx="0" cy="0" r="1.7" fill={GOLD_LINE} />
    </g>
  )
}

function GiftTableArt({ w, h }: { w: number; h: number }) {
  const cy = h / 2
  const showEnvelope = w >= ft(5.5)
  return (
    <>
      <rect x="3" y="3" width={w - 6} height={h - 6} rx="4" fill="rgba(143, 160, 138, 0.1)" />
      <GiftBox x={w / 2 - ft(1.15)} y={cy} w={ft(1.05)} h={ft(0.9)} tilt={-9} />
      <GiftBox x={w / 2 + ft(0.55)} y={cy - 1} w={ft(0.85)} h={ft(1.05)} tilt={13} />
      {showEnvelope && (
        <g transform={`translate(${w / 2 + ft(1.9)} ${cy}) rotate(5)`}>
          <rect x={-ft(0.5)} y={-ft(0.33)} width={ft(1)} height={ft(0.66)} fill="rgba(236, 223, 195, 0.1)" stroke={LINEN_SOFT} strokeWidth="1.1" />
          <path d={`M ${-ft(0.5)} ${-ft(0.33)} L 0 2 L ${ft(0.5)} ${-ft(0.33)}`} fill="none" stroke={LINEN_SOFT} strokeWidth="1.1" />
        </g>
      )}
    </>
  )
}

function PhotoBoothArt({ w, h }: { w: number; h: number }) {
  const scallops = Math.max(3, Math.round(w / ft(1.2)))
  const step = (w - 12) / scallops
  const curtain = Array.from(
    { length: scallops },
    (_, i) => `M ${6 + step * i} 6 Q ${6 + step * (i + 0.5)} ${6 + 9} ${6 + step * (i + 1)} 6`,
  ).join(' ')
  const showCamera = h >= ft(3.5)
  const cx = w / 2
  const cy = h * 0.68
  const flare = (x: number, y: number, key: string) => (
    <g key={key}>
      <line x1={x - 5} y1={y} x2={x + 5} y2={y} stroke={GOLD_SOFT} strokeWidth="1" />
      <line x1={x} y1={y - 5} x2={x} y2={y + 5} stroke={GOLD_SOFT} strokeWidth="1" />
      <circle cx={x} cy={y} r="1.4" fill={GOLD_SOFT} />
    </g>
  )
  return (
    <>
      {/* The backdrop: a rod with a scalloped curtain. */}
      <line x1="6" y1="4.5" x2={w - 6} y2="4.5" stroke={LINEN_SOFT} strokeWidth="1.4" />
      <path d={curtain} fill="none" stroke={GOLD_SOFT} strokeWidth="1.5" />
      {flare(12, h * 0.34, 'l')}
      {flare(w - 12, h * 0.34, 'r')}
      {showCamera && (
        <>
          {/* Camera on its tripod, aimed at the backdrop. */}
          <line x1={cx} y1={cy} x2={cx - 8} y2={cy + 13} stroke={LINEN_SOFT} strokeWidth="1.2" />
          <line x1={cx} y1={cy} x2={cx + 8} y2={cy + 13} stroke={LINEN_SOFT} strokeWidth="1.2" />
          <line x1={cx} y1={cy} x2={cx} y2={cy + 14} stroke={LINEN_SOFT} strokeWidth="1.2" />
          <circle cx={cx} cy={cy - 3} r="5.5" fill="rgba(23, 35, 27, 0.85)" stroke={LINEN_LINE} strokeWidth="1.2" />
          <circle cx={cx} cy={cy - 3} r="2.2" fill={GOLD_SOFT} />
        </>
      )}
    </>
  )
}

function BathroomArt({ w, h, uid }: { w: number; h: number; uid: string }) {
  const pat = `${uid}-tile`
  const sinks = w >= ft(5.5) ? [w * 0.34, w * 0.66] : [w * 0.5]
  const vanityH = ft(1.1)
  const door = Math.min(ft(1.8), w * 0.3, h * 0.45)
  const showDoor = w >= ft(4) && h - vanityH > door + 12
  return (
    <>
      <defs>
        <pattern id={pat} width={ft(0.75)} height={ft(0.75)} patternUnits="userSpaceOnUse">
          <path d={`M ${ft(0.75)} 0 L 0 0 0 ${ft(0.75)}`} fill="none" stroke="rgba(236, 223, 195, 0.06)" strokeWidth="1" />
        </pattern>
      </defs>
      <rect x="3" y="3" width={w - 6} height={h - 6} rx="6" fill={`url(#${pat})`} />
      {/* The vanity, sinks and all. */}
      <rect x="6" y="6" width={w - 12} height={vanityH} rx="3" fill={SAGE_WASH} stroke={SAGE_LINE} strokeWidth="1" />
      {sinks.map((x, i) => (
        <g key={i}>
          <circle cx={x} cy={6 + vanityH / 2} r={ft(0.32)} fill="none" stroke={LINEN_LINE} strokeWidth="1.2" />
          <circle cx={x} cy={6 + vanityH / 2 - ft(0.32) - 2} r="1.4" fill={LINEN_SOFT} />
        </g>
      ))}
      {showDoor && (
        <path
          d={`M 8 ${h - 3} L 8 ${h - 3 - door} A ${door} ${door} 0 0 1 ${8 + door} ${h - 3}`}
          fill="none"
          stroke={LINEN_SOFT}
          strokeWidth="1.2"
        />
      )}
    </>
  )
}

function EntranceArt({ w, h }: { w: number; h: number }) {
  const cx = w / 2
  const leaf = Math.min(ft(2.4), w * 0.24, h - 8)
  const runnerW = Math.min(ft(2.5), w * 0.5)
  return (
    <>
      {/* A runner leads guests in. */}
      <rect x={cx - runnerW / 2} y="2" width={runnerW} height={h - 4} fill="rgba(197, 165, 94, 0.08)" />
      <line x1={cx - runnerW / 2} y1="3" x2={cx - runnerW / 2} y2={h - 3} stroke={GOLD_SOFT} strokeWidth="1" strokeDasharray="6 5" />
      <line x1={cx + runnerW / 2} y1="3" x2={cx + runnerW / 2} y2={h - 3} stroke={GOLD_SOFT} strokeWidth="1" strokeDasharray="6 5" />
      {/* The architect's double-door swing. */}
      <path
        d={`M ${cx - leaf} ${h - 2} L ${cx - leaf} ${h - 2 - leaf} A ${leaf} ${leaf} 0 0 1 ${cx} ${h - 2}`}
        fill="rgba(236, 223, 195, 0.05)"
        stroke={LINEN_LINE}
        strokeWidth="1.3"
      />
      <path
        d={`M ${cx + leaf} ${h - 2} L ${cx + leaf} ${h - 2 - leaf} A ${leaf} ${leaf} 0 0 0 ${cx} ${h - 2}`}
        fill="rgba(236, 223, 195, 0.05)"
        stroke={LINEN_LINE}
        strokeWidth="1.3"
      />
      <rect x={cx - leaf - 5} y={h - 8} width="5" height="6" fill={LINEN_SOFT} />
      <rect x={cx + leaf} y={h - 8} width="5" height="6" fill={LINEN_SOFT} />
    </>
  )
}

/** The top-down illustration for one venue amenity, sized to its footprint. */
export function FeatureArt({ feature }: { feature: VenueFeature }) {
  const uid = useId()
  const { w, h } = feature
  if (w < 8 || h < 8) return null
  let art: React.ReactNode
  switch (feature.id) {
    case 'dance_floor':
      art = <DanceFloorArt w={w} h={h} uid={uid} />
      break
    case 'band':
      art = <BandArt w={w} h={h} />
      break
    case 'bar':
      art = <BarArt w={w} h={h} />
      break
    case 'buffet':
      art = <BuffetArt w={w} h={h} />
      break
    case 'cake_table':
      art = <CakeTableArt w={w} h={h} />
      break
    case 'gift_table':
      art = <GiftTableArt w={w} h={h} />
      break
    case 'photo_booth':
      art = <PhotoBoothArt w={w} h={h} />
      break
    case 'bathroom':
      art = <BathroomArt w={w} h={h} uid={uid} />
      break
    case 'entrance':
      art = <EntranceArt w={w} h={h} />
      break
  }
  return (
    <svg className="feature-art" viewBox={`0 0 ${w} ${h}`} aria-hidden="true" focusable="false">
      {art}
    </svg>
  )
}

// ---- tables -----------------------------------------------------------------

/** Linen, china, and glassware on the tabletop, aligned to the real seats. */
export function TableArt({ table, size }: { table: Table; size: { w: number; h: number } }) {
  const uid = useId()
  const grad = `${uid}-cloth`
  const { w, h } = size

  if (table.shape === 'round') {
    const r = w / 2
    const plateRing = r - ft(0.55)
    const plateR = Math.min(ft(0.42), plateRing * 0.32)
    const seats = Array.from({ length: table.seats }, (_, i) => (i / table.seats) * Math.PI * 2 - Math.PI / 2)
    return (
      <svg className="table-art" viewBox={`0 0 ${w} ${h}`} aria-hidden="true" focusable="false">
        <defs>
          <radialGradient id={grad}>
            <stop offset="0%" stopColor="#f8f2e3" />
            <stop offset="58%" stopColor="#efe7d2" />
            <stop offset="100%" stopColor="#e2d7bb" />
          </radialGradient>
        </defs>
        <circle cx={r} cy={r} r={r - 0.5} fill={`url(#${grad})`} stroke={INK_LINE} strokeWidth="1" />
        {/* Cloth drape folds fall between the seats. */}
        {seats.map((a, i) => {
          const m = a + Math.PI / table.seats
          return (
            <line
              key={`f${i}`}
              x1={r + Math.cos(m) * r * 0.55}
              y1={r + Math.sin(m) * r * 0.55}
              x2={r + Math.cos(m) * r * 0.93}
              y2={r + Math.sin(m) * r * 0.93}
              stroke={INK_FAINT}
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          )
        })}
        {/* One place setting per seat: charger, plate, and a glass to its right. */}
        {seats.map((a, i) => {
          const px = r + Math.cos(a) * plateRing
          const py = r + Math.sin(a) * plateRing
          const ga = a + (Math.PI * 2 / table.seats) * 0.32
          return (
            <g key={`p${i}`}>
              <circle cx={px} cy={py} r={plateR} fill="#f6f0e0" stroke={INK_LINE} strokeWidth="1" />
              <circle cx={px} cy={py} r={plateR * 0.62} fill="none" stroke={INK_FAINT} strokeWidth="1" />
              <circle cx={r + Math.cos(ga) * (r - ft(0.45))} cy={r + Math.sin(ga) * (r - ft(0.45))} r="2.1" fill={GOLD_LINE} />
            </g>
          )
        })}
      </svg>
    )
  }

  // Banquet: place settings mirror seatPos — down both long sides, then the ends.
  const perSide = Math.ceil((table.seats - 2) / 2)
  const ends = table.seats - perSide * 2
  const gap = w / (perSide + 1)
  const plateR = ft(0.38)
  const sides = Array.from({ length: perSide }, (_, i) => gap * (i + 1))
  const setting = (px: number, py: number, glassDy: number, key: string) => (
    <g key={key}>
      <circle cx={px} cy={py} r={plateR} fill="#f6f0e0" stroke={INK_LINE} strokeWidth="1" />
      <circle cx={px} cy={py} r={plateR * 0.62} fill="none" stroke={INK_FAINT} strokeWidth="1" />
      <circle cx={px + ft(0.45)} cy={py + glassDy} r="2" fill={GOLD_LINE} />
    </g>
  )
  return (
    <svg className="table-art" viewBox={`0 0 ${w} ${h}`} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={grad} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f6efdd" />
          <stop offset="50%" stopColor="#efe7d2" />
          <stop offset="100%" stopColor="#e5dabf" />
        </linearGradient>
      </defs>
      <rect x="0.5" y="0.5" width={w - 1} height={h - 1} rx="12" fill={`url(#${grad})`} stroke={INK_LINE} strokeWidth="1" />
      {/* A runner down the length of the table. */}
      <rect x="0.5" y={h / 2 - ft(0.3)} width={w - 1} height={ft(0.6)} fill="rgba(197, 165, 94, 0.12)" />
      <line x1="1" y1={h / 2 - ft(0.3)} x2={w - 1} y2={h / 2 - ft(0.3)} stroke="rgba(197, 165, 94, 0.3)" strokeWidth="1" />
      <line x1="1" y1={h / 2 + ft(0.3)} x2={w - 1} y2={h / 2 + ft(0.3)} stroke="rgba(197, 165, 94, 0.3)" strokeWidth="1" />
      {sides.map((x) => setting(x, ft(0.55), ft(0.3), `t${x}`))}
      {sides.map((x) => setting(x, h - ft(0.55), -ft(0.3), `b${x}`))}
      {ends >= 1 && setting(ft(0.55), h / 2, -ft(0.45), 'e0')}
      {ends >= 2 && setting(w - ft(0.55), h / 2, -ft(0.45), 'e1')}
    </svg>
  )
}

// ---- chairs -----------------------------------------------------------------

/**
 * One chair, drawn facing +x — the marker that carries it rotates so the
 * backrest ends up on the side away from the table.
 */
export function ChairGlyph() {
  return (
    <svg viewBox="-16.5 -16.5 33 33" aria-hidden="true" focusable="false">
      <circle cx="0.5" cy="0" r="9.5" fill="rgba(236, 223, 195, 0.09)" stroke="rgba(236, 223, 195, 0.5)" strokeWidth="1.5" />
      <path
        d="M -7 11 Q -16 0 -7 -11"
        fill="none"
        stroke="rgba(236, 223, 195, 0.55)"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  )
}
