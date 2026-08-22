"use client";

/**
 * One availability WINDOW of a Playlist slot, rendered as a borderless
 * edge-to-edge card (a shade off the page background, very rounded corners,
 * minimal vertical padding). A slot with several windows explodes into several
 * of these cards (each its own row); see slotWindowEntries.
 *   - LEFT column, top-aligned: this window's start–end time as a tappable
 *     chip (with an end date only when the window crosses midnight, and a
 *     decimal-hour duration note — "2.25h" — trailing inside it), and the
 *     events (placeholder for now) indented beneath it. The day +
 *     relative specifier ("Tomorrow") is NOT here — it's a per-day divider
 *     header rendered above each group of same-day rows in PlaylistTab.
 *   - RIGHT (remaining space): a CLUSTER of tinted circles, one per activity,
 *     each showing just that activity's symbol (its emoji, or the first letter
 *     of its name) centered inside. The circle carries the activity's hue at
 *     low opacity behind a hairline border of the same hue, consistent for that
 *     activity across the whole timeline.
 *     The circles are hex-packed into balanced, half-pitch-offset rows (see
 *     clusterLayout) with the "+" as the last circle of the pattern, and the
 *     whole cluster is centered both ways in the row. Details (participant
 *     ranges, who-with) live in the per-activity sheet, not on the circle.
 *
 * Tap targets (each opens the slot sheet on ONE facet):
 *   - the time text → edit just the date/time ('time' mode);
 *   - an activity circle → edit just THAT activity ('activity' mode, its index);
 *   - the "+" circle → add a new activity ('activity' mode, no index).
 */

import { memo, useMemo } from "react";
import InitialBubble from "@/components/InitialBubble";
import type { Slot, SlotEvent } from "@/lib/api/slots";
import {
  activityColor,
  clusterLayout,
  edgeToEdgeStyle,
  CLUSTER_CIRCLE_PX,
  type ActivityColor,
  type SlotWindowLine,
} from "@/lib/slotUtils";
import { openSlotSheet, anchorRowForAddPanel, PLAYLIST_HEADER_H_VAR } from "@/lib/slotEvents";
import { primeKeyboardNow } from "@/lib/useKeyboardPrimer";

interface SlotCardProps {
  slot: Slot;
  /** The single availability window this row represents. */
  line: SlotWindowLine;
  colors: Map<string, ActivityColor>;
  /** The system-proposed events anchored to THIS window (see PlaylistTab's
   *  eventsByEntryKey). Reference-stable when unchanged, for the memo. */
  events: SlotEvent[];
  onToggleConfirm: (ev: SlotEvent) => void;
}

/** "HH:MM" → a compact 12h clock ("2 PM", "2:30 PM"). */
function fmtClock(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12} ${period}` : `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

// Confirmed-people discs shown on an event card before collapsing to "+X".
const MAX_EVENT_ICONS = 4;

/** One proposed event: a tiny two-line card with the action button as a
 *  full-height column spanning both lines.
 *    line 1 — {emoji} {activity} @ {time}, where time is the earliest start
 *             that lets every member's minimum be met (server-computed; the
 *             confirmed set's own start once the event is on);
 *    line 2 — one initials disc per confirmed person, "+X" past the cap
 *             (muted "No one yet" before anyone confirms).
 *  Button states: blue "Confirm" → neutral "Cancel" (you're in — your disc is
 *  on line 2) → dead "Full" (joining would break a confirmed member's
 *  who-with condition; it frees on its own if someone cancels — the tab
 *  polls). A met event bolds the card and tints it green. */
