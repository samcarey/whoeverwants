"use client";

import { useEffect, useState } from "react";

/**
 * Forces a re-render the moment the soonest unexpired deadline in `deadlines`
 * crosses. Use to flip parent-computed "isClosed" / "expired" state without
 * waiting for an unrelated re-render (e.g. the 5s group-page refresh tick).
 *
 * Without this, a `SimpleCountdown` ticking imperatively in the DOM would
 * show "Voting: Expired" while the surrounding parent still believes the
 * poll is open, until the next state change. The hook schedules a single
 * `setTimeout` for the soonest deadline; on fire it bumps state which
 * re-runs the effect against the now-shorter list and schedules the next.
 */
export function useDeadlineTick(deadlines: (string | null | undefined)[]): void {
  const [, setTick] = useState(0);
  // Serialize the input so the effect's dep is stable across renders that
  // produce a fresh array with the same contents.
  const key = deadlines.filter((d): d is string => !!d).sort().join("|");
  useEffect(() => {
    const nowMs = Date.now();
    let soonest: number | null = null;
    for (const d of deadlines) {
      if (!d) continue;
      const t = new Date(d).getTime();
      if (Number.isFinite(t) && t > nowMs && (soonest === null || t < soonest)) {
        soonest = t;
      }
    }
    if (soonest === null) return;
    // +50ms cushion so the timer fires AFTER the deadline has crossed (the
    // re-render's `new Date()` reads strictly past it).
    const id = setTimeout(() => setTick((n) => n + 1), soonest - nowMs + 50);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
