import { useEffect } from 'react'
import { useStore } from './store'
import { Header } from './components/Header'
import { GuestPanel } from './components/GuestPanel'
import { Canvas } from './components/Canvas'
import { RightPanel } from './components/RightPanel'
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
    <div className="app">
      <Header />
      <div className="main">
        <GuestPanel />
        <Canvas />
        <RightPanel />
      </div>
      <Editors />
      {toast && (
        <div className="toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </div>
  )
}
