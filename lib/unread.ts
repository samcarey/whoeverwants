/**
 * Client-side "unread poll" model.
 *
 * The app-icon badge (server `compute_badge_count`, see CLAUDE.md
 * 'App-Icon Badge Model') already computes unread/read state, but it's
 * server-authoritative and async — no good for the gold "unread" bar on a
 * group card, which must clear the instant you open + back out of a poll.
 * This module mirrors the server's two-mode logic client-side so the gold
 * line + home-list emphasis reflect the same read state, with zero round
 * trips.
 *
 * Read rule is controlled by `BadgeSettings`:
 *   - todoMode = false (default, "opening marks read"): a poll is unread when
 *     it has activity you haven't SEEN — new since last view, or (gated by the
 *     re-light toggles) voting opened / results arrived after your last view.
 *     Opening the poll-detail page (`markPollViewed`) clears it.
 *   - todoMode = true ("stay unread until I respond"): a poll is unread while
 *     it's open, votable, and you haven't voted/abstained. Opening it does NOT
 *     clear it — only a response does. Mirrors the server's to-do branch.
 *
 * Cross-device caveat: the "viewed" watermark is per-device localStorage (an
 * `<img>`-free, sync, instant signal). Viewing a poll on device A does NOT
 * clear its gold line on device B until B opens it too. The app-icon badge
 * stays the cross-device-authoritative number (server-computed, account-aware).
 * This matches the app's localStorage-first model (see the "new options
 * banner" cross-device caveat).
 */

import type { Poll } from "@/lib/types";
import type { BadgeSettings } from "@/lib/badgeSettings";
import { useEffect, useState } from "react";
import { getEffectiveBadgeSettings, BADGE_SETTINGS_CHANGED_EVENT } from "@/lib/badgeSettings";
import { SESSION_CHANGED_EVENT } from "@/lib/session";

const VIEWS_KEY = "whoeverwants_poll_views";
const BASELINE_KEY = "whoeverwants_unread_baseline";
const MAX_ENTRIES = 1000;

/** Fired by `markPollViewed` so the gold line + home emphasis re-render. */
export const POLL_VIEWED_CHANGED_EVENT = "whoeverwants:poll-viewed-changed";

// Module caches so the per-poll-per-render reads on a busy group page do a
// single localStorage parse, not one per card. Invalidated only by our own
// writes (markPollViewed), the sole in-process mutation.
let viewsCache: Map<string, number> | null = null;
let baselineCache: number | null = null;

function loadViews(): Map<string, number> {
  if (viewsCache) return viewsCache;
  const m = new Map<string, number>();
  if (typeof window !== "undefined") {
    try {
      const raw = localStorage.getItem(VIEWS_KEY);
      if (raw) {
        const obj = JSON.parse(raw);
        if (obj && typeof obj === "object") {
          for (const [k, v] of Object.entries(obj)) {
            if (typeof v === "number") m.set(k, v);
          }
        }
      }
    } catch {
      // ignore corrupt / unavailable storage
    }
  }
  viewsCache = m;
  return m;
}

function persist(m: Map<string, number>): void {
  if (typeof window === "undefined") return;
  // LRU trim: Map preserves insertion order, so the first key is the oldest.
  while (m.size > MAX_ENTRIES) {
    const oldest = m.keys().next().value;
    if (oldest === undefined) break;
    m.delete(oldest);
  }
  try {
    localStorage.setItem(VIEWS_KEY, JSON.stringify(Object.fromEntries(m)));
  } catch {
    // quota / privacy mode — in-memory cache still serves this session
  }
}

/**
 * The "everything before this moment is considered seen" watermark, set once
 * on this device's first run of the unread feature. Without it, a returning
 * user's first load (empty local view store) would flag EVERY existing poll
 * as unread — gold lines everywhere. With it, pre-existing polls read as
 * "caught up"; only activity after the baseline can light up. Persisted so it
 * survives reloads (a non-persisted baseline would re-mark between-session new
 * polls as already-seen). Lazy-initialized on first read.
 */
export function getUnreadBaseline(): number {
  if (baselineCache !== null) return baselineCache;
  if (typeof window === "undefined") return 0;
  try {
    const raw = localStorage.getItem(BASELINE_KEY);
    if (raw) {
      const n = parseInt(raw, 10);
      if (Number.isFinite(n)) {
        baselineCache = n;
        return n;
      }
    }
  } catch {
    // ignore
  }
  const now = Date.now();
  try {
    localStorage.setItem(BASELINE_KEY, String(now));
  } catch {
    // ignore — baselineCache still pins it for this session
  }
  baselineCache = now;
  return now;
}

/** Record that this browser opened the given poll right now. Fire-and-forget;
 *  safe server-side (no-ops). Dispatches POLL_VIEWED_CHANGED_EVENT. */
