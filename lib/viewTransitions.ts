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

/** Named hero views — using distinct names prevents awkward content morphs
 *  between conceptually different titles (e.g., poll title → thread title). */
export type HeroKind = 'thread' | 'poll';

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
 * attribute on the root element so CSS animations can pick the right
 * direction. Calls `router.push()` inside the transition callback.
 *
 * If `heroElement` and `heroKind` are provided, tags the element with
 * `view-transition-name: hero-<kind>` for the duration of the transition.
 * Pages that serve as destinations should statically tag their title element
 * with the matching name so the browser morphs the source into the
 * destination position.
 *
 * Using distinct names per page type ensures we don't morph, e.g., a poll
 * title into a thread header — those pages fall back to a clean slide with
 * no shared-element morph.
 */
export function navigateWithTransition(
  router: RouterLike,
  href: string,
  direction: NavDirection = 'forward',
  heroElement?: HTMLElement | null,
  heroKind?: HeroKind
): void {
  const start = getStart();
  if (!start) {
    console.log('[viewTransitions] API not supported; falling back to router.push');
    router.push(href);
    return;
  }

  const heroName = heroKind ? `hero-${heroKind}` : null;
  console.log(`[viewTransitions] starting ${direction} to ${href}, hero=${heroName ?? 'none'}`);
  const root = document.documentElement;
  root.setAttribute('data-nav-direction', direction);

  // Only dynamically tag the heroElement if no other element already owns
  // this name on the page. Two elements with the same view-transition-name
  // throws InvalidStateError.
  const alreadyHas = heroName
    ? !!document.querySelector(`[style*="${heroName}"]`)
    : false;
  const tagHero = heroElement && heroName && !alreadyHas;
  if (tagHero) heroElement!.style.viewTransitionName = heroName!;

  const cleanup = () => {
    root.removeAttribute('data-nav-direction');
    if (tagHero) heroElement!.style.viewTransitionName = '';
  };

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
 */
export function navigateBackWithTransition(
  heroElement?: HTMLElement | null,
  heroKind?: HeroKind
): void {
  const start = getStart();
  if (!start) {
    window.history.back();
    return;
  }

  const root = document.documentElement;
  root.setAttribute('data-nav-direction', 'back');

  const heroName = heroKind ? `hero-${heroKind}` : null;
  const alreadyHas = heroName
    ? !!document.querySelector(`[style*="${heroName}"]`)
    : false;
  const tagHero = heroElement && heroName && !alreadyHas;
  if (tagHero) heroElement!.style.viewTransitionName = heroName!;

  const cleanup = () => {
    root.removeAttribute('data-nav-direction');
    if (tagHero) heroElement!.style.viewTransitionName = '';
  };

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
