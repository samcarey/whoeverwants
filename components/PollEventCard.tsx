"use client";

/** Event layer Phase 1 (docs/event-layer-plan.md): the card a DECIDED poll
 *  shows above its ballots — the winning time, who's presumed in, and the
 *  viewer's "Can't make it" / "I'm in" toggle. Commitment is presumed-in
 *  (docs/purpose.md, 2026-07-08): attendees derive from ballots server-side;
 *  the toggle writes the per-person exception.
 *
 *  Renders nothing until the event loads (and nothing at all for polls with
 *  no event — open / no time question / no winner / cancelled), so the page
 *  never reserves space speculatively. */

import { useCallback, useEffect, useState } from "react";
import {
  apiGetPollEvent,
  type PollEventData,
} from "@/lib/api/groups";
import { apiSetEventAttendance } from "@/lib/api/polls";
import { formatTimeSlot } from "@/lib/timeUtils";
import { haptic } from "@/lib/haptics";

interface PollEventCardProps {
  groupRouteId: string;
  pollRef: string; // poll short_id (falls back to uuid at the call site)
  pollId: string;
}

export default function PollEventCard({
  groupRouteId,
  pollRef,
  pollId,
}: PollEventCardProps) {
  const [event, setEvent] = useState<PollEventData | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const ev = await apiGetPollEvent(groupRouteId, pollRef);
      setEvent(ev.has_event ? ev : null);
    } catch {
      // Non-member / stale ref / network — no card is the right degradation.
      setEvent(null);
    }
  }, [groupRouteId, pollRef]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!event || !event.slot_key) return null;

  const viewerIn = event.viewer_status === "in";
  const toggle = async () => {
    if (saving) return;
    haptic.medium();
    setSaving(true);
    try {
      await apiSetEventAttendance(pollId, viewerIn ? "out" : "in");
      await refresh();
    } catch {
      // Leave the previous state on failure; the next open refetches.
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mt-2 mb-3 rounded-2xl border border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-900/20 px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span aria-hidden className="shrink-0">📅</span>
          <span className="min-w-0 truncate font-semibold text-green-800 dark:text-green-300">
            {formatTimeSlot(event.slot_key)}
          </span>
        </div>
        <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
          {event.in_count} going
        </span>
      </div>
      {event.attendees.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {event.attendees.map((a, i) => (
            <span
              key={`${a.name ?? "anon"}#${i}`}
              className={`px-2 py-0.5 rounded-full text-xs ${
                a.status === "in"
                  ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
                  : "bg-gray-100 text-gray-400 line-through dark:bg-gray-800 dark:text-gray-500"
              }`}
            >
              {a.is_viewer
                ? a.name
                  ? `You (${a.name})`
                  : "You"
                : a.name ?? "Anonymous"}
            </span>
          ))}
        </div>
      )}
      <div className="mt-2 text-center">
        <button
          type="button"
          onClick={() => void toggle()}
          disabled={saving}
          className={`text-xs font-medium hover:underline active:opacity-70 disabled:opacity-50 ${
            viewerIn
              ? "text-amber-600 dark:text-amber-400"
              : "text-green-700 dark:text-green-400"
          }`}
        >
          {viewerIn ? "Can't make it" : "I'm in"}
        </button>
      </div>
    </section>
  );
}
