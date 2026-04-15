/**
 * Per-poll back-button override.
 *
 * When the create-poll flow lands the user on a new poll page, the natural
 * back destination is wherever they were when they opened the create modal
 * (home page, some thread, another poll). We want back to lead to the thread
 * containing the new poll instead.
 *
 * `set()` records the thread URL for a just-created poll; `consume()` reads
 * and removes it. Scoped to `sessionStorage`, so entries disappear on tab
 * close. Key namespace: `pollBackTarget:<pollRouteId>`.
 */

import { normalizePath } from './pollId';

const KEY_PREFIX = 'pollBackTarget:';

/** Record `/thread/<threadRootRouteId>` as the back destination for the given
 *  poll page. Skipped when the page currently underneath the create modal
 *  already matches — natural `history.back()` will land there anyway, and an
 *  explicit override would just add a duplicate history entry. */
export function set(pollRouteId: string, threadRootRouteId: string): void {
  if (typeof window === 'undefined') return;
  const threadPath = `/thread/${threadRootRouteId}`;
  if (normalizePath(window.location.pathname) === threadPath) return;
  sessionStorage.setItem(KEY_PREFIX + pollRouteId, threadPath);
}

/** Read and remove the custom back target for a poll. Returns null if none. */
export function consume(pollRouteId: string): string | null {
  if (typeof window === 'undefined') return null;
  const key = KEY_PREFIX + pollRouteId;
  const value = sessionStorage.getItem(key);
  if (value !== null) sessionStorage.removeItem(key);
  return value;
}
