/**
 * View Transitions API helpers for iOS-style slide navigation.
 *
 * Wraps `router.push()` in `document.startViewTransition()` when supported,
 * with a direction attribute on the HTML element so CSS can apply the
 * right animation (forward = slide left, back = slide right).
 *
 * Shared-element "hero" transitions: both source and destination pages
 * tag their title element with `view-transition-name: hero-title`, so
 * the browser automatically animates the title from one position to
 * the other (e.g., a list item's title morphs into the page header).
 * Only one element per page can have a given view-transition-name, so
 * callers should tag the element just before navigating and clean up
 * after the transition finishes.
 */

export type NavDirection = 'forward' | 'back';

interface RouterLike {
  push: (href: string) => void;
}

export function supportsViewTransitions(): boolean {
  return typeof document !== 'undefined' && 'startViewTransition' in document;
}

/**
 * Wait for the browser URL pathname to match `targetPath`, plus a small
 * delay for React to commit the new route's DOM. Used by the view transition
 * callback so the browser doesn't capture the "after" snapshot before the
 * new page has rendered.
 *
 * Normalizes trailing slashes. Do NOT use requestAnimationFrame —
 * the browser pauses rendering during the view transition callback.
 */
async function waitForNavigation(targetPath: string, timeoutMs = 800): Promise<void> {
  const normalize = (p: string) => p.replace(/\/$/, '') || '/';
  const target = normalize(targetPath);
  const urlStart = Date.now();
  while (normalize(window.location.pathname) !== target && Date.now() - urlStart < timeoutMs) {
    await new Promise((r) => setTimeout(r, 10));
  }
  // URL has changed — now wait a short tick for React to commit the new DOM.
  // setTimeout still fires inside the view transition callback (only rAF is paused).
  await new Promise((r) => setTimeout(r, 120));
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
 * and layout all slide together. No shared-element hero morphs for now
 * (destination pages have async data-load states that prevent the hero
 * element from existing when the "new" snapshot is captured).
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

  const targetPath = new URL(href, window.location.origin).pathname;
  try {
    const transition = start.call(document, async () => {
      router.push(href);
      await waitForNavigation(targetPath);
      console.log('[viewTransitions] navigation committed, snapshot ready');
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
 *
 * Back navigation doesn't attempt shared-element morphs — we don't know the
 * destination's hero kind, and in most cases (poll → thread, thread → home)
 * the page types differ anyway. The page slides as a single root snapshot.
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
    const previousPath = window.location.pathname;
    const transition = start.call(document, async () => {
      window.history.back();
      const started = Date.now();
      while (window.location.pathname === previousPath && Date.now() - started < 800) {
        await new Promise((r) => setTimeout(r, 10));
      }
      // Small delay for React to commit the new route's DOM.
      await new Promise((r) => setTimeout(r, 120));
    });
    transition.finished.finally(cleanup);
  } catch {
    cleanup();
    window.history.back();
  }
}