function EventCard({ ev, onToggleConfirm }: { ev: SlotEvent; onToggleConfirm: (ev: SlotEvent) => void }) {
  const full = !ev.viewer_confirmed && !ev.can_confirm;
  const shown = ev.confirmed_names.slice(0, MAX_EVENT_ICONS);
  const extra = ev.confirmed_count - shown.length;
  return (
    <div
      title={ev.confirmed_names.length > 0 ? `Going: ${ev.confirmed_names.join(", ")}` : undefined}
      className={`flex items-stretch overflow-hidden rounded-xl border text-[12.5px] leading-tight transition-colors ${
        ev.met
          ? "border-green-500 dark:border-green-500 bg-green-50 dark:bg-green-900/30 text-green-800 dark:text-green-200 font-semibold"
          : "border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
      }`}
    >
      <div className="min-w-0 flex flex-col justify-center gap-1 py-1.5 pl-2 pr-2">
        <span className="truncate">
          {ev.emoji ? `${ev.emoji} ` : ""}
          {ev.activity}
          {ev.time && (
            <span className={ev.met ? "text-green-600 dark:text-green-300" : "text-gray-400 dark:text-gray-500"}>
              {" "}@ {fmtClock(ev.time)}
            </span>
          )}
        </span>
        <div className="flex items-center gap-1 min-h-[18px]">
          {shown.length === 0 ? (
            <span className="text-[11px] text-gray-400 dark:text-gray-500 font-normal">No one yet</span>
          ) : (
            shown.map((n, i) => (
              <InitialBubble
                key={`${n}#${i}`}
                name={n}
                sizeClassName="w-[18px] h-[18px]"
                textSizeClassName="text-[8px]"
              />
            ))
          )}
          {extra > 0 && (
            <span className={`text-[11px] tabular-nums ${ev.met ? "text-green-600 dark:text-green-300" : "text-gray-400 dark:text-gray-500"}`}>
              +{extra}
            </span>
          )}
        </div>
      </div>
      {/* The action column spans BOTH rows — self-stretch against the card's
          items-stretch, separated by a hairline in the card's border color. */}
      <button
        type="button"
        disabled={full}
        onClick={() => onToggleConfirm(ev)}
        aria-label={
          ev.viewer_confirmed ? `Cancel ${ev.activity}` : full ? `${ev.activity} is full` : `Confirm ${ev.activity}`
        }
        className={`self-stretch shrink-0 flex items-center px-2.5 text-[11.5px] font-medium border-l transition ${
          ev.met ? "border-green-500 dark:border-green-500" : "border-gray-300 dark:border-gray-700"
        } ${
          ev.viewer_confirmed
            ? "bg-gray-50 dark:bg-gray-800/60 text-gray-500 dark:text-gray-400 active:bg-gray-100 dark:active:bg-gray-700"
            : full
              ? "bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-default"
              : "bg-blue-600 text-white active:bg-blue-700"
        }`}
      >
        {ev.viewer_confirmed ? "Cancel" : full ? "Full" : "Confirm"}
      </button>
    </div>
  );
}

/** The glyph shown inside an activity's circle: its emoji, else the first
 *  letter of its name (uppercased). */
function activitySymbol(name: string, emoji: string | null): string {
  return emoji || name.trim().charAt(0).toUpperCase() || "?";
}

