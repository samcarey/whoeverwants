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
  if (!supportsViewTransitions()) {
    router.push(href);
    return;
  }

  const root = document.documentElement;
  root.setAttribute('data-nav-direction', direction);

  if (heroElement) {
    heroElement.style.viewTransitionName = 'hero-title';
  }

  const cleanup = () => {
    root.removeAttribute('data-nav-direction');
    if (heroElement) {
      heroElement.style.viewTransitionName = '';
    }
  };

  try {
    const transition = (document as unknown as { startViewTransition: (cb: () => void) => { finished: Promise<void> } })
      .startViewTransition(() => {
        router.push(href);
      });
    transition.finished.finally(cleanup);
  } catch {
    cleanup();
    router.push(href);
  }
}

/**
 * Navigate backward (history.back()) with a reverse-direction transition.
 */
export function navigateBackWithTransition(heroElement?: HTMLElement | null): void {
  if (!supportsViewTransitions()) {
    window.history.back();
    return;
  }

  const root = document.documentElement;
  root.setAttribute('data-nav-direction', 'back');

  if (heroElement) {
    heroElement.style.viewTransitionName = 'hero-title';
  }

  const cleanup = () => {
    root.removeAttribute('data-nav-direction');
    if (heroElement) {
      heroElement.style.viewTransitionName = '';
    }
  };

  try {
    const transition = (document as unknown as { startViewTransition: (cb: () => void) => { finished: Promise<void> } })
      .startViewTransition(() => {
        window.history.back();
      });
    transition.finished.finally(cleanup);
  } catch {
    cleanup();
    window.history.back();
  }
}
