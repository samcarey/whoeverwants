"use client";

/**
 * Preference ordering over several confirmed events sharing one time slot.
 *
 * Opened two ways:
 *  - `showIntro` (the confirm flow, from the event page): step 1 lists each
 *    event's time range and says whether they overlap, then leads into the
 *    ordering step.
 *  - without intro (the "Order preferences" button under a slot's events on
 *    the Playlist): straight to the ordering step, to revisit the choice.
 *
 * The ordering step reuses the poll drag-to-rank interface (RankableOptions)
 * with the exclude zone off — every event stays ranked — and the link circles
 * rendered as "&": LINKED events are ones the user means to attend BOTH of,
 * regardless of overlap, while the ordered (unlinked) list is a fallback
 * chain (top first; the next is the backup if the top one doesn't happen).
 * Saved per (viewer, day) as pref_rank on their confirmations (migration
 * 160); equal rank = linked.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ModalPortal from "@/components/ModalPortal";
import RankableOptions from "@/components/RankableOptions";
import { useBodyScrollLock } from "@/lib/useBodyScrollLock";
import { haptic } from "@/lib/haptics";
import { windowsOverlap } from "@/lib/timeUtils";
import { apiSetEventPreferences, type SlotEvent } from "@/lib/api/slots";

interface EventPreferenceModalProps {
  day: string;
  /** The slot's confirmed events (≥2), including any just-confirmed one. */
  events: SlotEvent[];
  /** True when opened by a confirm — show the time-ranges/overlap step first. */
  showIntro: boolean;
  onClose: () => void;
  /** Fired after a successful save so the caller can refetch the events. */
  onSaved?: () => void;
}

/** "HH:MM" → "2 PM" / "2:30 PM" (mirrors SlotCard's fmtClock). */
function fmtClock(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12} ${period}` : `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

function rangeLabel(ev: SlotEvent): string {
  if (ev.window) return `${fmtClock(ev.window.min)} – ${fmtClock(ev.window.max)}`;
  if (ev.time) return `@ ${fmtClock(ev.time)}`;
  return "time TBD";
}

