/**
 * View Transitions API helpers for iOS-style slide navigation.
 *
 * Wraps `router.push()` in `document.startViewTransition()` when supported,
 * with a direction attribute on the HTML element so CSS can apply the
 * right animation (forward = slide left, back = slide right).
 *
 * Uses `flushSync` inside the transition callback to force React to commit
 * the new route synchronously. This eliminates the tap-to-slide delay that
 * would otherwise be needed to wait for React's async scheduler to commit.
 * Combined with synchronous cache-based state initialization on destination
 * pages, the new page is fully rendered by the time the browser captures
 * its "after" snapshot.
 */

import { flushSync } from 'react-dom';

export type NavDirection = 'forward' | 'back';

interface RouterLike {
  push: (href: string) => void;
}

export function supportsViewTransitions(): boolean {
  return typeof document !== 'undefined' && 'startViewTransition' in document;
}

type ViewTransition = { finished: Promise<void> };
type StartViewTransition = (cb: () => unknown) => ViewTransition;

function getStart(): StartViewTransition | null {
  if (!supportsViewTransitions()) return null;
  return (document as unknown as { startViewTransition: StartViewTransition }).startViewTransition;
}

/**
 * Navigate to `href` with a view transition. Sets the `data-nav-direction`
 * attribute on the root element so CSS animations pick the right direction.
 * The entire page is treated as a single root snapshot — titles, content,
 * and layout all slide together.
 */
export function navigateWithTransition(
  router: RouterLike,
  href: string,
  direction: NavDirection = 'forward'
): void {
  const start = getStart();
  if (!start) {
    console.log('[viewTransitions] API not supported; falling back to router.push');
    router.push(href);
    return;
  }

  console.log(`[viewTransitions] starting ${direction} to ${href}`);
  const root = document.documentElement;
  root.setAttribute('data-nav-direction', direction);

  const cleanup = () => root.removeAttribute('data-nav-direction');

  try {
    const transition = start.call(document, () => {
      // flushSync forces React to commit router.push's update synchronously
      // inside this callback, so the destination page's DOM is in place
      // before the browser captures the "after" snapshot. Destination pages
      // initialize their state from the in-memory cache (so the first render
      // has real content, not a loading spinner).
      flushSync(() => {
        router.push(href);
      });
      console.log('[viewTransitions] navigation flushed, snapshot ready');
    });
    transition.finished.then(() => console.log('[viewTransitions] transition finished'));
    transition.finished.finally(cleanup);
  } catch (err) {
    console.log('[viewTransitions] error:', err);
    cleanup();
    router.push(href);
  }
}

/**
 * Navigate backward (history.back()) with a reverse-direction transition.
 */
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
    const transition = start.call(document, () => {
      flushSync(() => {
        window.history.back();
      });
    });
    transition.finished.finally(cleanup);
  } catch {
    cleanup();
    window.history.back();
  }
}
