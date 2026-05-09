"use client";

import { useEffect, useRef } from "react";
import { formatCountdownTime } from "@/lib/timeUtils";

interface SimpleCountdownProps {
  deadline: string;
  label?: string;
  colorClass?: string;
}

/** Ticks countdown text via a ref + textContent to avoid a per-second React
 *  re-render. On Firefox iOS, setState-based countdowns trip a scrollY snap
 *  during momentum scroll-up near the top edge — imperative text updates
 *  leave React's tree untouched. */
export default function SimpleCountdown({
  deadline,
  label,
  colorClass = "text-blue-600 dark:text-blue-400",
}: SimpleCountdownProps) {
  const spanRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = spanRef.current;
    if (!el) return;
    const render = () => {
      const difference = new Date(deadline).getTime() - Date.now();
      if (difference <= 0) { el.textContent = 'Expired'; return false; }
      const next = formatCountdownTime(difference);
      if (el.textContent !== next) el.textContent = next;
      return true;
    };
    if (!render()) return;
    const interval = setInterval(() => { if (!render()) clearInterval(interval); }, 1000);
    return () => clearInterval(interval);
  }, [deadline]);

  return <>{label ? `${label}: ` : null}<span ref={spanRef} className={`font-mono font-semibold ${colorClass}`} /></>;
}
