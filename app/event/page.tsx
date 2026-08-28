"use client";

/**
 * The event's own page — tapped through from a playlist event card
 * (`/event?day=YYYY-MM-DD&activity=Name[&id=<party uuid>]`). Shows the full
 * gathering: title @ time with the status pill, everyone wanting to go (You +
 * each confirmed person), and the viewer's own who-with conditions for the
 * activity (read-only — editing stays in the activity sheet). The bottom
 * action is where cancelling lives: "Back Out" when confirmed (the playlist
 * card deliberately has no cancel), "Confirm" when joinable, a dead "Full"
 * otherwise.
 *
 * Everything is re-derived from the same polled `/api/slots/events` list the
 * playlist uses, so the page tracks live changes (someone filling the party
 * flips the button to Full with no refresh). If the targeted party dissolves
 * (e.g. the viewer backs out of a party of one) the page falls back to the
 * key's fresh card, so backing out flows straight into "Confirm again".
 *
 * Back button + swipe-back → home (mirrors /explore's gesture + HeaderPortal
 * chrome; the template's fallback header is suppressed via isEventPage).
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePageReady } from "@/lib/usePageReady";
import { navigateWithTransition } from "@/lib/viewTransitions";
import { useSwipeBackGesture, useHeaderPortalRef } from "@/lib/useSwipeBackGesture";
import { SHOW_HOME_BACKDROP_EVENT, HIDE_HOME_BACKDROP_EVENT } from "@/lib/eventChannels";
import HeaderPortal from "@/components/HeaderPortal";
import ConfirmationModal from "@/components/ConfirmationModal";
import InitialBubble from "@/components/InitialBubble";
import { useMyUserImageUrl } from "@/lib/useMyUserImageUrl";
import { GroupGlyph } from "@/components/CandidatePicker";
import { partyCountLabel } from "@/components/PartyCountField";
import { haptic } from "@/lib/haptics";
import {
  apiGetSlotEvents,
  apiListSlots,
  apiSetEventConfirmation,
  getCachedSlotEvents,
  getCachedSlots,
  type Slot,
  type SlotEvent,
  type WhoWithRef,
} from "@/lib/api/slots";
import { getRelativeDayLabel } from "@/lib/timeUtils";

/** "HH:MM" → "2 PM" / "2:30 PM" (mirrors SlotCard's fmtClock). */
function fmtClock(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12} ${period}` : `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

