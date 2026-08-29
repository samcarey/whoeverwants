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

import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import InitialBubble from "@/components/InitialBubble";
import type { ActivitySuggestion, Slot, SlotEvent } from "@/lib/api/slots";
import {
  activityColor,
  clusterLayout,
  edgeToEdgeStyle,
  CLUSTER_CIRCLE_PX,
  TIME_COLUMN_BASIS,
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
  onConfirm: (ev: SlotEvent) => void;
  /** Open the event's own page. */
  onOpenEvent: (ev: SlotEvent) => void;
  /** Activities OTHERS are planning during this slot's period that aren't on
   *  the slot yet (already blacklist-filtered). Non-empty → the "Suggested"
   *  preview card at the bottom of the slot. Reference-stable when unchanged,
   *  for the memo. */
  suggested: ActivitySuggestion[];
  /** Open the suggested-activities modal (add / silence live there). */
  onOpenSuggested: (slot: Slot) => void;
}

/** "HH:MM" → a compact 12h clock ("2 PM", "2:30 PM"). */
function fmtClock(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12} ${period}` : `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

// Geometry of the confirmed-people discs, used to work out how many fit on a
// card's second line before they'd run into the status pill (see useDiscFit).
const DISC_PX = 18;
const DISC_GAP_PX = 4; // gap-1
const DISC_PITCH_PX = DISC_PX + DISC_GAP_PX;
// Room the "+X" overflow label needs (2 digits at text-[11px] plus its gap).
const OVERFLOW_LABEL_PX = 26;

/**
 * How many discs fit in the space left over beside the status pill, and the
 * ref to hang on the strip that holds them.
 *
 * The measured element is the flex-1 strip, whose width comes from the row
 * minus the (shrink-0) pill — NOT from the discs themselves. That's the
 * load-bearing part: measuring an element whose own children's visibility you
 * then mutate is the feedback loop documented on VoterList's single-line mode.
 */
function useDiscFit(total: number) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [fit, setFit] = useState(total);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      if (w <= 0) return;
      const all = Math.floor((w + DISC_GAP_PX) / DISC_PITCH_PX);
      // Everything fits, or one slot goes to the "+X" that stands for the rest.
      const next =
        all >= total
          ? total
          : Math.max(0, Math.floor((w - OVERFLOW_LABEL_PX + DISC_GAP_PX) / DISC_PITCH_PX));
      setFit((prev) => (prev === next ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [total]);
  return { ref, fit };
}

/** One proposed event: a tiny two-line card. Tapping the CARD opens the
 *  event's own page (people list, your conditions, Back Out); the right-side
 *  pill is the only in-card action, and only when there's something to do:
 *    - joinable            → blue "Confirm" pill (button),
 *    - confirmed + met     → GREEN card, "You're going!" pill (indicator),
 *    - confirmed + pending → BLUE card, "Pending" pill (indicator),
 *    - locked out ("Full") → GREY card, "Full" pill (indicator) — grey, not
 *      green, even when the party is met: a happening event you're not part
 *      of isn't good news for YOU.
 *  Cancelling moved to the event page's "Back Out" — no cancel here.
 *  Every card is the full width of the time-slot column, so a row of them
 *  reads as one stack rather than a ragged edge. Line 1 is {emoji} {activity}
 *  @ {earliest-viable time}, the title truncating so the time survives; line 2
 *  is one disc per OTHER confirmed person (the server already excludes the
 *  viewer from confirmed_names) with the status pill closing it on the right,
 *  the discs collapsing to "+X" where they'd meet it. */
