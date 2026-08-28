import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, animate, motion, useMotionValue } from 'motion/react'
import { STAGE_H, STAGE_W } from '../geometry'
import {
  nextPerformance,
  onPerformance,
  queuedCount,
  setCursorPlaying,
  type CursorStep,
} from '../agentCursor'

// Long enough that the cursor stays on stage across an agent's think-act
// rhythm instead of vanishing between consecutive tool calls.
const IDLE_FADE_MS = 6000
const EASE_TRAVEL: [number, number, number, number] = [0.3, 0.7, 0.35, 1]

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

let rippleSeq = 0

/**
 * The agent's ghost cursor. Lives inside the stage (so it scales with it) and
 * plays back performances queued by the choreographer in agentCursor.ts —
 * gliding, grabbing chips, dropping them with a ripple, narrating in a bubble.
 * Position runs on motion values, so nothing re-renders per frame.
 */
export function AgentCursor() {
  const x = useMotionValue(STAGE_W / 2)
  const y = useMotionValue(STAGE_H / 2)
  const scale = useMotionValue(0)

  const [visible, setVisible] = useState(false)
  const [label, setLabel] = useState<string | null>(null)
  const [carrying, setCarrying] = useState(false)
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number }[]>([])

  const runningRef = useRef(false)
  const aliveRef = useRef(true)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    aliveRef.current = true

    const playStep = async (step: CursorStep, rush: number) => {
      if (step.label) setLabel(step.label)
      if (step.gesture === 'grab' || step.gesture === 'carry') setCarrying(true)
      if (!step.stay) {
        const duration = ((step.durationMs ?? 420) * rush) / 1000
        const ease = step.ease ?? EASE_TRAVEL
        await Promise.all([
          animate(x, step.x, { duration, ease }),
          animate(y, step.y, { duration, ease }),
        ])
      }
      if (step.gesture === 'drop') {
        setCarrying(false)
        const id = ++rippleSeq
        setRipples((r) => [...r, { id, x: x.get(), y: y.get() }])
        setTimeout(() => setRipples((r) => r.filter((p) => p.id !== id)), 750)
      }
      if (step.holdMs) await sleep(step.holdMs * rush)
    }

    const run = async () => {
      if (runningRef.current) return
      runningRef.current = true
      setCursorPlaying(true)
      clearTimeout(hideTimer.current)
      let perf
      while (aliveRef.current && (perf = nextPerformance())) {
        const hidden = scale.get() < 0.05
        if (perf.onlyIfVisible && hidden) {
          perf.done?.()
          continue
        }
        if (hidden) {
          // Materialize a short hop away from the first stop and glide in.
          const first = perf.steps[0]
          x.jump(Math.min(first.x + 80, STAGE_W - 30))
          y.jump(Math.min(first.y + 110, STAGE_H - 20))
          void animate(scale, 1, { type: 'spring', stiffness: 320, damping: 22 })
          setVisible(true)
        }
        // A queue building up means the agent is moving fast — pick up the pace,
        // but never rush a performance that chips are timed against.
        const rush = !perf.synced && queuedCount() >= 2 ? 0.6 : 1
        for (const step of perf.steps) {
          if (!aliveRef.current) break
          await playStep(step, rush)
        }
        // Frees any tool call holding its reply until this act finished.
        perf.done?.()
      }
      setCarrying(false)
      setCursorPlaying(false)
      runningRef.current = false
      if (aliveRef.current) {
        hideTimer.current = setTimeout(() => {
          setLabel(null)
          setVisible(false)
          void animate(scale, 0, { duration: 0.3, ease: 'easeIn' })
        }, IDLE_FADE_MS)
      }
    }

    const unsubscribe = onPerformance(() => void run())
    void run()
    return () => {
      aliveRef.current = false
      clearTimeout(hideTimer.current)
      unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      {ripples.map((r) => (
        <span key={r.id} className="agent-ripple" style={{ left: r.x, top: r.y }} />
      ))}
      <motion.div
        className={`agent-cursor${carrying ? ' carrying' : ''}`}
        style={{ x, y, scale, opacity: scale }}
        aria-hidden="true"
      >
        <svg className="agent-cursor-pointer" width="24" height="27" viewBox="0 0 24 27">
          <path
            d="M2.5 1.5 L21.5 11.8 L12.4 13.9 L7.6 23.5 Z"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
        <div className="agent-cursor-tag">✳ Agent</div>
        <AnimatePresence>
          {label && visible && (
            <motion.div
              key={label}
              className="agent-cursor-bubble"
              initial={{ opacity: 0, y: 5, scale: 0.92 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.95 }}
              transition={{ duration: 0.18 }}
            >
              {label}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </>
  )
}