function fmtDate(day: string): string {
  const d = new Date(day + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

/** Condition pills for a who-with ref list ("With" / "Without" rows). */
function RefPills({ refs, empty }: { refs: WhoWithRef[]; empty: string }) {
  if (refs.length === 0) {
    return <span className="text-gray-500 dark:text-gray-500">{empty}</span>;
  }
  return (
    <span className="flex flex-wrap justify-end gap-1.5">
      {refs.map((r, i) => (
        <span
          key={`${r.id ?? r.name}#${i}`}
          className="inline-flex items-center gap-1 rounded-full bg-gray-200 px-2 py-0.5 text-sm text-gray-700 dark:bg-gray-700 dark:text-gray-300"
        >
          {r.id !== undefined && (r as { kind?: string }).kind === "groups" ? <GroupGlyph className="w-3.5 h-3.5 shrink-0" /> : null}
          {r.name}
        </span>
      ))}
    </span>
  );
}

function EventPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const day = params.get("day") ?? "";
  const activity = params.get("activity") ?? "";
  const partyId = params.get("id");
  const key = activity.trim().toLowerCase();
  usePageReady(true);

  const myImageUrl = useMyUserImageUrl();
  const [events, setEvents] = useState<SlotEvent[]>(() => getCachedSlotEvents() ?? []);
  const [slots, setSlots] = useState<Slot[] | null>(() => getCachedSlots());
  const [busy, setBusy] = useState(false);
  const [confirmingBackOut, setConfirmingBackOut] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setEvents(await apiGetSlotEvents());
    } catch {
      // Keep the last-known list; the next tick retries.
    }
  }, []);

  useEffect(() => {
    void refresh();
    apiListSlots().then(setSlots).catch(() => setSlots((prev) => prev ?? []));
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  // The same 5s live loop the playlist runs — Full can appear/clear under the
  // viewer while they read this page.
  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    const tick = async () => {
      if (!alive) return;
      if (document.visibilityState === "visible") await refresh();
      if (alive) timer = window.setTimeout(() => void tick(), 5000);
    };
    timer = window.setTimeout(() => void tick(), 5000);
    return () => {
      alive = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [refresh]);

  // The card being viewed: the named party when it still exists, else the
  // viewer's own party of this key, else the key's fresh card — so a Back Out
  // that dissolves a party lands on "Confirm again" instead of a dead end.
  const ev = useMemo(() => {
    const matching = events.filter((e) => e.day === day && e.activity.trim().toLowerCase() === key);
    return (
      (partyId && matching.find((e) => e.id === partyId)) ||
      matching.find((e) => e.viewer_confirmed) ||
      matching[0] ||
      null
    );
  }, [events, day, key, partyId]);

  // The viewer's own who-with condition for this activity (from their slot on
  // this day) — display-only here; the activity sheet is where it's edited.
  const condition = useMemo(() => {
    for (const slot of slots ?? []) {
      if (!slot.day_time_windows?.some((d) => d.day === day)) continue;
      const a = slot.activities.find((x) => x.name.trim().toLowerCase() === key);
      if (a) return a;
    }
    return null;
  }, [slots, day, key]);
  const entry = condition?.who_with?.[0] ?? null;
  const withRefs = [
    ...(entry?.groups ?? []).map((r) => ({ ...r, kind: "groups" })),
    ...(entry?.people ?? []).map((r) => ({ ...r, kind: "people" })),
  ];
  const withoutRefs = [
    ...(entry?.exclude_groups ?? []).map((r) => ({ ...r, kind: "groups" })),
    ...(entry?.exclude_people ?? []).map((r) => ({ ...r, kind: "people" })),
  ];
  const minPeople = entry?.min_people ?? condition?.min_people ?? 1;
  const maxPeople = entry?.max_people ?? condition?.max_people ?? null;

  const setConfirmed = useCallback(
    async (confirmed: boolean) => {
      if (!ev || busy) return;
      haptic.medium();
      setBusy(true);
      try {
        await apiSetEventConfirmation(ev.day, ev.activity, confirmed, ev.id);
      } catch {
        // The refetch below surfaces the true state (e.g. a Full race).
      }
      await refresh();
      setBusy(false);
    },
    [ev, busy, refresh],
  );

  // Swipe-back → home (mirrors /explore's gesture).
  const headerPortalRef = useHeaderPortalRef();
  const { swipeWrapperRef, touchHandlers } = useSwipeBackGesture({
    headerRef: headerPortalRef,
    showBackdrop: () => window.dispatchEvent(new Event(SHOW_HOME_BACKDROP_EVENT)),
    hideBackdrop: () => window.dispatchEvent(new Event(HIDE_HOME_BACKDROP_EVENT)),
    onCommit: () => router.push("/"),
  });

  const going = !!ev && ev.viewer_confirmed && ev.met;
  const pending = !!ev && ev.viewer_confirmed && !ev.met;
  // NEAR-MISS: no viable gathering yet — "Needs N more" instead of Full.
  const short = !!ev && !ev.viewer_confirmed && (ev.needed ?? 0) > 0;
  const full = !!ev && !ev.viewer_confirmed && !ev.can_confirm && !short;
  const statusPill = going ? (
    <span className="rounded-full bg-green-600 px-3 py-1 text-sm font-medium text-white">You&apos;re going!</span>
  ) : pending ? (
    <span className="rounded-full bg-blue-100 px-3 py-1 text-sm font-medium text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
      Pending
    </span>
  ) : short ? (
    <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
      Needs {ev.needed} more
    </span>
  ) : full ? (
    <span className="rounded-full bg-gray-200 px-3 py-1 text-sm font-medium text-gray-400 dark:bg-gray-700 dark:text-gray-500">
      Full
    </span>
  ) : null;

  return (
    <>
      <HeaderPortal>
        <button
          onClick={() => navigateWithTransition(router, "/", "back")}
          className="fixed left-3 z-30 w-10 h-10 flex items-center justify-center rounded-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 active:opacity-70"
          style={{ top: "calc(env(safe-area-inset-top, 0px) + 0.5rem)" }}
          aria-label="Go back"
        >
          <svg className="w-6 h-6 text-gray-700 dark:text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      </HeaderPortal>

      {/* Opaque z-2 swipe wrapper over the z-0 home backdrop (the /explore
          pattern; margins cancel the template's px-4 + safe-area so the bg
          reaches the screen edges). */}
      <div
        ref={swipeWrapperRef}
        {...touchHandlers}
        className="touch-pan-y"
        style={{
          willChange: "transform",
          position: "relative",
          zIndex: 2,
          background: "var(--background)",
          minHeight: "100dvh",
          marginLeft: "calc(-1rem - max(0.35rem, env(safe-area-inset-left, 0px)))",
          marginRight: "calc(-1rem - max(0.35rem, env(safe-area-inset-right, 0px)))",
        }}
      >
        <div
          className="mx-auto max-w-md px-4"
          style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 3.75rem)", paddingBottom: "2rem" }}
        >
          {!ev ? (
            <div className="py-16 text-center text-gray-500 dark:text-gray-400">
              {activity ? "This event is gone — the slots behind it changed." : "Event not found."}
            </div>
          ) : (
            <>
              {/* Title block: emoji + activity, the day, @ time, status. */}
              <div className="flex flex-col items-center gap-2 text-center">
                <div className="text-5xl leading-none">{ev.emoji ?? "📅"}</div>
                <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{ev.activity}</h1>
                <p className="text-gray-500 dark:text-gray-400">
                  <span className="text-blue-600 dark:text-blue-400">{getRelativeDayLabel(ev.day)}</span>{" "}
                  · {fmtDate(ev.day)}
                  {ev.time && <> · {fmtClock(ev.time)}</>}
                </p>
                {statusPill}
              </div>

              {/* Everyone wanting to go. */}
              <section className="mt-8">
                <h2 className="mb-2 px-1 text-[17.5px] font-medium text-gray-500 dark:text-gray-400">
                  Who&apos;s in
                </h2>
                <div className="rounded-3xl bg-gray-50 px-4 py-2 dark:bg-gray-800">
                  {ev.viewer_confirmed || ev.confirmed_names.length > 0 ? (
                    <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                      {ev.viewer_confirmed && (
                        <li className="flex items-center gap-3 py-2.5">
                          {/* name=null → the anonymous disc unless a profile
                              photo is set (the /info members-list convention
                              for the viewer's own row). */}
                          <InitialBubble name={null} imageUrl={myImageUrl} sizeClassName="w-8 h-8" />
                          <span className="text-gray-900 dark:text-gray-100">You</span>
                        </li>
                      )}
                      {ev.confirmed_names.map((n, i) => (
                        <li key={`${n}#${i}`} className="flex items-center gap-3 py-2.5">
                          <InitialBubble name={n} sizeClassName="w-8 h-8" />
                          <span className="text-gray-900 dark:text-gray-100">{n}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="py-2.5 text-gray-500 dark:text-gray-400">No one has confirmed yet.</p>
                  )}
                </div>
              </section>

              {/* The viewer's own who-with condition (read-only). */}
              {condition && (
                <section className="mt-6">
                  <h2 className="mb-2 px-1 text-[17.5px] font-medium text-gray-500 dark:text-gray-400">
                    Your conditions
                  </h2>
                  <div className="rounded-3xl bg-gray-50 px-4 dark:bg-gray-800">
                    <div className="divide-y divide-gray-200 dark:divide-gray-700 text-base">
                      <div className="flex min-h-12 items-center justify-between gap-3 py-2">
                        <span className="shrink-0">With</span>
                        <RefPills refs={withRefs} empty="Anyone" />
                      </div>
                      <div className="flex h-12 items-center justify-between gap-3">
                        <span>At Least</span>
                        <span className="text-gray-500 dark:text-gray-500">{partyCountLabel(minPeople)}</span>
                      </div>
                      <div className="flex h-12 items-center justify-between gap-3">
                        <span>No More Than</span>
                        <span className="text-gray-500 dark:text-gray-500">
                          {maxPeople ? partyCountLabel(maxPeople) : "—"}
                        </span>
                      </div>
                      <div className="flex min-h-12 items-center justify-between gap-3 py-2">
                        <span className="shrink-0">Without</span>
                        <RefPills refs={withoutRefs} empty="—" />
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {/* The action: Back Out lives HERE, not on the playlist card. */}
              <div className="mt-8">
                {ev.viewer_confirmed ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirmingBackOut(true)}
                    className="w-full rounded-2xl bg-red-50 py-3 font-medium text-red-600 transition active:bg-red-100 disabled:opacity-50 dark:bg-red-900/30 dark:text-red-400 dark:active:bg-red-900/50"
                  >
                    Back Out
                  </button>
                ) : ev.can_confirm ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void setConfirmed(true)}
                    className="w-full rounded-2xl bg-blue-600 py-3 font-medium text-white transition active:bg-blue-700 disabled:opacity-50"
                  >
                    Confirm
                  </button>
                ) : short ? (
                  <div className="w-full rounded-2xl bg-amber-50 py-3 text-center font-medium text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                    Needs {ev.needed} more {ev.needed === 1 ? "person" : "people"} — share the
                    activity to make it happen
                  </div>
                ) : (
                  <div className="w-full rounded-2xl bg-gray-100 py-3 text-center font-medium text-gray-400 dark:bg-gray-800 dark:text-gray-500">
                    Full — someone would be left out if you joined
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Backing out affects everyone counting on the event — confirm first. */}
      <ConfirmationModal
        isOpen={confirmingBackOut}
        message={`Back out of ${ev?.activity ?? "this event"}? The others will see you've left.`}
        confirmText="Back Out"
        confirmButtonClass="bg-red-600 hover:bg-red-700 text-white"
        onConfirm={() => {
          setConfirmingBackOut(false);
          void setConfirmed(false);
        }}
        onCancel={() => setConfirmingBackOut(false)}
      />
    </>
  );
}

export default function EventPage() {
  // useSearchParams needs a Suspense boundary in the app router.
  return (
    <Suspense fallback={null}>
      <EventPageInner />
    </Suspense>
  );
}
