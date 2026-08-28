import { useEffect } from 'react'
import { useStore } from './store'
import { Header } from './components/Header'
import { Sidebar } from './components/Sidebar'
import { Canvas } from './components/Canvas'
import { Editors } from './components/Editors'

export default function App() {
  const toast = useStore((s) => s.toast)
  const setToast = useStore((s) => s.setToast)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      if (!meta || e.key.toLowerCase() !== 'z') return
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      e.preventDefault()
      const store = useStore.getState()
      if (e.shiftKey) store.redo()
      else store.undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast, setToast])

  return (
    <div className="grid h-screen grid-rows-[auto_minmax(0,1fr)]">
      <Header />
      <div className="grid min-h-0 grid-cols-1 md:grid-cols-[300px_minmax(0,1fr)]">
        <Sidebar />
        <Canvas />
      </div>
      <Editors />
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
