import { useEffect } from 'react';

/**
 * Locks background scroll while `locked` is true using the iOS-safe
 * `position: fixed; top: -scrollY` technique, restoring the prior scroll
 * position on unlock. Plain `overflow: hidden` does NOT block iOS native
 * pull-to-refresh, which is why every modal in the app reaches for this
 * pattern (see the "Document Scroll Architecture" notes in CLAUDE.md).
 *
 * Previous inline-style values are saved and restored (rather than reset to
 * `''`) so nested locks compose without clobbering an outer lock's state.
 *
 * @param locked  whether the lock is active
 * @param options.overscroll  also pin `overscroll-behavior: none` on
 *   `<body>` + `<html>` as an extra pull-to-refresh guard (default `true`)
 */
export function useBodyScrollLock(
  locked: boolean,
  options?: { overscroll?: boolean }
): void {
  const overscroll = options?.overscroll ?? true;
  useEffect(() => {
    if (!locked) return;

    const body = document.body;
    const html = document.documentElement;
    const scrollY = window.scrollY;
    const prev = {
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      bodyOverscroll: body.style.overscrollBehavior,
      htmlOverscroll: html.style.overscrollBehavior,
    };

    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.width = '100%';
    if (overscroll) {
      body.style.overscrollBehavior = 'none';
      html.style.overscrollBehavior = 'none';
    }

    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.width = prev.width;
      body.style.overscrollBehavior = prev.bodyOverscroll;
      html.style.overscrollBehavior = prev.htmlOverscroll;
      window.scrollTo(0, scrollY);
    };
  }, [locked, overscroll]);
}