function EventCard({
  ev,
  onConfirm,
  onOpen,
}: {
  ev: SlotEvent;
  onConfirm: (ev: SlotEvent) => void;
  onOpen: (ev: SlotEvent) => void;
}) {
  const going = ev.viewer_confirmed && ev.met;
  const pending = ev.viewer_confirmed && !ev.met;
  const full = !ev.viewer_confirmed && !ev.can_confirm;
  // Everyone confirmed except the viewer (the server already leaves them out of
  // confirmed_names; confirmed_count counts them).
  const othersTotal = ev.confirmed_count - (ev.viewer_confirmed ? 1 : 0);
  const { ref: discsRef, fit } = useDiscFit(othersTotal);
  const shown = ev.confirmed_names.slice(0, fit);
  const extra = othersTotal - shown.length;
  const cardCls = going
    ? "border-green-500 dark:border-green-500 bg-green-50 dark:bg-green-900/30 text-green-800 dark:text-green-200 font-semibold"
    : pending
      ? "border-blue-400 dark:border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200"
      : full
        ? "border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800/60 text-gray-400 dark:text-gray-500"
        : "border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300";
  const timeCls = going
    ? "text-green-600 dark:text-green-300"
    : pending
      ? "text-blue-500 dark:text-blue-300"
      : "text-gray-400 dark:text-gray-500";
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(ev)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(ev);
        }
      }}
      title={ev.confirmed_names.length > 0 ? `Going: ${ev.confirmed_names.join(", ")}` : undefined}
      className={`flex w-full cursor-pointer items-center rounded-2xl border py-1.5 px-2.5 text-[12.5px] leading-tight transition-colors active:opacity-80 ${cardCls}`}
    >
      <div className="min-w-0 flex-1 flex flex-col gap-1">
        {/* Line 1 — the title gives way first: it truncates so the "@ time"
            (shrink-0) is always readable rather than being pushed off. */}
        <span className="flex items-baseline min-w-0">
          {/* min-w-0 as well as truncate: without it the nowrap title still
              reports its full width as min-content and drags the whole column
              out with it. */}
          <span className="min-w-0 truncate">
            {ev.emoji ? `${ev.emoji} ` : ""}
            {ev.activity}
          </span>
          {ev.time && <span className={`${timeCls} shrink-0`}>&nbsp;@ {fmtClock(ev.time)}</span>}
        </span>
        {/* Line 2 — discs from the left, status pill pinned bottom-right. The
            discs take whatever the pill leaves and collapse to "+X" at the
            point they'd otherwise run into it (see useDiscFit). */}
        <div className="flex items-center gap-1 min-h-[18px]">
          <div ref={discsRef} className="min-w-0 flex-1 flex items-center gap-1 overflow-hidden">
            {shown.length === 0 && extra <= 0 ? (
              <span className="truncate text-[11px] font-normal text-gray-400 dark:text-gray-500">
                {ev.viewer_confirmed ? "Just you so far" : "No one yet"}
              </span>
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
              <span className="shrink-0 text-[11px] tabular-nums text-gray-400 dark:text-gray-500">
                +{extra}
              </span>
            )}
          </div>
          {/* Only Confirm is a live button (stopPropagation so it doesn't also
              open the page); the rest are indicators — the card tap handles
              navigation. */}
          {going ? (
            <span className="shrink-0 whitespace-nowrap rounded-full bg-green-600 px-2.5 py-0.5 text-[11.5px] font-medium text-white">
              You&apos;re going!
            </span>
          ) : pending ? (
            <span className="shrink-0 whitespace-nowrap rounded-full bg-blue-100 px-2.5 py-0.5 text-[11.5px] font-medium text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
              Pending
            </span>
          ) : full ? (
            <span className="shrink-0 whitespace-nowrap rounded-full bg-gray-200 px-2.5 py-0.5 text-[11.5px] font-medium text-gray-400 dark:bg-gray-700 dark:text-gray-500">
              Full
            </span>
          ) : (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onConfirm(ev);
              }}
              aria-label={`Confirm ${ev.activity}`}
              className="shrink-0 whitespace-nowrap rounded-full bg-blue-600 px-2.5 py-0.5 text-[11.5px] font-medium text-white transition active:bg-blue-700"
            >
              Confirm
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** The glyph shown inside an activity's circle: its emoji, else the first
 *  letter of its name (uppercased). */
