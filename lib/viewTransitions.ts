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
 * Wait for the browser URL pathname to match `targetPath`. Used by the view
 * transition callback so the browser doesn't capture the "after" snapshot
 * before the new page has rendered.
 *
 * Normalizes trailing slashes — the app uses `trailingSlash: true` so
 * `/thread/xyz` may become `/thread/xyz/` after navigation.
 *
 * Do NOT use requestAnimationFrame inside the view transition callback:
 * the browser pauses rendering during the callback, so rAF never fires
 * and the callback would hit the browser's 4s timeout.
 */
async function waitForNavigation(targetPath: string, timeoutMs = 800): Promise<void> {
  const normalize = (p: string) => p.replace(/\/$/, '') || '/';
  const target = normalize(targetPath);
  const start = Date.now();
  while (normalize(window.location.pathname) !== target && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 10));
  }
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

  // Only dynamically tag the heroElement if no other element already owns
  // hero-title (e.g., a page header with a static style). Two elements with
  // the same view-transition-name throws InvalidStateError.
  const alreadyHasHero = !!document.querySelector('[style*="hero-title"]');
  const tagHero = heroElement && !alreadyHasHero;
  if (tagHero) heroElement!.style.viewTransitionName = 'hero-title';

  const cleanup = () => {
    root.removeAttribute('data-nav-direction');
    if (tagHero) heroElement!.style.viewTransitionName = '';
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

  const alreadyHasHero = !!document.querySelector('[style*="hero-title"]');
  const tagHero = heroElement && !alreadyHasHero;
  if (tagHero) heroElement!.style.viewTransitionName = 'hero-title';

  const cleanup = () => {
    root.removeAttribute('data-nav-direction');
    if (tagHero) heroElement!.style.viewTransitionName = '';
  };

  try {
    const previousPath = window.location.pathname;
    const transition = start.call(document, async () => {
      window.history.back();
      // Wait for popstate → URL change. No rAF here — the browser pauses
      // rendering during the view transition callback.
      const started = Date.now();
      while (window.location.pathname === previousPath && Date.now() - started < 800) {
        await new Promise((r) => setTimeout(r, 10));
      }
    });
    transition.finished.finally(cleanup);
  } catch {
    cleanup();
    window.history.back();
  }
}
