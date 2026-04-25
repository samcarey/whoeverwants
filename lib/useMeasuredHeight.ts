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
export function useMeasuredHeight<T extends HTMLElement = HTMLElement>(
  deps: DependencyList = [],
): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [height, setHeight] = useState(0);
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
