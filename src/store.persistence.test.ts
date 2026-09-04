import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from './store'

describe('chart persistence', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useStore.getState().resetAll()
    vi.clearAllTimers()
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('ignores transient interface updates', () => {
    const setItem = vi.spyOn(localStorage, 'setItem')

    useStore.getState().setToast('Saved')
    useStore.getState().setSelection(null)
    useStore.getState().logActivity('test', 'Transient event.')
    vi.advanceTimersByTime(500)

    expect(setItem).not.toHaveBeenCalled()
  })

  it('persists chart changes after the debounce', () => {
    const setItem = vi.spyOn(localStorage, 'setItem')

    useStore.getState().addGuest({ name: 'Ana Ruiz' })
    vi.advanceTimersByTime(299)
    expect(setItem).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(setItem).toHaveBeenCalledTimes(1)
    expect(JSON.parse(setItem.mock.calls[0][1]).guestOrder).toHaveLength(1)
  })
})
