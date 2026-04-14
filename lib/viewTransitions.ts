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
 * Wait for the browser URL pathname to match `targetPath`, then for the
 * DOM to settle (two animation frames). Used by the view transition
 * callback so the browser doesn't capture the "after" snapshot before
 * the new page has rendered.
 */
async function waitForNavigation(targetPath: string, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (window.location.pathname !== targetPath && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 10));
  }
  // Let React commit + browser paint
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
}

type ViewTransition = { finished: Promise<void> };
type StartViewTransition = (cb: () => unknown) => ViewTransition;

function getStart(): StartViewTransition | null {
  if (!supportsViewTransitions()) return null;
  return (document as unknown as { startViewTransition: StartViewTransition }).startViewTransition;
}

/**
 * Navigate to `href` with a view transition. Sets the `data-nav-direction`
 * attribute on the root element so CSS animations can pick the right
 * direction. Calls `router.push()` inside the transition callback.
 *
 * If `heroElement` is provided, tags it with `view-transition-name: hero-title`
 * for the duration of the transition (cleaned up automatically on completion).
 */
export function navigateWithTransition(
  router: RouterLike,
  href: string,
  direction: NavDirection = 'forward',
  heroElement?: HTMLElement | null
): void {
  const start = getStart();
  if (!start) {
    console.log('[viewTransitions] API not supported; falling back to router.push');
    router.push(href);
    return;
  }

  console.log(`[viewTransitions] starting ${direction} transition to ${href}, hero=${heroElement ? 'yes' : 'no'}`);
  const root = document.documentElement;
  root.setAttribute('data-nav-direction', direction);
  if (heroElement) heroElement.style.viewTransitionName = 'hero-title';

  const cleanup = () => {
    root.removeAttribute('data-nav-direction');
    if (heroElement) heroElement.style.viewTransitionName = '';
  };

  const targetPath = new URL(href, window.location.origin).pathname;
  try {
    const transition = start.call(document, async () => {
      router.push(href);
      await waitForNavigation(targetPath);
      console.log('[viewTransitions] navigation completed, rendering snapshot');
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
export function navigateBackWithTransition(heroElement?: HTMLElement | null): void {
  const start = getStart();
  if (!start) {
    window.history.back();
    return;
  }

  const root = document.documentElement;
  root.setAttribute('data-nav-direction', 'back');
  if (heroElement) heroElement.style.viewTransitionName = 'hero-title';

  const cleanup = () => {
    root.removeAttribute('data-nav-direction');
    if (heroElement) heroElement.style.viewTransitionName = '';
  };

  try {
    const previousPath = window.location.pathname;
    const transition = start.call(document, async () => {
      window.history.back();
      // Wait for popstate → URL change, then paint frames
      const started = Date.now();
      while (window.location.pathname === previousPath && Date.now() - started < 2000) {
        await new Promise((r) => setTimeout(r, 10));
      }
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
    });
    transition.finished.finally(cleanup);
  } catch {
    cleanup();
    window.history.back();
  }
}
