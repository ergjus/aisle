import { dramaLabel } from '../constraints'

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
      <svg width="66" height="38" viewBox="0 0 66 38" aria-hidden="true">
        <path d="M 5 34 A 28 28 0 0 1 61 34" fill="none" stroke="var(--color-hairline)" strokeWidth="5" strokeLinecap="round" />
        <path
          d="M 5 34 A 28 28 0 0 1 61 34"
          fill="none"
          stroke={hue}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${Math.max(0.02, frac) * 88} 200`}
          style={{ transition: 'stroke-dasharray 600ms ease, stroke 600ms ease' }}
        />
        <g style={{ transform: `rotate(${angle}deg)`, transformOrigin: '33px 34px', transition: 'transform 700ms cubic-bezier(.3,1.4,.4,1)' }}>
          <line x1="33" y1="34" x2="33" y2="12" stroke="var(--color-ink)" strokeWidth="2" strokeLinecap="round" />
        </g>
        <circle cx="33" cy="34" r="3" fill="var(--color-ink)" />
      </svg>
      <div className="flex flex-col leading-tight">
        <span className="text-[10.5px] font-bold tracking-[0.14em] text-ink-faint uppercase">Drama meter</span>
        <span className="font-serif text-lg font-semibold italic">
          {dramaLabel(score)}
          {broken > 0 && <span className="font-sans text-[11px] font-bold not-italic text-brick"> · {broken} broken</span>}
        </span>
      </div>
    </div>
  )
}
