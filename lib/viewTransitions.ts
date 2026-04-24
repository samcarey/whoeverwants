/**
 * View Transitions API helpers for iOS-style slide navigation.
 *
 * Wraps `router.push()` in `document.startViewTransition()` with a direction
 * attribute on the HTML element so CSS applies the right animation.
 *
 * Waits for the destination page to signal `data-page-ready` on <html>
 * before letting the callback resolve, so the browser's "after" snapshot
 * contains a fully rendered page. Destination pages initialize their state
 * synchronously from the in-memory cache and set `data-page-ready` in a
 * `useLayoutEffect` as soon as they commit.
 *
 * Trade-off: a short pause (~100-300ms on mobile) between tap and slide
 * start, during which the old page is frozen while React commits the new
 * route. The alternative — starting the slide immediately — shows an
 * empty/partial new page during the animation on slower devices because
 * Next.js App Router's router.push is async internally (flushSync doesn't
 * force it to commit synchronously).
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

/**
 * Wait for the destination to commit. Returns `true` if BOTH the URL flipped
 * AND the destination signaled `data-page-ready` before the deadline, `false`
 * if either phase timed out. Callers use the boolean to decide whether to
 * allow the view transition to animate (ready) or to abort it (not ready)
 * so the browser skips the slide rather than animating a stale snapshot.
 */
async function waitForNavigation(targetPath: string, timeoutMs = 3000): Promise<boolean> {
  const target = normalizePath(targetPath);
  const deadline = Date.now() + timeoutMs;

  // Phase 1: wait for the URL to change.
  while (normalizePath(window.location.pathname) !== target && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10));
  }
  if (normalizePath(window.location.pathname) !== target) return false;

  // Phase 2: wait for the destination page to render. Uses MutationObserver
  // on <html> attributes so we fire the instant `data-page-ready` is set.
  if (document.documentElement.getAttribute('data-page-ready') === target) return true;

  return new Promise<boolean>((resolve) => {
    const observer = new MutationObserver(() => {
      if (document.documentElement.getAttribute('data-page-ready') === target) {
        observer.disconnect();
        resolve(true);
      }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-page-ready'] });
    const timeoutId = setTimeout(() => {
      observer.disconnect();
      resolve(false);
    }, Math.max(0, deadline - Date.now()));
    // In case attribute was set between our check and observer.observe
    if (document.documentElement.getAttribute('data-page-ready') === target) {
      clearTimeout(timeoutId);
      observer.disconnect();
      resolve(true);
    }
  });
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
  // Same-path early return: `router.push(currentPath)` is a no-op in App
  // Router, but `startViewTransition` would still animate an identical
  // old/new snapshot pair. Skip the whole thing. Also covers the case where
  // `history.replaceState` (from card expand/collapse) has already put the
  // URL at the target.
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
      if (!ready) {
        // Destination didn't commit in time — abort the transition by
        // rejecting the callback promise. Per the View Transitions spec this
        // skips the animation, so the browser does an instant page swap
        // instead of capturing a stale DOM snapshot as the "new" state.
        // The navigation itself still happens — we called navigate() above.
        throw new Error('page-not-ready');
      }
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
      window.history.back();
      const started = Date.now();
      while (window.location.pathname === previousPath && Date.now() - started < 800) {
        await new Promise((r) => setTimeout(r, 10));
      }
      await new Promise((r) => setTimeout(r, 120));
    });
    transition.finished.finally(cleanup);
  } catch {
    cleanup();
    window.history.back();
  }
}
