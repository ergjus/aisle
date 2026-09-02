import { useEffect, useRef, useState } from 'react'

const PETAL_COLORS = ['#ecdfc3', '#e8cf8f', '#c4878b', '#d9b5a3', '#8fa878', '#f6efdd']

/** A stable little RNG so the same burst always falls the same way. */
function seeded(seed: number) {
  let a = seed
  return () => {
    a = (a * 1664525 + 1013904223) % 4294967296
    return a / 4294967296
  }
}

/**
 * Petals. They fall exactly once — the moment the chart is finalized, every
 * guest seated and every rule kept — and never for anything smaller. The
 * only confetti in the whole app, so it means something when it comes.
 */
export function Celebration({ active }: { active: boolean }) {
  const [burst, setBurst] = useState<number | null>(null)
  const prev = useRef(active)

  useEffect(() => {
    const rose = active && !prev.current
    prev.current = active
    if (!rose) return
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    setBurst(Date.now())
    const timer = setTimeout(() => setBurst(null), 7000)
    return () => clearTimeout(timer)
  }, [active])

  if (burst === null) return null
  const rnd = seeded(burst % 100000)
  const petals = Array.from({ length: 34 }, (_, i) => {
    const left = rnd() * 100
    const delay = rnd() * 1.8
    const duration = 3.6 + rnd() * 2.2
    const drift = (rnd() - 0.5) * 220
    const spin = (rnd() - 0.5) * 900
    const size = 7 + rnd() * 7
    const color = PETAL_COLORS[i % PETAL_COLORS.length]
    return { left, delay, duration, drift, spin, size, color }
  })
  return (
    <div className="petals" aria-hidden="true">
      {petals.map((p, i) => (
        <span
          key={i}
          className="petal"
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.size * 1.35,
            background: p.color,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            ['--drift' as string]: `${p.drift}px`,
            ['--spin' as string]: `${p.spin}deg`,
          }}
        />
      ))}
    </div>
  )
}