export function markPollViewed(pollId: string): void {
  if (typeof window === "undefined" || !pollId) return;
  const m = loadViews();
  m.delete(pollId);
  m.set(pollId, Date.now());
  persist(m);
  try {
    window.dispatchEvent(new CustomEvent(POLL_VIEWED_CHANGED_EVENT));
  } catch {
    // ignore (test env / old browsers)
  }
}

/** Last-viewed timestamp for a poll (0 if never viewed on this device). */
export function getPollViewedAt(pollId: string): number {
  return loadViews().get(pollId) ?? 0;
}

/** Effective "seen" watermark: the later of the per-poll view and the
 *  device's tracking baseline. */
function effectiveViewedAt(pollId: string): number {
  return Math.max(getPollViewedAt(pollId), getUnreadBaseline());
}

/** True iff this browser has a recorded vote OR abstain on any of the poll's
 *  questions. */
export function pollHasResponse(
  poll: Poll,
  voted: Set<string>,
  abstained: Set<string>,
): boolean {
  return poll.questions.some((q) => voted.has(q.id) || abstained.has(q.id));
}

/**
 * Pure unread predicate, mirroring server `compute_badge_count`. Kept pure
 * (takes the already-resolved `lastViewedMs` + `hasResponded`) so it's
 * testable without the localStorage store; `computePollUnread` is the live
 * wrapper components call.
 */
export function isPollUnread(
  poll: Poll,
  opts: {
    settings: BadgeSettings;
    lastViewedMs: number;
    hasResponded: boolean;
    nowMs: number;
  },
): boolean {
  const { settings, lastViewedMs, hasResponded, nowMs } = opts;
  if (settings.todoMode) {
    // Respond-required: open, votable now (prephase passed / none), deadline
    // not passed, and not yet responded. Views are irrelevant in this mode.
    if (poll.is_closed) return false;
    if (poll.response_deadline && new Date(poll.response_deadline).getTime() <= nowMs) {
      return false;
    }
    if (poll.prephase_deadline && new Date(poll.prephase_deadline).getTime() > nowMs) {
      return false;
    }
    return !hasResponded;
  }
  // Opening-marks-read: new since last view, or (gated) a phase transition /
  // close after the last view.
  const createdMs = new Date(poll.created_at).getTime();
  if (lastViewedMs < createdMs) return true;
  if (settings.onVotingOpen && poll.prephase_deadline) {
    const pre = new Date(poll.prephase_deadline).getTime();
    if (pre <= nowMs && lastViewedMs < pre) return true;
  }
  if (settings.onResults && poll.is_closed) {
    const closeMs = new Date(poll.updated_at).getTime();
    if (lastViewedMs < closeMs) return true;
  }
  return false;
}

/**
 * Reactivity for surfaces that render unread state (group cards, home list).
 * Returns the current badge settings + a `pollViewsTick` that bumps whenever a
 * poll is viewed — a bare re-render trigger, since `computePollUnread` reads
 * the localStorage view store directly. Subscribes to settings changes
 * (BADGE_SETTINGS_CHANGED_EVENT + SESSION_CHANGED_EVENT, since account values
 * win when signed in) and view changes (POLL_VIEWED_CHANGED_EVENT).
 */
export function useUnreadReactivity(): { badgeSettings: BadgeSettings; pollViewsTick: number } {
  const [badgeSettings, setBadgeSettings] = useState<BadgeSettings>(() => getEffectiveBadgeSettings());
  const [pollViewsTick, setPollViewsTick] = useState(0);
  useEffect(() => {
    const onSettings = () => setBadgeSettings(getEffectiveBadgeSettings());
    const onViewed = () => setPollViewsTick((t) => t + 1);
    window.addEventListener(BADGE_SETTINGS_CHANGED_EVENT, onSettings);
    window.addEventListener(SESSION_CHANGED_EVENT, onSettings);
    window.addEventListener(POLL_VIEWED_CHANGED_EVENT, onViewed);
    return () => {
      window.removeEventListener(BADGE_SETTINGS_CHANGED_EVENT, onSettings);
      window.removeEventListener(SESSION_CHANGED_EVENT, onSettings);
      window.removeEventListener(POLL_VIEWED_CHANGED_EVENT, onViewed);
    };
  }, []);
  return { badgeSettings, pollViewsTick };
}

/** Live wrapper: reads the local view store + baseline + response state. */
export function computePollUnread(
  poll: Poll,
  settings: BadgeSettings,
  voted: Set<string>,
  abstained: Set<string>,
  nowMs: number = Date.now(),
): boolean {
  return isPollUnread(poll, {
    settings,
    lastViewedMs: effectiveViewedAt(poll.id),
    hasResponded: pollHasResponse(poll, voted, abstained),
    nowMs,
  });
}
