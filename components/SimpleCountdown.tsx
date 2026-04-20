"use client";

import { useEffect, useRef } from "react";

interface SimpleCountdownProps {
  deadline: string;
  label?: string;
  colorClass?: string;
  /** When the deadline is days away, hide the seconds component.
   *  List views use this to keep countdown widths stable and compact. */
  hideSecondsInDays?: boolean;
}

/** Ticks countdown text via a ref + textContent to avoid a per-second React
 *  re-render. On Firefox iOS, setState-based countdowns trip a scrollY snap
 *  during momentum scroll-up near the top edge — imperative text updates
 *  leave React's tree untouched. */
export default function SimpleCountdown({
  deadline,
  label,
  colorClass = "text-blue-600 dark:text-blue-400",
  hideSecondsInDays = false,
}: SimpleCountdownProps) {
  const spanRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = spanRef.current;
    if (!el) return;
    const render = () => {
      const difference = new Date(deadline).getTime() - Date.now();
      if (difference <= 0) { el.textContent = 'Expired'; return false; }
      const days = Math.floor(difference / (1000 * 60 * 60 * 24));
      const hours = Math.floor((difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((difference % (1000 * 60)) / 1000);
      let next: string;
      if (days > 0) next = hideSecondsInDays ? `${days}d ${hours}h ${minutes}m` : `${days}d ${hours}h ${minutes}m ${seconds}s`;
      else if (hours > 0) next = `${hours}h ${minutes}m ${seconds}s`;
      else if (minutes > 0) next = `${minutes}m ${seconds}s`;
      else next = `${seconds}s`;
      if (el.textContent !== next) el.textContent = next;
      return true;
    };
    if (!render()) return;
    const interval = setInterval(() => { if (!render()) clearInterval(interval); }, 1000);
    return () => clearInterval(interval);
  }, [deadline, hideSecondsInDays]);

  return <>{label ? `${label}: ` : null}<span ref={spanRef} className={`font-mono font-semibold ${colorClass}`} /></>;
}
