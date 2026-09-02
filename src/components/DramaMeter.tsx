import { dramaLabel } from '../constraints'

/**
 * The drama meter — a little brass gauge in the masthead. The needle climbs
 * with every broken seating rule, from Serene to Full telenovela.
 */
export function DramaMeter({ score, broken }: { score: number; broken: number }) {
  const frac = Math.min(score, 14) / 14
  const angle = -90 + frac * 180
  const hue = frac === 0 ? 'var(--color-ok)' : frac < 0.4 ? 'var(--color-gold)' : 'var(--color-brick)'
  const label = `Drama meter: ${dramaLabel(score)}${broken > 0 ? ` — ${broken} rule${broken === 1 ? '' : 's'} broken` : ' — no rules broken'}`
  return (
    <div
      className="flex items-center gap-2.5 select-none"
      role="img"
      aria-label={label}
      title={`${label}. The needle rises with every broken seating rule.`}
    >
      <svg width="62" height="36" viewBox="0 0 66 38" aria-hidden="true">
        {/* the dial */}
        <path d="M 5 34 A 28 28 0 0 1 61 34" fill="none" stroke="var(--color-hairline)" strokeWidth="3.5" strokeLinecap="round" />
        <path
          d="M 5 34 A 28 28 0 0 1 61 34"
          fill="none"
          stroke={hue}
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray={`${Math.max(0.02, frac) * 88} 200`}
          style={{ transition: 'stroke-dasharray 600ms ease, stroke 600ms ease' }}
        />
        {/* tick marks at the quarter points, like a real gauge */}
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const a = Math.PI - t * Math.PI
          const x1 = 33 + Math.cos(a) * 22
          const y1 = 34 - Math.sin(a) * 22
          const x2 = 33 + Math.cos(a) * 25
          const y2 = 34 - Math.sin(a) * 25
          return <line key={t} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--color-ink-faint)" strokeWidth="1" strokeLinecap="round" />
        })}
        <g style={{ transform: `rotate(${angle}deg)`, transformOrigin: '33px 34px', transition: 'transform 700ms cubic-bezier(.3,1.4,.4,1)' }}>
          <line x1="33" y1="34" x2="33" y2="13" stroke="var(--color-ink)" strokeWidth="1.8" strokeLinecap="round" />
        </g>
        <circle cx="33" cy="34" r="3.2" fill="var(--color-ink)" />
        <circle cx="33" cy="34" r="1.2" fill="var(--color-gold-bright)" />
      </svg>
      <div className="flex flex-col leading-none">
        <span className="smallcaps text-[12px] text-ink-faint">Drama meter</span>
        <span className="mt-0.5 font-serif text-[18px] leading-none font-semibold italic text-ink">
          {dramaLabel(score)}
          {broken > 0 && <span className="figures ml-1.5 text-[10.5px] font-medium not-italic text-brick">{broken} broken</span>}
        </span>
      </div>
    </div>
  )
}
