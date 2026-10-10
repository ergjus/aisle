/**
 * The wedding itself — its name, date and venue — as the couple wrote it on
 * the home screen. It heads the printed document and the share link, and it
 * is saved beside the chart rather than inside it: not a seating change, so
 * never part of undo, and never anything a shared chart carries into the
 * viewer's own saved wedding.
 */

export interface EventDetails {
  title: string
  date: string
  venueName: string
}

const EVENT_STORAGE_KEY = 'aisle:event:v1'

export const EMPTY_EVENT: EventDetails = { title: '', date: '', venueName: '' }

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function loadEvent(): EventDetails {
  try {
    const raw = localStorage.getItem(EVENT_STORAGE_KEY)
    if (!raw) return EMPTY_EVENT
    const parsed = JSON.parse(raw)
    return { title: text(parsed?.title), date: text(parsed?.date), venueName: text(parsed?.venueName) }
  } catch {
    return EMPTY_EVENT
  }
}

export function saveEvent(event: EventDetails): void {
  try {
    localStorage.setItem(EVENT_STORAGE_KEY, JSON.stringify(event))
  } catch {
    // Storage unavailable; the names simply won't stick.
  }
}

/** Which screen the app opens on, remembered for the tab so a reload lands where you were. */
export type Screen = 'home' | 'chart'

const SCREEN_STORAGE_KEY = 'aisle:screen'

export function loadScreen(): Screen {
  try {
    return sessionStorage.getItem(SCREEN_STORAGE_KEY) === 'chart' ? 'chart' : 'home'
  } catch {
    return 'home'
  }
}

export function saveScreen(screen: Screen): void {
  try {
    sessionStorage.setItem(SCREEN_STORAGE_KEY, screen)
  } catch {
    // Preference simply won't stick.
  }
}
