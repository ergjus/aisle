import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { useStore } from './store'
import { Header } from './components/Header'
import { Sidebar } from './components/Sidebar'
import { Canvas } from './components/Canvas'
import { Editors } from './components/Editors'
import { AgentChat } from './components/AgentChat'
import { probeHostedAgent } from './agent/hosted'
import { SharedViewBar, SharedViewError } from './components/SharedViewBar'
import { readFirstRunGate, readOnboardingRecord } from './onboarding/storage'

const OnboardingExperience = lazy(() => import('./onboarding/OnboardingExperience'))

const SIDEBAR_KEY = 'aisle:sidebar:collapsed'

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
  const [initialFirstRun] = useState(() => {
    const state = useStore.getState()
    // Someone opening a share link came to see that chart, not a welcome tour.
    if (state.viewMode === 'shared') return false
    return readFirstRunGate(state.guestOrder.length > 0 || state.tableOrder.length > 0)
  })
  const [guideRequest, setGuideRequest] = useState(0)
  const [sidebarOpen, setSidebarOpen] = useState(readSidebarOpen)
  const [loadOnboardingBundle, setLoadOnboardingBundle] = useState(() => {
    if (useStore.getState().viewMode === 'shared') return false
    const record = readOnboardingRecord()
    return initialFirstRun || record?.challenge.status === 'active'
  })

  const setSidebar = useCallback((open: boolean) => {
    setSidebarOpen(open)
    persistSidebarOpen(open)
  }, [])

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
      if (useStore.getState().viewMode === 'shared') return
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
        onWelcomeGuide={() => {
          setLoadOnboardingBundle(true)
          setGuideRequest((request) => request + 1)
        }}
      />
      {shared ? (
        // A share link: someone else's chart, view only — no sidebar, no
        // editors, just the room, a way to find your seat, and Print.
        <>
          <SharedViewBar />
          {sharedView?.status === 'error' ? <SharedViewError message={sharedView.error ?? ''} /> : <Canvas />}
        </>
      ) : (
        <>
          {/* The sidebar folds down to a rail so the floor plan can have the whole
              window; the grid column animates rather than snapping. */}
          <div
            className={cn(
              'grid min-h-0 grid-cols-1 transition-[grid-template-columns] duration-200 ease-out motion-reduce:transition-none',
              sidebarOpen ? 'md:grid-cols-[248px_minmax(0,1fr)]' : 'md:grid-cols-[56px_minmax(0,1fr)]',
            )}
          >
            <Sidebar open={sidebarOpen} onOpenChange={setSidebar} />
            <Canvas />
          </div>
          <Editors />
          <AgentChat />
        </>
      )}
      {loadOnboardingBundle && !shared ? (
        <Suspense fallback={null}>
          <OnboardingExperience initialFirstRun={initialFirstRun} guideRequest={guideRequest} />
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
