"use client";

import { useEffect, useState } from "react";
import {
  HIDE_HOME_BACKDROP_EVENT,
  SHOW_HOME_BACKDROP_EVENT,
} from "@/lib/eventChannels";

/**
 * Tracks whether the home backdrop is currently active — i.e. whether a
 * group→home swipe-back is in flight. `GroupContent`'s swipe-lock path
 * dispatches `SHOW_HOME_BACKDROP_EVENT` when the gesture starts and
 * `HIDE_HOME_BACKDROP_EVENT` on snap-back/cancel (and home's mount cleanup
 * dispatches HIDE as a final safety).
 *
 * Shared by every component that reacts to that gesture so the
 * addEventListener / removeEventListener boilerplate lives in one place:
 *   - HomeBackdropHost   — mounts/unmounts the static home snapshot
 *   - CreateGroupButtonHost — hides the FAB during the swipe
 *
 * (The create-poll search bar no longer needs this hook: it's rendered
 * inside GroupContent and rides the swipe transform via the gesture's
 * `extraTargets`, so it slides off with the page instead of being hidden.)
 */
export function useHomeBackdropActive(): boolean {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const onShow = () => setActive(true);
    const onHide = () => setActive(false);
    window.addEventListener(SHOW_HOME_BACKDROP_EVENT, onShow);
    window.addEventListener(HIDE_HOME_BACKDROP_EVENT, onHide);
    return () => {
      window.removeEventListener(SHOW_HOME_BACKDROP_EVENT, onShow);
      window.removeEventListener(HIDE_HOME_BACKDROP_EVENT, onHide);
    };
  }, []);
  return active;
}
