import { hasSavedChart, useStore } from '../store'
import { ShareLinkError, decodeShareLink } from './codec'
import { isShareHash } from './hash'

/**
 * Share-link routing: opening a "#share=…" link puts that chart on screen in
 * the store's read-only shared view; leaving the fragment (or pressing Back)
 * returns to the viewer's own chart. The store keeps persistence suspended
 * the whole time, so the viewer's saved chart is never read over or written.
 */

let openSeq = 0

async function openShareLink(hash: string): Promise<void> {
  const seq = ++openSeq
  const store = useStore.getState()
  store.beginSharedView()
  try {
    const decoded = await decodeShareLink(hash)
    if (seq !== openSeq) return
    useStore.getState().showSharedChart(decoded.state, { title: decoded.title, hasNotes: decoded.hasNotes })
  } catch (err) {
    if (seq !== openSeq) return
    const message = err instanceof ShareLinkError
      ? err.message
      : 'Something went wrong opening this link. Ask whoever sent it for a fresh one.'
    useStore.getState().failSharedView(message)
  }
}

let routingStarted = false

export function initShareRouting(): void {
  if (routingStarted) return
  routingStarted = true
  if (isShareHash(location.hash)) void openShareLink(location.hash)
  window.addEventListener('hashchange', () => {
    if (isShareHash(location.hash)) {
      void openShareLink(location.hash)
    } else if (useStore.getState().viewMode === 'shared') {
      openSeq++
      useStore.getState().leaveSharedView()
    }
  })
}

/** Drops the share fragment from the address bar without reloading or adding history. */
function clearShareHash(): void {
  try {
    history.replaceState(history.state, '', `${location.pathname}${location.search}`)
  } catch {
    // An address bar we can't tidy is harmless.
  }
}

/** Leave the shared chart and return to the viewer's own. */
export function exitSharedView(): void {
  openSeq++
  clearShareHash()
  useStore.getState().leaveSharedView()
}

/**
 * "Make a copy to edit": the shared chart becomes the viewer's own saved
 * chart — after a confirm when that would replace one they already have.
 * Returns whether the copy was made.
 */
export function copySharedChartToMine(confirmReplace: (message: string) => boolean = (m) => window.confirm(m)): boolean {
  const s = useStore.getState()
  if (s.viewMode !== 'shared' || s.sharedView?.status !== 'ready') return false
  if (
    hasSavedChart() &&
    !confirmReplace('Replace your own seating chart with a copy of this one? Your current chart on this device will be overwritten.')
  ) {
    return false
  }
  openSeq++
  useStore.getState().adoptSharedChart()
  clearShareHash()
  useStore.getState().setToast('This chart is now yours to edit — saved in this browser.')
  return true
}
