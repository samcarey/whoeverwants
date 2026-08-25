"use client";

/**
 * The home page: the caller's saved availability slots, soonest first, each
 * rendered as a <SlotCard>, with the system's proposed EVENTS hanging under
 * the row whose window they fit (see the events block below). (Also rendered by HomeBackdropHost as the
 * swipe-back mirror of home, which is why it seeds from the slots cache.) Refreshes when a slot is created /
 * edited / deleted (SLOTS_CHANGED_EVENT, fired by the New Slot sheet) and when
 * the tab regains visibility. Tapping the "+" beside the "Time Slots" header
 * or a card opens the sheet — it's mounted once at layout level (inside
 * CreateGroupButtonHost) and listens on the slot-sheet event channel, so there
 * is no floating button for this tab.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { navigateWithTransition } from "@/lib/viewTransitions";
import { HOME_SCROLL_KEY, rememberCurrentScroll } from "@/lib/scrollMemory";
import {
  apiListSlots,
  getCachedSlots,
  apiGetSlotEvents,
  getCachedSlotEvents,
  apiSetEventConfirmation,
  type Slot,
  type SlotEvent,
} from "@/lib/api/slots";
import { haptic } from "@/lib/haptics";
import { windowsOverlap } from "@/lib/timeUtils";
import {
  buildActivityColorMap,
  sortSlotsChronological,
  slotWindowEntries,
  type SlotWindowEntry,
  edgeToEdgeStyle,
} from "@/lib/slotUtils";
import {
  SLOTS_CHANGED_EVENT,
  SLOT_ADD_PANEL_EVENT,
  PLAYLIST_HEADER_H_VAR,
  openSlotSheet,
} from "@/lib/slotEvents";
import SlotCard from "@/components/SlotCard";

// Stable empty list so rows without events keep reference-equal props (the
// memo'd SlotCard skips them on every poll tick).
const NO_EVENTS: SlotEvent[] = [];

export default function PlaylistTab() {
  // Seed from the last-resolved list so a first commit paints the timeline
  // instead of a spinner. Load-bearing for the swipe-back backdrop, which
  // mounts this component fresh under the sliding page (see the "destination
  // must paint settled content on its first commit" rule in CLAUDE.md).
  const [slots, setSlots] = useState<Slot[] | null>(() => getCachedSlots());
  const [error, setError] = useState(false);
  // The system-proposed events for this viewer. Server-derived and volatile —
  // someone else's confirm can flip a card to Full — so alongside the usual
  // change-triggered loads this POLLS every 5s while the tab is visible (the
  // group page's cadence: recursive setTimeout, never setInterval, skipped
  // while hidden). A JSON-signature compare keeps no-change ticks from
  // re-rendering every card.
  const [events, setEvents] = useState<SlotEvent[]>(() => getCachedSlotEvents() ?? []);
  const eventsSigRef = useRef<string>(JSON.stringify(getCachedSlotEvents() ?? []));
  // While the add-activity panel is up the column headers hide and both sticky
  // tiers below them shift to the top of the screen (PLAYLIST_HEADER_H_VAR),
  // so the tapped row's day + time are what sits under the panel.
  const [addingActivity, setAddingActivity] = useState(false);
  useEffect(() => {
    const onPanel = (e: Event) => setAddingActivity(!!(e as CustomEvent<boolean>).detail);
    window.addEventListener(SLOT_ADD_PANEL_EVENT, onPanel);
    return () => window.removeEventListener(SLOT_ADD_PANEL_EVENT, onPanel);
  }, []);

  const loadEvents = useCallback(async () => {
    try {
      const next = await apiGetSlotEvents();
      const sig = JSON.stringify(next);
      if (sig !== eventsSigRef.current) {
        eventsSigRef.current = sig;
        setEvents(next);
      }
    } catch {
      // Keep the last-known events; the next tick retries.
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const next = await apiListSlots();
      setSlots(next);
      setError(false);
    } catch {
      setSlots((prev) => prev ?? []);
      setError(true);
    }
    void loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    void load();
    const onChanged = () => void load();
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener(SLOTS_CHANGED_EVENT, onChanged);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener(SLOTS_CHANGED_EVENT, onChanged);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  // The live-update loop: a confirm elsewhere must reach this screen with no
  // refresh (a Full button appearing, a cancel freeing it, an event going
  // bold). Recursive setTimeout so a slow response can never stack fetches.
  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    const tick = async () => {
      if (!alive) return;
      if (document.visibilityState === "visible") await loadEvents();
      if (alive) timer = window.setTimeout(() => void tick(), 5000);
    };
    timer = window.setTimeout(() => void tick(), 5000);
    return () => {
      alive = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [loadEvents]);

  // Confirm (the card's only in-place action — cancelling lives on the event
  // page as "Back Out"). The server is the real gate, and one confirm can
  // move SEVERAL cards (a fresh card mints a party, switching parties changes
  // two), so just re-pull the whole list either way and let the refreshed
  // flags drive every pill. A 409 "Full" race lands the same way: the refetch
  // shows the Full state.
  const confirmEvent = useCallback(
    async (ev: SlotEvent) => {
      haptic.medium();
      try {
        await apiSetEventConfirmation(ev.day, ev.activity, true, ev.id);
      } catch {
        // Fall through to the refetch.
      }
      await loadEvents();
    },
    [loadEvents],
  );

  // Tapping a card opens the event's own page (people list, your conditions,
  // Back Out). Scroll is saved first so back-nav lands where you left.
  const router = useRouter();
  const openEvent = useCallback(
    (ev: SlotEvent) => {
      rememberCurrentScroll(HOME_SCROLL_KEY);
      const params = new URLSearchParams({ day: ev.day, activity: ev.activity });
      if (ev.id) params.set("id", ev.id);
      navigateWithTransition(router, `/event?${params.toString()}`, "forward");
    },
    [router],
  );

  // One row PER availability window across all slots, soonest first; a stable
  // per-activity color map keyed to chronological first-appearance.
  const sorted = useMemo(() => (slots ? sortSlotsChronological(slots) : []), [slots]);
  const colors = useMemo(() => buildActivityColorMap(sorted), [sorted]);
  const entries = useMemo(() => (slots ? slotWindowEntries(slots) : []), [slots]);

  // Group consecutive entries by their start day (entries are already sorted
  // soonest-first, so all of a day's windows are contiguous). Each day gets one
  // divider header (its first entry's relative + date); its windows render as
  // bare-time rows under it. A day appears exactly once, so `day` is a unique
  // React key.
  const dayGroups = useMemo(() => {
    const out: { day: string; entries: SlotWindowEntry[] }[] = [];
    for (const e of entries) {
      const last = out[out.length - 1];
      if (last && last.day === e.day) last.entries.push(e);
      else out.push({ day: e.day, entries: [e] });
    }
    return out;
  }, [entries]);

  // Attach each event to ONE row: the first of its day whose window overlaps
  // the event's current common window (falling back to the day's first row,
  // so a can't-currently-join event still shows somewhere). One row per event
  // — an event spanning two of the viewer's windows would otherwise render
  // twice with two live buttons.
  const eventsByEntryKey = useMemo(() => {
    const map = new Map<string, SlotEvent[]>();
    for (const ev of events) {
      const dayEntries = entries.filter((e) => e.day === ev.day);
      if (dayEntries.length === 0) continue;
      const target = ev.window
        ? dayEntries.find((e) => windowsOverlap(e.window, ev.window!)) ?? dayEntries[0]
        : dayEntries[0];
      const list = map.get(target.key);
      if (list) list.push(ev);
      else map.set(target.key, [ev]);
    }
    return map;
  }, [events, entries]);

  if (slots === null) {
    return (
      <div className="flex justify-center items-center py-8">
        <svg className="animate-spin h-8 w-8 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 0 1 4 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      </div>
    );
  }

  // The header renders in BOTH states — it carries the "+" that creates a
  // slot, so an empty playlist still has a way in.
  const header = (
    <>
      {/* Column headers naming the two halves of each row: the time span on
          the left, the activity cards on the right. They stick to the top of
          the viewport once scrolled to, with the rows passing underneath.
          Three sticky tiers stack here — these headers, then each day's
          divider, then each row's time (in SlotCard) — and every tier's offset
          is the bottom edge of the one above it, so the stack is opaque all
          the way down and no half-scrolled row can show through between them.
          No tier fades out at its bottom edge — the rows underneath are
          edge-to-edge, so a gradient would just be a strip of half-visible
          content; every tier cuts cleanly instead.
          The bar's background runs to both screen edges (edgeToEdgeStyle) so
          a row scrolling underneath can't peek through the page's safe-area
          padding at the sides. */}
      {/* z-30 clears the day dividers (z-20) and the activity emoji (z-10
          inside each card) so both slide UNDER this bar instead of over it. */}
      {/* Heights are load-bearing — the tiers below offset off them:
          7.6px + 28px line + 4px = 39.6px. */}
      <div
        data-playlist-headers=""
        className={`sticky top-0 z-30 flex items-center bg-gray-100 dark:bg-gray-900 pt-[7.6px] pb-1 ${
          addingActivity ? "hidden" : ""
        }`}
        style={edgeToEdgeStyle("0.25rem", "0.75rem")}
      >
        {/* Each label is centered over its own column. The rows' left column
            is content-sized (it hugs its own time text), so there's no single
            shared boundary to align to — 45% is where the widest time span
            ends, i.e. the visual split between the two halves.
            The whole left header is the add-a-slot button — a pill in the
            app's subtle-blue stack (the SearchRadiusBubble convention), which
            is affordance enough that the label drops its underline. It has no
            vertical padding: the text's own 28px line box gives the pill its
            height, so the bar's height (load-bearing, above) is unchanged. */}
        <span className="w-[45%] shrink-0 flex items-center justify-center">
          {/* The only way to add a slot (there's no floating button). */}
          <button
            type="button"
            onClick={() => {
              haptic.medium();
              openSlotSheet();
            }}
            aria-label="Time Slots — add a time slot"
            className="shrink-0 flex items-center gap-1.5 px-3 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 active:scale-95 transition-transform"
          >
            <span className="text-lg font-semibold tracking-wide">Time Slots</span>
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </span>
        <span className="flex-1 text-center text-lg font-semibold tracking-wide underline underline-offset-[3px] text-gray-900 dark:text-gray-100">
          My Interests
        </span>
      </div>
    </>
  );

  return (
    <div
      className="pt-2"
      style={
        {
          [PLAYLIST_HEADER_H_VAR]: addingActivity ? "0px" : "39.6px",
          // Room for ANY row — including the last — to scroll to the top of
          // the screen while the add panel is up.
          paddingBottom: addingActivity ? "100vh" : undefined,
        } as React.CSSProperties
      }
    >
      {/* The timeline's surface. Page and slot trade places vs the original:
          the PAGE is the tinted shade and each slot sits on it as a card in
          the page background. Fixed + behind the content (negative z paints
          over the canvas but under everything in flow) so it covers the whole
          viewport without touching layout or scroll height. Anything that
          masks scrolled content (the sticky tiers below) matches THIS color. */}
      <div aria-hidden className="fixed inset-0 -z-10 bg-gray-100 dark:bg-gray-900" />
      {header}
      {entries.length === 0 && (
        <div className="text-center py-8">
          <p className="text-gray-500 dark:text-gray-400">
            No slots yet. Tap <span className="font-medium">+</span> above to add your availability.
          </p>
          {error && (
            <p className="mt-2 text-xs text-red-500 dark:text-red-400">
              Couldn&apos;t load your slots — check your connection.
            </p>
          )}
        </div>
      )}
      {dayGroups.map((g) => (
        <div key={g.day} className="mb-1.5">
          {/* Per-day divider: left-justified date (font +20% over the old
              text-sm), hairline rule filling the rest of the row on the right.
              It sticks flush against the bottom of the column headers
              (39.6px) so the day you're looking at stays named while its rows
              scroll under it. Sticking is scoped to this day's block, so the
              divider rides up and out exactly as the next day's arrives and
              takes its place — that one paints over it, being later in the
              DOM at the same z. z-20 sits above the cards' emoji (z-10) and
              below the column headers (z-30). */}
          <div className="sticky z-20" style={{ top: `var(${PLAYLIST_HEADER_H_VAR})` }}>
            {/* 25.2px line + 4px = 29.2px, so this bar ends at 68.8px — the
                offset each row's sticky time stacks against. */}
            <div
              className="flex items-center gap-3 bg-gray-100 dark:bg-gray-900 pb-1"
              style={edgeToEdgeStyle("0.25rem", "0.25rem")}
            >
              <div className="flex items-baseline gap-1.5 shrink-0">
                <span className="text-[16.8px] font-semibold text-gray-900 dark:text-gray-100">
                  {g.entries[0].line.relative}
                </span>
                <span className="text-[16.8px] text-gray-500 dark:text-gray-400">{g.entries[0].line.date}</span>
              </div>
              <div className="flex-1 border-t border-gray-200 dark:border-gray-700" />
            </div>
          </div>
          {/* Cards are edge-to-edge (each SlotCard cancels the page's
              safe-area padding itself), so the only gap here is the thin
              vertical one between them. */}
          <div className="space-y-1">
            {g.entries.map((e) => (
              <SlotCard
                key={e.key}
                slot={e.slot}
                line={e.line}
                colors={colors}
                events={eventsByEntryKey.get(e.key) ?? NO_EVENTS}
                onConfirm={confirmEvent}
                onOpenEvent={openEvent}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
