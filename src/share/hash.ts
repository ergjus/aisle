/**
 * The one fact about share links the store needs at startup — whether the
 * page was opened from one — kept free of imports so the store can ask it
 * without pulling in the codec (or a cycle back to itself).
 */

export const SHARE_HASH_PREFIX = '#share='

export function isShareHash(hash: string | null | undefined): boolean {
  return typeof hash === 'string' && hash.startsWith(SHARE_HASH_PREFIX)
}

/** True when the current page was opened from a share link. */
export function launchedFromShareLink(): boolean {
  try {
    return typeof location !== 'undefined' && isShareHash(location.hash)
  } catch {
    return false
  }
}
