/**
 * Suppress the page-level scrollbars that the swipe-back wrapper would
 * surface — the swipe wrapper's translateX extends content past the
 * viewport edges, which the browser would otherwise reflect as a
 * horizontal scrollbar (and on desktop, a vertical bar too). Apply on
 * swipe lock; clear on snap-back / cancel / destination mount.
 *
 * `overflow-x: clip` on both <html> and <body> suppresses the horizontal
 * scroll without creating a new scroll context (which would otherwise
 * reset body's scroll position on iOS). `scrollbar-width: none` hides the
 * vertical bar. Both elements need to be clipped because html looks at
 * body's content overflow for its own scrollable size.
 */
export function setSwipeScrollbarLock(locked: boolean): void {
  if (typeof document === "undefined") return;
  const htmlS = document.documentElement.style as CSSStyleDeclaration & { scrollbarWidth?: string };
  const bodyS = document.body.style as CSSStyleDeclaration & { scrollbarWidth?: string };
  const value = locked ? "clip" : "";
  const sbValue = locked ? "none" : "";
  htmlS.overflowX = value;
  htmlS.scrollbarWidth = sbValue;
  bodyS.overflowX = value;
  bodyS.scrollbarWidth = sbValue;
}
