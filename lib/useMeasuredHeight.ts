"use client";

import { type DependencyList, type RefObject, useLayoutEffect, useRef, useState } from "react";

// Tracks an element's offsetHeight via ResizeObserver. Returns
// [ref, height] — pass `ref` to the element you want to measure.
//
// `deps` controls when the observer is (re-)attached: pass `[loaded]`
// when the measured element is conditionally rendered after a state
// change (e.g. a loading → loaded transition that swaps a spinner for
// the real content) so the observer reattaches once the element exists.
// Default `[]` is correct when the element mounts once with the component.
//
// `initialValue` seeds the height state for the first render. Default 0.
// Pass an estimate of the eventual height to avoid a "first render at 0
// → second render at measured value" jump that's visible on iOS browsers
// (useLayoutEffect's setState doesn't always batch with the initial
// commit before the browser paints — we see it as a one-frame flicker
// where dependent layout shifts as the measurement lands). The estimate
// only has to be in the right ballpark; ResizeObserver corrects any
// drift on the next tick.
export function useMeasuredHeight<T extends HTMLElement = HTMLElement>(
  deps: DependencyList = [],
  initialValue = 0,
): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [height, setHeight] = useState(initialValue);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setHeight(el.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return [ref, height];
}
