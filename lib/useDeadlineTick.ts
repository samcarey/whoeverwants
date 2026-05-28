"use client";

import { useEffect, useState } from "react";

// Cap the setTimeout delay below the 2^31-1 ms (~24.85 days) signed-int limit
// — browsers truncate larger values to 1ms and fire immediately. 1 day gives
// reasonable re-evaluation cadence for very-far-future deadlines without
// adding noticeable re-render pressure.
const MAX_SCHEDULE_MS = 86_400_000;

/**
 * Forces a re-render the moment the soonest unexpired deadline in `deadlines`
 * crosses. Use to flip parent-computed "isClosed" / "expired" state without
 * waiting for an unrelated re-render (e.g. the 5s group-page refresh tick).
 *
 * Without this, a `SimpleCountdown` ticking imperatively in the DOM would
 * show "Voting: Expired" while the surrounding parent still believes the
 * poll is open, until the next state change. The hook schedules a single
 * `setTimeout` for the soonest deadline; on fire it bumps state which
 * re-runs the effect against the now-shorter list (and a fresh `Date.now()`)
 * and schedules the next.
 */
export function useDeadlineTick(deadlines: (string | null | undefined)[]): void {
  const [tick, setTick] = useState(0);
  // Serialize the input so the effect's dep is stable across renders that
  // produce a fresh array with the same contents.
  const key = deadlines.filter((d): d is string => !!d).sort().join("|");
  useEffect(() => {
    const nowMs = Date.now();
    let soonest: number | null = null;
    for (const d of deadlines) {
      if (!d) continue;
      const t = Date.parse(d);
      if (Number.isFinite(t) && t > nowMs && (soonest === null || t < soonest)) {
        soonest = t;
      }
    }
    if (soonest === null) return;
    // +50ms cushion so the timer fires AFTER the deadline has crossed (the
    // re-render's `new Date()` reads strictly past it). Cap at MAX_SCHEDULE_MS
    // to dodge the 32-bit timer overflow; on fire `tick` deps re-run the
    // effect with a fresh `Date.now()` so the next soonest gets scheduled
    // (covers BOTH the "deadline is days away" case AND the "second-soonest
    // sibling is still in the list because the server hasn't flipped
    // is_closed yet" case).
    const delay = Math.min(MAX_SCHEDULE_MS, soonest - nowMs + 50);
    const id = setTimeout(() => setTick((n) => n + 1), delay);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);
}
