/**
 * View Transitions API helpers for iOS-style slide navigation.
 *
 * `navigateWithTransition` wraps `router.push` in `document.startViewTransition`
 * and waits for the destination to commit + signal `data-page-ready` before
 * the callback resolves, so the browser's "new" snapshot is captured from a
 * fully rendered page rather than a stale DOM.
 */

import { normalizePath } from './pollId';

export type NavDirection = 'forward' | 'back';

interface RouterLike {
  push: (href: string) => void;
  replace: (href: string) => void;
}

export function supportsViewTransitions(): boolean {
  return typeof document !== 'undefined' && 'startViewTransition' in document;
}

// Next.js App Router calls `history.pushState` internally, which doesn't fire
// `popstate`. We patch pushState/replaceState to dispatch a custom event so
// waits can be event-driven instead of polling.
const URL_CHANGE_EVENT = '__app:urlchange';
declare global {
  interface Window { __urlEventInstalled?: boolean }
}
if (typeof window !== 'undefined' && !window.__urlEventInstalled) {
  window.__urlEventInstalled = true;
  const dispatch = () => window.dispatchEvent(new Event(URL_CHANGE_EVENT));
  const origPush = window.history.pushState.bind(window.history);
  const origReplace = window.history.replaceState.bind(window.history);
  window.history.pushState = function (...args) {
    const ret = origPush(...(args as Parameters<typeof origPush>));
    try { dispatch(); } catch {}
    return ret;
  };
  window.history.replaceState = function (...args) {
    const ret = origReplace(...(args as Parameters<typeof origReplace>));
    try { dispatch(); } catch {}
    return ret;
  };
  window.addEventListener('popstate', dispatch);
}

/** Await a URL-change predicate, with a 50 ms safety poll for URL mutations
 *  that bypass history.*State, plus a deadline. Returns true on predicate pass. */
async function waitForUrlChange(predicate: () => boolean, deadline: number): Promise<boolean> {
  if (predicate()) return true;
  return new Promise<boolean>((resolve) => {
    let timeoutId: ReturnType<typeof setTimeout>;
    const cleanup = () => {
      window.removeEventListener(URL_CHANGE_EVENT, check);
      clearTimeout(timeoutId);
    };
    const check = () => {
      if (predicate()) { cleanup(); resolve(true); }
      else if (Date.now() >= deadline) { cleanup(); resolve(false); }
      else { timeoutId = setTimeout(check, 50); }
    };
    window.addEventListener(URL_CHANGE_EVENT, check);
    check();
  });
}

/** Wait for `data-page-ready` on <html> to match `target` before `deadline`. */
function waitForPageReady(target: string, deadline: number): Promise<boolean> {
  const matches = () => document.documentElement.getAttribute('data-page-ready') === target;
  if (matches()) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    const cleanup = () => {
      observer.disconnect();
      clearTimeout(timeoutId);
    };
    const observer = new MutationObserver(() => {
      if (matches()) { cleanup(); resolve(true); }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-page-ready'] });
    const timeoutId = setTimeout(() => { cleanup(); resolve(false); }, Math.max(0, deadline - Date.now()));
  });
}

/** Wait for the destination to commit. Returns true only if the URL flipped
 *  AND `data-page-ready` matches the target before the deadline. */
async function waitForNavigation(targetPath: string, timeoutMs = 3000): Promise<boolean> {
  const target = normalizePath(targetPath);
  const deadline = Date.now() + timeoutMs;

  const urlOk = await waitForUrlChange(
    () => normalizePath(window.location.pathname) === target,
    deadline,
  );
  if (!urlOk) return false;

  return waitForPageReady(target, deadline);
}

type ViewTransition = { finished: Promise<void> };
type StartViewTransition = (cb: () => unknown) => ViewTransition;

function getStart(): StartViewTransition | null {
  if (!supportsViewTransitions()) return null;
  return (document as unknown as { startViewTransition: StartViewTransition }).startViewTransition;
}

export function navigateWithTransition(
  router: RouterLike,
  href: string,
  direction: NavDirection = 'forward',
  { mode = 'push' }: { mode?: 'push' | 'replace' } = {},
): void {
  const targetPath = new URL(href, window.location.origin).pathname;
  // Same-path no-op: router.push(currentPath) won't change anything, but
  // startViewTransition would still animate identical old/new snapshots.
  if (normalizePath(targetPath) === normalizePath(window.location.pathname)) return;

  const navigate = () => router[mode](href);
  const start = getStart();
  if (!start) {
    navigate();
    return;
  }

  const root = document.documentElement;
  root.setAttribute('data-nav-direction', direction);

  const cleanup = () => root.removeAttribute('data-nav-direction');

  try {
    const transition = start.call(document, async () => {
      navigate();
      const ready = await waitForNavigation(targetPath);
      // Throwing aborts the transition (per spec): the browser skips the
      // animation rather than capturing a stale DOM as the "new" snapshot.
      if (!ready) throw new Error('page-not-ready');
    });
    transition.finished.catch(() => {}).finally(cleanup);
  } catch {
    cleanup();
    navigate();
  }
}

// Session-scoped in-app navigation counter (per-tab, cleared on tab close).
// Incremented in template.tsx on each client-side navigation.
export const NAV_COUNT_KEY = 'app_nav_count';

export function hasAppHistory(): boolean {
  if (typeof window === 'undefined') return false;
  const count = parseInt(sessionStorage.getItem(NAV_COUNT_KEY) || '0', 10);
  return count > 1;
}

export function navigateBackWithTransition(): void {
  const start = getStart();
  if (!start) {
    window.history.back();
    return;
  }

  const root = document.documentElement;
  root.setAttribute('data-nav-direction', 'back');

  const cleanup = () => root.removeAttribute('data-nav-direction');

  try {
    const previousPath = window.location.pathname;
    const transition = start.call(document, async () => {
      const deadline = Date.now() + 3000;
      window.history.back();
      const urlOk = await waitForUrlChange(
        () => window.location.pathname !== previousPath,
        deadline,
      );
      if (!urlOk) throw new Error('page-not-ready');
      const target = normalizePath(window.location.pathname);
      const ready = await waitForPageReady(target, deadline);
      if (!ready) throw new Error('page-not-ready');
    });
    transition.finished.catch(() => {}).finally(cleanup);
  } catch {
    cleanup();
    window.history.back();
  }
}
