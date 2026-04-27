/**
 * Per-question back-button override.
 *
 * When the create-question flow lands the user on a new question page, the natural
 * back destination is wherever they were when they opened the create modal
 * (home page, some thread, another question). We want back to lead to the thread
 * containing the new question instead.
 *
 * `set()` records the thread URL for a just-created question; `consume()` reads
 * and removes it. Scoped to `sessionStorage`, so entries disappear on tab
 * close. Key namespace: `questionBackTarget:<questionRouteId>`.
 */

import { normalizePath } from './questionId';

const KEY_PREFIX = 'questionBackTarget:';

/** Record `/thread/<threadRootRouteId>` as the back destination for the given
 *  question page. Skipped when the page currently underneath the create modal
 *  already matches — natural `history.back()` will land there anyway, and an
 *  explicit override would just add a duplicate history entry. */
export function set(questionRouteId: string, threadRootRouteId: string): void {
  if (typeof window === 'undefined') return;
  const threadPath = `/thread/${threadRootRouteId}`;
  if (normalizePath(window.location.pathname) === threadPath) return;
  sessionStorage.setItem(KEY_PREFIX + questionRouteId, threadPath);
}

/** Read and remove the custom back target for a question. Returns null if none. */
export function consume(questionRouteId: string): string | null {
  if (typeof window === 'undefined') return null;
  const key = KEY_PREFIX + questionRouteId;
  const value = sessionStorage.getItem(key);
  if (value !== null) sessionStorage.removeItem(key);
  return value;
}
