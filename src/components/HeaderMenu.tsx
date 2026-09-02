import { useEffect, useId, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

export type MenuEntry =
  | {
      label: string
      /** Faint right-aligned hint — a shortcut or a count. */
      hint?: string
      onSelect: () => void
      danger?: boolean
      disabled?: boolean
    }
  | 'separator'

/**
 * The masthead's overflow menu: the rarely-pressed actions (sample wedding,
 * guide, shortcuts, reset) folded behind one quiet control so the header can
 * carry a single primary action instead of a row of buttons. Hand-rolled on
 * purpose — role="menu", arrow keys, Escape, click-outside — so it can sit in
 * the paper-and-hairline style of the rest of the chrome.
 */
export function HeaderMenu({ entries, label = 'More' }: { entries: MenuEntry[]; label?: string }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        return
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])]
      if (items.length === 0) return
      e.preventDefault()
      const index = items.indexOf(document.activeElement as HTMLButtonElement)
      const next = e.key === 'ArrowDown' ? (index + 1) % items.length : (index - 1 + items.length) % items.length
      items[next]?.focus()
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    // Land focus on the first item so the keyboard has somewhere to start.
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus()
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded-md border text-[17px] leading-none text-ink-soft transition-colors',
          open ? 'border-hairline bg-parchment text-ink' : 'border-transparent hover:border-hairline hover:bg-parchment/70 hover:text-ink',
        )}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={label}
        title={label}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden="true" className="-mt-1">⋯</span>
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          className="animate-in fade-in slide-in-from-top-1 absolute top-[calc(100%+6px)] right-0 z-[70] min-w-[228px] rounded-md border border-hairline bg-card p-1 shadow-[0_14px_34px_-14px_rgba(41,36,29,0.45),0_1px_0_rgba(41,36,29,0.06)] duration-100"
        >
          {entries.map((entry, i) =>
            entry === 'separator' ? (
              <div key={`sep-${i}`} role="separator" className="my-1 border-t border-hairline/80" />
            ) : (
              <button
                key={entry.label}
                type="button"
                role="menuitem"
                disabled={entry.disabled}
                className={cn(
                  'flex w-full items-center justify-between gap-4 rounded-[4px] px-2.5 py-1.5 text-left text-[12.5px] outline-none',
                  'hover:bg-parchment focus-visible:bg-parchment disabled:opacity-45 disabled:hover:bg-transparent',
                  entry.danger ? 'text-brick' : 'text-ink',
                )}
                onClick={() => {
                  setOpen(false)
                  entry.onSelect()
                }}
              >
                <span>{entry.label}</span>
                {entry.hint && <span className="figures text-[11px] text-ink-soft">{entry.hint}</span>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  )
}
