"use client";

import { useEffect, useRef } from "react";
import {
  formatCompactCountdown,
  formatCompactCountdownWide,
  formatCountdownTime,
} from "@/lib/timeUtils";

interface SimpleCountdownProps {
  deadline: string;
  label?: string;
  colorClass?: string;
  /** When true, renders a single-unit countdown (e.g. "5m", "3h", "2d")
   *  via `formatCompactCountdown` instead of the multi-unit
   *  `formatCountdownTime` ("1h 30m"). */
  compact?: boolean;
  /** When true (and `compact`), uses the ≥ 2 threshold flavor
   *  (`formatCompactCountdownWide`) so a 90-minute remainder reads "90m"
   *  instead of "1h". Implies `compact`. */
  wide?: boolean;
  /** When true, the countdown text clears to empty on expiry instead of
   *  showing the word "Expired". Used in surfaces where the parent already
   *  unmounts / hides the row once the deadline passes, so the brief
   *  cross-zero tick shouldn't flash a stray "Expired" label. */
  blankOnExpire?: boolean;
  /** Class string applied to the countdown number span. Default is
   *  `'font-mono font-semibold'` — fixed-width digits prevent layout shimmer
   *  as the count ticks. Callers in tight columns can pass a tighter /
   *  bolder stack instead (e.g. `'font-bold tracking-tighter'`). */
  numberClass?: string;
}

/** Ticks countdown text via a ref + textContent to avoid a per-second React
 *  re-render. On Firefox iOS, setState-based countdowns trip a scrollY snap
 *  during momentum scroll-up near the top edge — imperative text updates
 *  leave React's tree untouched. */
export default function SimpleCountdown({
  deadline,
  label,
  colorClass = "text-blue-600 dark:text-blue-400",
  compact = false,
  wide = false,
  blankOnExpire = false,
  numberClass = "font-mono font-semibold",
}: SimpleCountdownProps) {
  const spanRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = spanRef.current;
    if (!el) return;
    const format = wide
      ? formatCompactCountdownWide
      : compact
        ? formatCompactCountdown
        : formatCountdownTime;
    const expired = blankOnExpire ? '' : 'Expired';
    const render = () => {
      const difference = new Date(deadline).getTime() - Date.now();
      if (difference <= 0) { el.textContent = expired; return false; }
      const next = format(difference);
      if (el.textContent !== next) el.textContent = next;
      return true;
    };
    if (!render()) return;
    const interval = setInterval(() => { if (!render()) clearInterval(interval); }, 1000);
    return () => clearInterval(interval);
  }, [deadline, compact, wide, blankOnExpire]);

  // Non-breaking space after the colon — a regular trailing space in a text
  // node adjacent to an inline element gets visually collapsed in iOS Safari
  // / PWA contexts, leaving "Voting:6d" with no gap.
  return <>{label ? `${label}: ` : null}<span ref={spanRef} className={`${numberClass} ${colorClass}`} /></>;
}