function SlotCardImpl({ slot, line, colors, events, onToggleConfirm }: SlotCardProps) {
  // Resolve each activity's color once (stable per activity name across the
  // whole timeline — see buildActivityColorMap).
  const activities = slot.activities.map((a) => ({
    ...a,
    color: activityColor(a.name, colors),
  }));

  // One slot per activity plus a trailing one for the "+", so the add button
  // is the last circle of the pattern rather than an outlier beside it.
  const layout = useMemo(() => clusterLayout(activities.length + 1), [activities.length]);
  const plusPosition = layout.positions[activities.length];

  return (
    // The row sits in a borderless card a shade off the page background, with
    // very rounded corners, running edge-to-edge: the negative margins cancel
    // the page's safe-area padding so the card touches both screen edges, and
    // the padding puts the content back inside — a touch further right than
    // the day divider's text above it, so the content reads as sitting inside
    // the card rather than hugging its rounded left edge.
    <div
      data-slot-card=""
      // No `w-full`: width must stay auto so the negative margins actually
      // stretch the card past both page edges (`width: 100%` would pin it to
      // the padded container and only the left margin would take effect).
      className="rounded-3xl bg-gray-100 dark:bg-gray-900 pt-2 pb-1"
      style={edgeToEdgeStyle("0.25rem", "0.75rem")}
    >
      {/* One row: the time span + events placeholder in the LEFT column (sized
          to the one-line time text), the activity cluster filling the
          remaining RIGHT space with the "+" pinned to its right edge. The row
          stretches so the right side can center its cluster against the full
          height of the left column. */}
      <div className="flex items-stretch">
        {/* The time is this row's header, so it sticks under the day divider
            (the column headers' height — a CSS var, zeroed while the add
            panel hides them — plus the divider's 29.2px and the card's own
            8px top padding, which is exactly where the time sits below the
            divider at rest, so nothing shifts when it locks)
            while this row's activities scroll past it, and rides out as the
            row ends and the next row's time takes its place.
            self-start is load-bearing: a stretched box has no room to slide
            inside itself, so sticky would be a no-op without it.
            Sticking is scoped to this row, so nothing ever passes underneath —
            hence no background or fade of its own. z sits between the circles
            (z-10) and the day divider (z-20): a time being pushed out by the
            end of its row rides up UNDER the divider rather than over its
            date. */}
        <div
          data-slot-time=""
          className="sticky z-[15] shrink-0 self-start"
          style={{ top: `calc(var(${PLAYLIST_HEADER_H_VAR}) + 37.2px)` }}
        >
          {/* This window's time span on ONE line (nowrap — the column sizes to
              it, so the duration never wraps), left-justified against the
              card's inner left edge (a touch right of the day divider's text).
              Font is bumped ~20% over the timeline's baseline. Tapping it
              edits the slot's date/time.
              It's a CHIP, not underlined text: the card's tappable things are
              already chips (the activity circles, the header pill), so a soft
              gray pill on the card's background says "control" where a hairline
              underline just read as metadata. Gray rather than the header's
              blue — one of these per row would flood the timeline with blue,
              and blue is reserved for the single add-a-slot action.
              The whole chip is the button, so the visual target matches the
              tap target; the duration rides inside it as a muted note. */}
          <button
            type="button"
            onClick={() => openSlotSheet(slot, "time")}
            aria-label="Edit slot time"
            className="inline-flex items-center rounded-full border-[0.5px] border-gray-300 dark:border-gray-700 bg-gray-200 dark:bg-gray-800 px-2.5 py-0.5 text-[14.4px] text-gray-700 dark:text-gray-300 whitespace-nowrap active:scale-95 transition-transform"
          >
            {line.startTime} – {line.endDate ? `${line.endDate} · ` : ""}
            {line.endTime}
            <span className="ml-1 text-gray-400 dark:text-gray-500">· {line.duration}</span>
          </button>
          {/* Events hang under their time, flush with its left edge (no
              nesting indent — they're this window's main content, not a
              sub-item of the chip). Each is a tiny two-line card — title
              @ time over the confirmed people's discs — with the
              Confirm/Cancel/Full button spanning both lines. A MET event
              (everyone confirmed's condition holds) goes bold + green. */}
          <div className="mt-2 flex flex-col items-start gap-1.5">
            {events.length === 0 ? (
              <span className="text-sm text-gray-400 dark:text-gray-500">No events yet…</span>
            ) : (
              events.map((ev) => <EventCard key={`${ev.day}#${ev.activity.toLowerCase()}`} ev={ev} onToggleConfirm={onToggleConfirm} />)
            )}
          </div>
        </div>
        {/* pl-3 is the gutter between the two columns — the circles pack out
            to the cluster's edge, so the time text needs the room. */}
        <div className="flex-1 min-w-0 flex items-center justify-center pl-3 py-1">
          {/* Every circle is absolutely placed from the hex layout, so the box
              only has to reserve the cluster's measured size. */}
          <div
            className="relative shrink-0"
            style={{ width: layout.width, height: layout.height }}
          >
            {activities.map((a, i) => (
              <button
                key={`${a.name}#${i}`}
                type="button"
                onClick={() => openSlotSheet(slot, "activity", i)}
                title={a.name}
                aria-label={`Edit ${a.name}`}
                style={{
                  left: layout.positions[i].x,
                  top: layout.positions[i].y,
                  width: CLUSTER_CIRCLE_PX,
                  height: CLUSTER_CIRCLE_PX,
                }}
                className={`absolute rounded-full border-[0.5px] flex items-center justify-center text-[21px] leading-none active:scale-95 transition ${a.color.faded} ${a.color.border} ${a.color.text}`}
              >
                <span aria-hidden="true">{activitySymbol(a.name, a.emoji)}</span>
              </button>
            ))}
            {/* Last circle of the pattern — the only way to add an activity. */}
            <button
              type="button"
              onClick={(e) => {
                // Put the "+" at the top of the screen first, then hang the
                // add panel off its settled position.
                // Claim the keyboard for the field that mounts a commit later,
                // then pin the panel under this "+" and scroll it to the top.
                primeKeyboardNow();
                const anchorBottom = anchorRowForAddPanel(e.currentTarget);
                openSlotSheet(slot, "activity", null, anchorBottom);
              }}
              aria-label="Add an activity"
              style={{
                left: plusPosition.x,
                top: plusPosition.y,
                width: CLUSTER_CIRCLE_PX,
                height: CLUSTER_CIRCLE_PX,
              }}
              className="absolute rounded-full border border-dashed border-gray-300 dark:border-gray-600 text-gray-400 dark:text-gray-500 flex items-center justify-center hover:border-gray-400 dark:hover:border-gray-500 active:scale-95 transition"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(SlotCardImpl);