function activitySymbol(name: string, emoji: string | null): string {
  return emoji || name.trim().charAt(0).toUpperCase() || "?";
}

function SlotCardImpl({
  slot,
  line,
  colors,
  events,
  onConfirm,
  onOpenEvent,
  suggested,
  onOpenSuggested,
}: SlotCardProps) {
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
    // The row sits in a borderless card in the PAGE background color, lifted
    // off the tinted timeline surface behind it (PlaylistTab paints that), with
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
      className="rounded-3xl bg-background py-2"
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
          // TIME_COLUMN_BASIS is the shared divide with the column headers.
          // An explicit WIDTH, not a min: the event cards fill the column, so
          // a content-sized column would be defined by its longest card (and
          // nothing would ever truncate). min-content keeps the one thing that
          // genuinely can't give — the nowrap time chip — able to push the
          // boundary out on a narrow screen; the cards, which truncate, don't.
          style={{
            top: `calc(var(${PLAYLIST_HEADER_H_VAR}) + 37.2px)`,
            width: TIME_COLUMN_BASIS,
            minWidth: "min-content",
          }}
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
              right-side pill (Confirm / You're going! / Pending / Full);
              tapping the card opens the event's own page, where Back Out
              lives. A met event YOU are in goes bold + green; a met event
              you're locked out of is grey. */}
          {/* contain: inline-size takes the cards OUT of the column's own
              width calculation. They fill the column, so without it the column
              is sized by its longest card (nothing truncates, and the circles
              get shoved off) — while the min-content floor above still has to
              see the time chip, which genuinely can't shrink. */}
          <div
            className="mt-2 flex flex-col items-stretch gap-1.5"
            style={{ contain: "inline-size" }}
          >
            {events.length === 0 ? (
              <span className="text-sm text-gray-400 dark:text-gray-500">No events yet…</span>
            ) : (
              events.map((ev) => <EventCard key={`${ev.day}#${ev.activity.toLowerCase()}#${ev.id ?? "fresh"}`} ev={ev} onConfirm={onConfirm} onOpen={onOpenEvent} />)
            )}
          </div>
        </div>
        {/* pl-3 is the gutter between the two columns — the circles pack out
            to the cluster's edge, so the time text needs the room. Column
            layout: the activity cluster centered in whatever height the row
            takes, then (when there's anything to act on) the Suggested chip
            pinned to the BOTTOM — confined to THIS column, the interests side,
            since it's about interests. The column carries no bottom padding,
            so the chip bottoms out level with the last event card in the left
            column and both get the card's own py-2 beneath them. */}
        <div className="flex-1 min-w-0 flex flex-col items-center pl-3 pt-1">
          {/* Every circle is absolutely placed from the hex layout, so the box
              only has to reserve the cluster's measured size. The wrapper takes
              the slack so the cluster stays centered above the chip. */}
          <div
            className="relative shrink-0 my-auto"
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
          {/* Activities OTHERS (whose who-with admits you) are planning
              during this period: a little rounded card with NO outline (the
              timeline's tinted surface lifts it off the slot's white), ICONS
              only — the names live in the modal it opens, where add (+) /
              silence (✕) act immediately. It only exists while something is
              left to act on — everything added or silenced → gone. */}
          {suggested.length > 0 && (
            <button
              type="button"
              onClick={() => onOpenSuggested(slot)}
              aria-label="Suggested activities"
              className="mt-1.5 shrink-0 flex max-w-full items-center gap-1 rounded-2xl bg-[var(--playlist-surface)] px-2.5 py-1 active:opacity-80 transition-opacity"
            >
              <span className="shrink-0 text-[9.5px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
                Suggested
              </span>
              <span className="min-w-0 truncate text-[15px] leading-none">
                {suggested.map((s) => activitySymbol(s.name, s.emoji ?? null)).join(" ")}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default memo(SlotCardImpl);
