import { lazy, Suspense, useCallback, useEffect, useState, type CSSProperties } from 'react'
import { cn } from '@/lib/utils'
import { useStore } from './store'
import { Header } from './components/Header'
import { Home, type PlanSection } from './components/Home'
import { Sidebar } from './components/Sidebar'
import { Canvas } from './components/Canvas'
import { Editors } from './components/Editors'
import { AgentChat } from './components/AgentChat'
import { probeHostedAgent, useHostedAgent } from './agent/hosted'
import { SharedViewBar, SharedViewError } from './components/SharedViewBar'

const OnboardingExperience = lazy(() => import('./onboarding/OnboardingExperience'))

const SIDEBAR_KEY = 'aisle:sidebar:collapsed'
const SIDEBAR_SECTION_KEY = 'aisle:sidebar:active'

function readSidebarOpen(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) !== '1'
  } catch {
    return true
  }
}

function persistSidebarOpen(open: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_KEY, open ? '0' : '1')
  } catch {
    // Preference simply won't stick.
  }
}

export default function App() {
  const toast = useStore((s) => s.toast)
  const setToast = useStore((s) => s.setToast)
  const shared = useStore((s) => s.viewMode === 'shared')
  const sharedView = useStore((s) => s.sharedView)
  const home = useStore((s) => s.screen === 'home') && !shared
  const [sampleRoomRequest, setSampleRoomRequest] = useState(0)
  const [sidebarOpen, setSidebarOpen] = useState(readSidebarOpen)
  const agentReady = useHostedAgent((s) => s.status === 'ready')
  const agentOpen = useHostedAgent((s) => s.open)
  // The questionnaire bundle loads only once someone asks for a sample room;
  // a first visit lands on the home screen, which offers the ways to begin.
  const [loadOnboardingBundle, setLoadOnboardingBundle] = useState(false)

  const setSidebar = useCallback((open: boolean) => {
    setSidebarOpen(open)
    persistSidebarOpen(open)
  }, [])

  // From the home screen into the floor plan, opening the plan sidebar on the
  // section the tile named (the sidebar reads its section when it mounts).
  const openChart = useCallback((section?: PlanSection) => {
    if (section) {
      try {
        localStorage.setItem(SIDEBAR_SECTION_KEY, section)
      } catch {
        // The chart still opens, just on whatever section it had.
      }
      setSidebar(true)
    }
    useStore.getState().openChart()
  }, [setSidebar])

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((open) => {
      const next = !open
      persistSidebarOpen(next)
      return next
    })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      if (!meta) return
      const key = e.key.toLowerCase()
      if (key !== 'z' && key !== 'b') return
      // A shared chart is view-only: no history to walk, no sidebar to fold.
      // The home screen has neither, either.
      const state = useStore.getState()
      if (state.viewMode === 'shared' || state.screen === 'home') return
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      e.preventDefault()
      if (key === 'b') {
        toggleSidebar()
        return
      }
      const store = useStore.getState()
      if (e.shiftKey) store.redo()
      else store.undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleSidebar])

  useEffect(() => {
    void probeHostedAgent()
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast, setToast])

  return (
    <div className={cn('grid h-screen', shared ? 'grid-rows-[auto_auto_minmax(0,1fr)]' : 'grid-rows-[auto_minmax(0,1fr)]')}>
      <Header
        onSampleRoom={() => {
          setLoadOnboardingBundle(true)
          setSampleRoomRequest((request) => request + 1)
        }}
      />
      {shared ? (
        // A share link: someone else's chart, view only — no sidebar, no
        // editors, just the room, a way to find your seat, and Print.
        <>
          <SharedViewBar />
          {sharedView?.status === 'error' ? <SharedViewError message={sharedView.error ?? ''} /> : <Canvas />}
        </>
      ) : home ? (
        <Home onOpenChart={openChart} />
      ) : (
        <>
          {/* Two sidebars around the floor plan: the agent's chat on the left
              and the plan on the right. Each folds down to a rail so the floor
              plan can have the room; the columns animate rather than snapping. */}
          <div
            className={cn(
              'grid min-h-0 grid-cols-1 transition-[grid-template-columns] duration-200 ease-out motion-reduce:transition-none',
              'md:grid-cols-[var(--agent-col)_minmax(0,1fr)_var(--plan-col)]',
            )}
            style={{
              '--agent-col': agentReady ? (agentOpen ? '320px' : '44px') : '0px',
              '--plan-col': sidebarOpen ? '248px' : '56px',
            } as CSSProperties}
          >
            <div className="hidden min-h-0 overflow-hidden md:flex md:flex-col">
              <AgentChat docked />
            </div>
            <Canvas />
            <Sidebar open={sidebarOpen} onOpenChange={setSidebar} />
          </div>
          <Editors />
          <div className="md:hidden">
            <AgentChat />
          </div>
        </>
      )}
      {loadOnboardingBundle && !shared ? (
        <Suspense fallback={null}>
          <OnboardingExperience initialFirstRun={false} sampleRoomRequest={sampleRoomRequest} />
        </Suspense>
      ) : null}
      {toast && (
        <div
          className="animate-in fade-in slide-in-from-bottom-2 fixed bottom-6 left-1/2 z-[80] max-w-[70vw] -translate-x-1/2 rounded-lg border border-gold/50 bg-pine-950/95 px-4 py-2 text-[13px] text-linen"
          role="status"
          aria-live="polite"
        >
          {toast}
        </div>
      )}
    </div>
  )
}
