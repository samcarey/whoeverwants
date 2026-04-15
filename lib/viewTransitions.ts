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
}

export function supportsViewTransitions(): boolean {
  return typeof document !== 'undefined' && 'startViewTransition' in document;
}

async function waitForNavigation(targetPath: string, timeoutMs = 1500): Promise<void> {
  const target = normalizePath(targetPath);
  const deadline = Date.now() + timeoutMs;

  // Phase 1: wait for the URL to change.
  while (normalizePath(window.location.pathname) !== target && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10));
  }

  // Phase 2: wait for the destination page to render. Uses MutationObserver
  // on <html> attributes so we fire the instant `data-page-ready` is set.
  const contentDeadline = Math.min(deadline, Date.now() + 1000);
  const alreadyReady = document.documentElement.getAttribute('data-page-ready') === target;
  if (!alreadyReady) {
    await new Promise<void>((resolve) => {
      const observer = new MutationObserver(() => {
        if (document.documentElement.getAttribute('data-page-ready') === target) {
          observer.disconnect();
          resolve();
        }
      });
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-page-ready'] });
      const timeoutId = setTimeout(() => {
        observer.disconnect();
        resolve();
      }, Math.max(0, contentDeadline - Date.now()));
      // In case attribute was set between our check and observer.observe
      if (document.documentElement.getAttribute('data-page-ready') === target) {
        clearTimeout(timeoutId);
        observer.disconnect();
        resolve();
      }
    });
  }
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
  direction: NavDirection = 'forward'
): void {
  const start = getStart();
  if (!start) {
    router.push(href);
    return;
  }

  const root = document.documentElement;
  root.setAttribute('data-nav-direction', direction);

  const cleanup = () => root.removeAttribute('data-nav-direction');

  const targetPath = new URL(href, window.location.origin).pathname;
  try {
    const transition = start.call(document, async () => {
      router.push(href);
      await waitForNavigation(targetPath);
    });
    transition.finished.finally(cleanup);
  } catch {
    cleanup();
    router.push(href);
  }
}

interface RouterReplace {
  replace: (href: string) => void;
}

/** Like navigateWithTransition but uses router.replace — the current history
 *  entry is replaced rather than a new one pushed. Used when the current URL
 *  is a transient/synthetic one (e.g., a just-created poll page that should
 *  yield to the thread URL in history). */
export function navigateReplaceWithTransition(
  router: RouterReplace,
  href: string,
  direction: NavDirection = 'back'
): void {
  const start = getStart();
  if (!start) {
    router.replace(href);
    return;
  }

  const root = document.documentElement;
  root.setAttribute('data-nav-direction', direction);

  const cleanup = () => root.removeAttribute('data-nav-direction');

  const targetPath = new URL(href, window.location.origin).pathname;
  try {
    const transition = start.call(document, async () => {
      router.replace(href);
      await waitForNavigation(targetPath);
    });
    transition.finished.finally(cleanup);
  } catch {
    cleanup();
    router.replace(href);
  }
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