export default function EventPreferenceModal({
  day,
  events,
  showIntro,
  onClose,
  onSaved,
}: EventPreferenceModalProps) {
  const [step, setStep] = useState<"intro" | "rank">(showIntro ? "intro" : "rank");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useBodyScrollLock(true);

  // Stored order first (viewer_pref_rank asc, equal ranks staying adjacent so
  // initialTiers can group them), never-ordered events after, by start time.
  const sorted = useMemo(() => {
    return [...events].sort((a, b) => {
      const ra = a.viewer_pref_rank ?? Number.MAX_SAFE_INTEGER;
      const rb = b.viewer_pref_rank ?? Number.MAX_SAFE_INTEGER;
      if (ra !== rb) return ra - rb;
      return (a.time ?? a.window?.min ?? "").localeCompare(b.time ?? b.window?.min ?? "");
    });
  }, [events]);

  // The DnD interface keys on option STRINGS. Activities are unique within a
  // day (one confirmation per (day, LOWER(activity))), so the activity label
  // is a safe key back to its event.
  const options = useMemo(() => sorted.map((e) => e.activity), [sorted]);
  const eventByActivity = useMemo(() => {
    const map = new Map<string, SlotEvent>();
    for (const e of sorted) map.set(e.activity, e);
    return map;
  }, [sorted]);

  // Stored equal ranks come back as linked tiers.
  const initialTiers = useMemo(() => {
    const tiers: string[][] = [];
    let prevRank: number | null | undefined;
    for (const e of sorted) {
      const rank = e.viewer_pref_rank ?? null;
      if (rank !== null && prevRank !== undefined && rank === prevRank && tiers.length > 0) {
        tiers[tiers.length - 1].push(e.activity);
      } else {
        tiers.push([e.activity]);
      }
      prevRank = rank;
    }
    return tiers;
  }, [sorted]);

  // Latest ordering from the DnD interface (tiers of activity labels).
  const tiersRef = useRef<string[][]>(initialTiers);
  const handleRankingChange = useCallback((_flat: string[], tiers: string[][]) => {
    tiersRef.current = tiers;
  }, []);

  // Does any pair of these events overlap in time? Drives the intro verdict.
  const anyOverlap = useMemo(() => {
    for (let i = 0; i < events.length; i++) {
      for (let j = i + 1; j < events.length; j++) {
        const a = events[i].window;
        const b = events[j].window;
        if (a && b && windowsOverlap(a, b)) return true;
      }
    }
    return false;
  }, [events]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = useCallback(async () => {
    if (busy) return;
    haptic.medium();
    setBusy(true);
    setError(false);
    const idTiers = tiersRef.current
      .map((tier) =>
        tier
          .map((label) => eventByActivity.get(label)?.id)
          .filter((id): id is string => !!id),
      )
      .filter((tier) => tier.length > 0);
    try {
      await apiSetEventPreferences(day, idTiers);
      onSaved?.();
      onClose();
    } catch {
      setError(true);
      setBusy(false);
    }
  }, [busy, day, eventByActivity, onSaved, onClose]);

  const renderOption = useCallback(
    (label: string) => {
      const ev = eventByActivity.get(label);
      return (
        <span className="min-w-0 flex-1 flex flex-col leading-tight">
          <span className="min-w-0 truncate text-[15px]">
            {ev?.emoji ? `${ev.emoji} ` : ""}
            {label}
          </span>
          <span className="min-w-0 truncate text-[12px] text-gray-500 dark:text-gray-400">
            {ev ? rangeLabel(ev) : ""}
          </span>
        </span>
      );
    },
    [eventByActivity],
  );

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-[69] bg-black/40 dark:bg-black/60 animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 pointer-events-none">
        <div
          className="pointer-events-auto w-full max-w-sm max-h-[85vh] overflow-y-auto rounded-3xl bg-white dark:bg-gray-800 p-4 shadow-2xl"
          role="dialog"
          aria-modal="true"
          aria-label="Order your events"
        >
          {step === "intro" ? (
            <>
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                {sorted.length === 2 ? "Two events, one time slot" : `${sorted.length} events, one time slot`}
              </h2>
              <ul className="mt-3 space-y-2">
                {sorted.map((e) => (
                  <li
                    key={`${e.day}#${e.activity.toLowerCase()}`}
                    className="flex items-center gap-2 rounded-2xl border border-gray-200 dark:border-gray-700 px-3 py-2"
                  >
                    <span className="min-w-0 flex-1 truncate text-[15px] text-gray-900 dark:text-gray-100">
                      {e.emoji ? `${e.emoji} ` : ""}
                      {e.activity}
                    </span>
                    <span className="shrink-0 text-[13px] tabular-nums text-gray-500 dark:text-gray-400">
                      {rangeLabel(e)}
                    </span>
                  </li>
                ))}
              </ul>
              <p
                className={`mt-3 rounded-xl px-3 py-2 text-[13px] ${
                  anyOverlap
                    ? "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                    : "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                }`}
              >
                {anyOverlap
                  ? "These time ranges overlap — you can't be at both."
                  : "These time ranges don't overlap, but they share your time slot."}
              </p>
              <button
                type="button"
                onClick={() => setStep("rank")}
                className="mt-3 w-full rounded-2xl bg-blue-600 py-2.5 font-medium text-white transition active:bg-blue-700"
              >
                Put them in order
              </button>
            </>
          ) : (
            <>
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                Order your events
              </h2>
              <p className="mt-1 text-[13px] text-gray-500 dark:text-gray-400">
                Drag into preference order — if the top one doesn&apos;t happen, the
                next is your backup. Tap the{" "}
                <span className="font-bold text-gray-700 dark:text-gray-300">&amp;</span>{" "}
                between two events to link them: linked events are{" "}
                <span className="font-medium">both confirmed, regardless of overlap</span>.
              </p>
              <div className="mt-3">
                <RankableOptions
                  options={options}
                  onRankingChange={handleRankingChange}
                  initialRanking={options}
                  initialTiers={initialTiers}
                  renderOption={renderOption}
                  preserveOrder
                  allowExclude={false}
                  linkGlyph="ampersand"
                />
              </div>
              {error && (
                <p className="mt-2 text-[13px] text-red-500 dark:text-red-400">
                  Couldn&apos;t save your order — try again.
                </p>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => void save()}
                className="mt-2 w-full rounded-2xl bg-blue-600 py-2.5 font-medium text-white transition active:bg-blue-700 disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save order"}
              </button>
            </>
          )}
        </div>
      </div>
    </ModalPortal>
  );
}
