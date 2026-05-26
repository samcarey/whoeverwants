"use client";

/**
 * Module-level "a back-nav scroll restore is in progress" flag.
 *
 * The group page's restore pin re-applies the saved `window.scrollY` after a
 * back navigation (see `GroupContent` in `app/g/[groupShortId]/GroupPage.tsx`).
 * That re-application is a PROGRAMMATIC scroll — often a large jump (e.g. 0 →
 * the saved mid-list offset after Next.js' post-commit scroll-to-0). Scroll-
 * driven chrome that infers user intent from scroll events (the
 * `BubbleBarPanel`'s hide-on-scroll-down, the scroll-helper arrows'
 * mid-scroll suppression) would otherwise misread the restore jump as the
 * user scrolling and hide/flicker.
 *
 * The restore pin sets this true while it's actively re-applying and false
 * once it converges / the user takes over; consumers check it to skip their
 * "the user scrolled" reactions. A plain module boolean (not React state) so
 * synchronous scroll handlers can read it with zero overhead.
 */
let restoring = false;

export function setScrollRestoring(value: boolean): void {
  restoring = value;
}

export function isScrollRestoring(): boolean {
  return restoring;
}
