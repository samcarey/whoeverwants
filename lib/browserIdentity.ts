/**
 * Phase B.3: per-browser identity that bridges to Phase C (membership).
 *
 * The server's `BrowserIdMiddleware` mints a uuid4 on first visit and echoes
 * it via the `X-Browser-Id` response header. The FE captures the value and
 * persists it to localStorage so subsequent requests carry the same id via
 * the matching request header.
 *
 * `getBrowserId()` returns the stored id or `null` until the first response
 * arrives. `adoptServerBrowserId(value)` is called from the API fetch wrapper
 * whenever the server header is present — first-write wins; later writes
 * (same value) are no-ops; conflicting values are logged and ignored so a
 * compromised middlebox can't rewrite the id mid-session.
 *
 * Phase C will switch reads on the server to drive visibility off this id
 * (via a `thread_members` table). For Phase B.3 it's pure scaffolding.
 */

const STORAGE_KEY = 'browser_id';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let cached: string | null | undefined; // undefined = not yet read from storage

function readFromStorage(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v && UUID_RE.test(v) ? v : null;
  } catch {
    return null;
  }
}

function writeToStorage(value: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Quota / privacy mode — accept the in-memory value and move on.
  }
}

/** Current browser id, or null if the server hasn't issued one yet. */
export function getBrowserId(): string | null {
  if (cached === undefined) cached = readFromStorage();
  return cached;
}

/** Adopt the value the server returned via `X-Browser-Id`. Idempotent
 *  when the value matches what's stored; logs and skips on conflict. */
export function adoptServerBrowserId(value: string | null | undefined): void {
  if (!value || !UUID_RE.test(value)) return;
  if (cached === undefined) cached = readFromStorage();
  if (cached === value) return;
  if (cached) {
    // Persist the existing one and ignore the new value — first-write wins.
    // Logging the divergence helps catch proxy / middlebox shenanigans.
    if (typeof console !== 'undefined') {
      console.warn(
        '[browser_id] server returned different id; keeping existing',
        cached.slice(0, 8) + '...',
        'vs',
        value.slice(0, 8) + '...',
      );
    }
    return;
  }
  cached = value;
  writeToStorage(value);
}

/** Reset for tests. Not for production use. */
export function _resetBrowserIdForTests(): void {
  cached = undefined;
  if (typeof window !== 'undefined') {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  }
}
