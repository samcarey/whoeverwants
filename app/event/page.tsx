"use client";

/**
 * The event's own page — tapped through from a playlist event card
 * (`/event?day=YYYY-MM-DD&activity=Name[&id=<party uuid>]`). Shows the full
 * gathering: title @ time with the status pill, a "Based on your interest ›"
 * link under the title (opens the layout-level activity edit sheet for the
 * slot activity behind this event — conditions live there), and everyone
 * wanting to go (You + each confirmed person). The action sits right under
 * the title block (above "Who's in") and is where cancelling lives: "Back
 * Out" when confirmed (the playlist card deliberately has no cancel),
 * "Confirm" when joinable, a dead "Full" otherwise.
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
import AccountGateModal from "@/components/AccountGateModal";
import ConfirmationModal from "@/components/ConfirmationModal";
import EventPollCard from "@/components/EventPollCard";
import EventPreferenceModal from "@/components/EventPreferenceModal";
import InitialBubble from "@/components/InitialBubble";
import PollComments, { type CommentsApi } from "@/components/PollComments";
import { eventStartIso } from "@/components/SlotCard";
import { useMyUserImageUrl } from "@/lib/useMyUserImageUrl";
import { haptic } from "@/lib/haptics";
import { isValidUserName } from "@/lib/nameValidation";
import { getUserName } from "@/lib/userProfile";
import { openSlotSheet, SLOTS_CHANGED_EVENT } from "@/lib/slotEvents";
import {
  apiCreateEventComment,
  apiDeleteEventComment,
  apiGetEventComments,
  apiGetSlotEvents,
  apiListSlots,
  apiSetEventConfirmation,
  apiToggleEventCommentReaction,
  apiUpdateEventComment,
  getCachedSlotEvents,
  getCachedSlots,
  type Slot,
  type SlotEvent,
} from "@/lib/api/slots";
import { getRelativeDayLabel } from "@/lib/timeUtils";
import { slotRowEntryForEvent, slotWindowEntries } from "@/lib/slotUtils";

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
  // Which expandable poll card is open (one at a time; null = all collapsed).
  const [expandedPoll, setExpandedPoll] = useState<string | null>(null);
  // Name gate for voting/commenting (the poll detail page's AccountGateModal
  // pattern): the retry closure is stashed and replayed after the modal.
  const [pendingNameRetry, setPendingNameRetry] = useState<(() => void) | null>(null);
  const gateOnName = useCallback((retry: () => void): boolean => {
    if (isValidUserName(getUserName())) return true;
    setPendingNameRetry(() => retry);
    return false;
  }, []);

  // The event's comment thread (migration 157) — the poll-comments component
  // over the event-keyed backend. Memoized: the adapter keys the component's
  // refresh loop.
  const commentsApi = useMemo<CommentsApi>(
    () => ({
      list: () => apiGetEventComments(day, activity),
      create: (name, body) => apiCreateEventComment(day, activity, name, body),
      update: (commentId, body) => apiUpdateEventComment(commentId, body),
      remove: (commentId) => apiDeleteEventComment(commentId),
      toggleReaction: (commentId, emoji) =>
        apiToggleEventCommentReaction(commentId, emoji),
    }),
    [day, activity],
  );

  const refresh = useCallback(async (): Promise<SlotEvent[] | null> => {
    try {
      const next = await apiGetSlotEvents();
      setEvents(next);
      return next;
    } catch {
      // Keep the last-known list; the next tick retries.
      return null;
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

  // The slot activity behind this event (the viewer's own tag of it on this
  // day) — "Based on your interest ›" opens the activity edit sheet on it,
  // which is where the who-with conditions live.
  const interest = useMemo(() => {
    for (const slot of slots ?? []) {
      if (!slot.day_time_windows?.some((d) => d.day === day)) continue;
      const index = slot.activities.findIndex((x) => x.name.trim().toLowerCase() === key);
      if (index >= 0) return { slot, index };
    }
    return null;
  }, [slots, day, key]);

  // An edit in the activity sheet (renamed activity, changed conditions) can
  // reshape this event — refresh both feeds when the sheet saves.
  useEffect(() => {
    const onChanged = () => {
      void refresh();
      apiListSlots().then(setSlots).catch(() => {});
    };
    window.addEventListener(SLOTS_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(SLOTS_CHANGED_EVENT, onChanged);
  }, [refresh]);

  // Confirming into a slot that already holds another confirmed event opens
  // the preference modal: the time ranges + whether they overlap, then the
  // drag-to-order step ("in case the top one doesn't happen"; & = both).
  const [prefConflict, setPrefConflict] = useState<{ day: string; events: SlotEvent[] } | null>(
    null,
  );

  const setConfirmed = useCallback(
    async (confirmed: boolean) => {
      if (!ev || busy) return;
      haptic.medium();
      setBusy(true);
      let ok = true;
      try {
        await apiSetEventConfirmation(ev.day, ev.activity, confirmed, ev.id);
      } catch {
        // The refetch below surfaces the true state (e.g. a Full race).
        ok = false;
      }
      const fresh = await refresh();
      setBusy(false);
      if (!confirmed || !ok || !fresh) return;
      // Did this confirm land in a slot that already holds another confirmed
      // event? "Same slot" mirrors the playlist's event→row rule
      // (slotRowEntryForEvent); with no slot rows loaded it degrades to
      // same-day, which is a superset the intro's overlap verdict explains.
      const mine = fresh.find(
        (e) => e.day === day && e.activity.trim().toLowerCase() === key && e.viewer_confirmed,
      );
      if (!mine) return;
      const entries = slotWindowEntries(slots ?? []);
      const myRowKey = slotRowEntryForEvent(mine, entries)?.key ?? null;
      const sameSlot = fresh.filter(
        (e) =>
          e !== mine &&
          e.viewer_confirmed &&
          e.day === mine.day &&
          (myRowKey === null || slotRowEntryForEvent(e, entries)?.key === myRowKey),
      );
      if (sameSlot.length > 0) {
        setPrefConflict({ day: mine.day, events: [mine, ...sameSlot] });
      }
    },
    [ev, busy, refresh, day, key, slots],
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
          style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 2.25rem)", paddingBottom: "1.5rem" }}
        >
          {!ev ? (
            <div className="py-16 text-center text-gray-500 dark:text-gray-400">
              {activity ? "This event is gone — the slots behind it changed." : "Event not found."}
            </div>
          ) : (
            <>
              {/* Title block: emoji + activity, the day, @ time, status. */}
              <div className="flex flex-col items-center gap-1 text-center">
                <div className="text-5xl leading-none">{ev.emoji ?? "📅"}</div>
                <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{ev.activity}</h1>
                {/* Right under the title: the slot activity this proposal
                    grew from; conditions (With / At Least / Without…) are
                    edited there. */}
                {interest && (
                  <button
                    type="button"
                    onClick={() => openSlotSheet(interest.slot, "activity", interest.index)}
                    className="flex items-center gap-0.5 text-sm text-gray-500 dark:text-gray-400 active:opacity-70"
                  >
                    Based on your interest
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                )}
                <p className="text-gray-500 dark:text-gray-400">
                  <span className="text-blue-600 dark:text-blue-400">{getRelativeDayLabel(ev.day)}</span>{" "}
                  · {fmtDate(ev.day)}
                  {ev.time && <> · {fmtClock(ev.time)}</>}
                </p>
                {statusPill}
              </div>

              {/* The action lives right under the title block (Back Out when
                  confirmed — the playlist card deliberately has no cancel). */}
              <div className="mt-2.5">
                {ev.viewer_confirmed ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirmingBackOut(true)}
                    className="w-full rounded-2xl bg-red-50 py-2.5 font-medium text-red-600 transition active:bg-red-100 disabled:opacity-50 dark:bg-red-900/30 dark:text-red-400 dark:active:bg-red-900/50"
                  >
                    Back Out
                  </button>
                ) : ev.can_confirm ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void setConfirmed(true)}
                    className="w-full rounded-2xl bg-blue-600 py-2.5 font-medium text-white transition active:bg-blue-700 disabled:opacity-50"
                  >
                    Confirm
                  </button>
                ) : short ? (
                  <div className="w-full rounded-2xl bg-amber-50 py-2.5 text-center font-medium text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                    Needs {ev.needed} more {ev.needed === 1 ? "person" : "people"} — share the
                    activity to make it happen
                  </div>
                ) : (
                  <div className="w-full rounded-2xl bg-gray-100 py-2.5 text-center font-medium text-gray-400 dark:bg-gray-800 dark:text-gray-500">
                    Full — someone would be left out if you joined
                  </div>
                )}
              </div>

              {/* The gathering's polls (started from attached activity
                  drafts). Each poll is its own card with the ballot INLINE:
                  two-option polls vote in one tap; bigger ballots expand
                  (one at a time) into the drag-to-rank interface. */}
              {ev.poll && ev.poll.group_short_id && ev.poll.poll_short_id && (
                <section className="mt-4">
                  <h2 className="mb-1 px-1 text-[17.5px] font-medium text-gray-500 dark:text-gray-400">
                    Polls
                  </h2>
                  <div className="space-y-2">
                    {[ev.poll].map((p) => (
                      <EventPollCard
                        key={p.poll_short_id}
                        pollRef={p}
                        eventIso={eventStartIso(ev)}
                        expanded={expandedPoll === p.poll_short_id}
                        onToggleExpand={() =>
                          setExpandedPoll((cur) =>
                            cur === p.poll_short_id ? null : p.poll_short_id,
                          )
                        }
                        gateOnName={gateOnName}
                        onOpenPoll={() =>
                          navigateWithTransition(
                            router,
                            `/g/${p.group_short_id}/p/${p.poll_short_id}`,
                            "forward",
                          )
                        }
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* Everyone wanting to go. */}
              <section className="mt-4">
                <h2 className="mb-1 px-1 text-[17.5px] font-medium text-gray-500 dark:text-gray-400">
                  Who&apos;s in
                </h2>
                <div className="rounded-3xl bg-gray-50 px-4 py-1.5 dark:bg-gray-800">
                  {ev.viewer_confirmed || ev.confirmed_names.length > 0 ? (
                    <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                      {ev.viewer_confirmed && (
                        <li className="flex items-center gap-3 py-1.5">
                          {/* name=null → the anonymous disc unless a profile
                              photo is set (the /info members-list convention
                              for the viewer's own row). */}
                          <InitialBubble name={null} imageUrl={myImageUrl} sizeClassName="w-8 h-8" />
                          <span className="text-gray-900 dark:text-gray-100">You</span>
                        </li>
                      )}
                      {ev.confirmed_names.map((n, i) => (
                        <li key={`${n}#${i}`} className="flex items-center gap-3 py-1.5">
                          <InitialBubble name={n} sizeClassName="w-8 h-8" />
                          <span className="text-gray-900 dark:text-gray-100">{n}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="py-1.5 text-gray-500 dark:text-gray-400">No one has confirmed yet.</p>
                  )}
                </div>
              </section>

              {/* The event's own comment thread (the poll-comments component
                  over the event-keyed backend, migration 157) — candidates
                  only, name-gated like posting anywhere else. */}
              <PollComments api={commentsApi} gateOnName={gateOnName} />
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

      {/* Confirmed into an occupied slot → time ranges + overlap, then the
          drag-to-order fallback chain. */}
      {prefConflict && (
        <EventPreferenceModal
          day={prefConflict.day}
          events={prefConflict.events}
          showIntro
          onClose={() => setPrefConflict(null)}
          onSaved={() => void refresh()}
        />
      )}

      <AccountGateModal
        isOpen={!!pendingNameRetry}
        message="to join in"
        onSubmit={() => {
          const retry = pendingNameRetry;
          setPendingNameRetry(null);
          if (retry) retry();
        }}
        onCancel={() => setPendingNameRetry(null)}
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
