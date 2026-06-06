"use client";

import { useMemo } from "react";
import { formatDayLabel, groupSlotsByDay } from "@/lib/timeUtils";

/**
 * Per-day flex-wrap of concrete movie showtimes. Deliberately NOT routed
 * through TimeSlotBubbles' 15-minute grid (`expandHourRowsToQuarters` snaps
 * to :00/:15/:30/:45; real showtimes are arbitrary-minute). Each bubble shows
 * the time + a format/cinema tag + seats.
 *
 * Two modes share the same layout:
 *  - `curate` (creator): 2-state include/exclude. Selected = green (viable),
 *    unselected = neutral (excluded). Tap toggles.
 *  - `vote` (ballot): 3-state want / neutral / can't-attend. Tap cycles
 *    neutral → want(green) → can't(red) → neutral, mirroring the time
 *    preference ballot where red = "can't attend".
 *
 * `disabled` renders read-only (results / submitted-summary).
 */

export interface ShowtimeSlot {
  key: string; // "YYYY-MM-DD HH:MM-HH:MM"
  time: string; // "19:10"
  cinema_name?: string | null;
  format?: string | null;
  seats_left?: number | null;
}

interface CurateProps {
  mode: "curate";
  slots: ShowtimeSlot[];
  selectedKeys: string[];
  onToggle: (key: string, selected: boolean) => void;
  disabled?: boolean;
}

interface VoteProps {
  mode: "vote";
  slots: ShowtimeSlot[];
  likedKeys: string[];
  dislikedKeys: string[];
  onToggle: (key: string, next: "want" | "neutral" | "cant") => void;
  disabled?: boolean;
}

type Props = CurateProps | VoteProps;

function fmt12(time: string): string {
  const [hStr, m] = time.split(":");
  let h = parseInt(hStr, 10);
  const period = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m} ${period}`;
}

export default function ShowtimeBubbles(props: Props) {
  const { slots, disabled } = props;
  const byKey = useMemo(() => {
    const m = new Map<string, ShowtimeSlot>();
    for (const s of slots) m.set(s.key, s);
    return m;
  }, [slots]);

  const days = useMemo(
    () => groupSlotsByDay(slots.map((s) => s.key)),
    [slots],
  );

  const likedSet = props.mode === "vote" ? new Set(props.likedKeys) : null;
  const dislikedSet = props.mode === "vote" ? new Set(props.dislikedKeys) : null;
  const selectedSet = props.mode === "curate" ? new Set(props.selectedKeys) : null;

  function bubbleState(key: string): "on" | "neutral" | "off" {
    if (props.mode === "curate") return selectedSet!.has(key) ? "on" : "neutral";
    if (likedSet!.has(key)) return "on";
    if (dislikedSet!.has(key)) return "off";
    return "neutral";
  }

  function handleTap(key: string) {
    if (disabled) return;
    if (props.mode === "curate") {
      props.onToggle(key, !selectedSet!.has(key));
      return;
    }
    const state = bubbleState(key);
    const next = state === "neutral" ? "want" : state === "on" ? "cant" : "neutral";
    props.onToggle(key, next);
  }

  const classFor = (state: "on" | "neutral" | "off") => {
    if (state === "on")
      return "bg-green-100 dark:bg-green-900/40 border-green-500 text-green-800 dark:text-green-200";
    if (state === "off")
      return "bg-red-100 dark:bg-red-900/40 border-red-500 text-red-800 dark:text-red-200";
    return "bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200";
  };

  return (
    <div className="space-y-3">
      {days.map(([date, keys]) => (
        <div key={date} className="flex gap-3">
          <div className="w-14 shrink-0 pt-1 text-xs font-semibold text-gray-500 dark:text-gray-400 leading-tight">
            {formatDayLabel(date)}
          </div>
          <div className="flex flex-1 flex-wrap gap-2">
            {keys.map((key, idx) => {
              const slot = byKey.get(key);
              if (!slot) return null;
              const state = bubbleState(key);
              return (
                <button
                  // Defense-in-depth: the server guarantees unique keys per
                  // film, but include the index so a stray duplicate (stale
                  // cached catalog, future data source) can't hard-crash React.
                  key={`${key}#${idx}`}
                  type="button"
                  disabled={disabled}
                  onClick={() => handleTap(key)}
                  className={`flex flex-col items-center rounded-xl border px-2.5 py-1.5 text-center transition-colors ${classFor(state)} ${disabled ? "cursor-default" : "active:scale-95"}`}
                >
                  <span className="font-mono text-sm font-bold leading-none">{fmt12(slot.time)}</span>
                  {(slot.format || slot.cinema_name) && (
                    <span className="mt-0.5 text-[10px] leading-tight opacity-80">
                      {[slot.format, slot.cinema_name?.replace(/^Alamo /, "")]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  )}
                  {typeof slot.seats_left === "number" && slot.seats_left >= 0 && (
                    <span className="text-[10px] leading-tight opacity-70">{slot.seats_left} seats</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {props.mode === "vote" && (
        <div className="flex items-center justify-center gap-4 pt-1 text-[11px] text-gray-500 dark:text-gray-400">
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded border border-green-500 bg-green-100 dark:bg-green-900/40" /> Want
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded border border-red-500 bg-red-100 dark:bg-red-900/40" /> Can&apos;t attend
          </span>
        </div>
      )}
    </div>
  );
}
