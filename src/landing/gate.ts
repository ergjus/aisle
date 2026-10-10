/**
 * Who sees the landing page. Someone with nothing of their own in this
 * browser and no account is a visitor, and gets the front door; anyone who
 * has stepped inside once (or has a chart saved here) lands on their home
 * screen. Once accounts arrive, a signed-in session will count as entered too.
 */

const ENTERED_KEY = 'aisle:entered'
const CHART_KEY = 'aisle:v1'
const EVENT_KEY = 'aisle:event:v1'

export function hasEntered(): boolean {
  try {
    return (
      localStorage.getItem(ENTERED_KEY) === '1' ||
      localStorage.getItem(CHART_KEY) !== null ||
      localStorage.getItem(EVENT_KEY) !== null
    )
  } catch {
    // No storage: nothing to come back to, so the visitor sees the front door once per load.
    return false
  }
}

export function markEntered(): void {
  try {
    localStorage.setItem(ENTERED_KEY, '1')
  } catch {
    // The visitor will see the landing again next time; nothing else breaks.
  }
}
