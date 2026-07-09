import type { Poll } from "@/lib/types";
import type { OptionsMetadata } from "@/lib/types";
import {
  cachePoll,
  getCachedPollById,
  getCachedPollByShortId,
  invalidatePoll,
  updateAccessiblePollsIfFresh,
} from "@/lib/questionCache";
import { pollFetch, coalesced, toPoll } from "./_internal";
import { setStoredVoteId, setVotedQuestionFlag } from "@/lib/votedQuestionsStorage";

// Mirrors server/routers/polls.py. Polls wrap one or more questions;
// a 1-question poll renders identically to today's single question. See
// docs/poll-phasing.md.

export type QuestionType = 'yes_no' | 'ranked_choice' | 'time' | 'limited_supply' | 'showtime';

export interface CreateQuestionParams {
  question_type?: QuestionType;
  category?: string | null;
  category_icon?: string | null;
  options?: string[] | null;
  options_metadata?: OptionsMetadata | null;
  context?: string | null;
  suggestion_deadline_minutes?: number | null;
  /** Creator's own initial suggestions, submitted as a suggestion-phase vote
   *  at create time when "Collect Suggestions before Vote" is on and options
   *  were typed. See server CreateQuestionRequest.initial_suggestions. */
  initial_suggestions?: string[] | null;
  min_availability_percent?: number;
  /** "Minimum Participants" viability gate for time questions: a slot counts
   *  only if at least this many people are available for it. Default 2. */
  min_participants?: number;
  /** "Attendance Leeway" for time questions: slots within this many attendees
   *  of the best-attended slot still reach the preference phase. Default 0. */
  exclusion_tolerance?: number;
  /** Number of available slots for a limited_supply question (>= 1). */
  supply_count?: number | null;
  /** limited_supply: when false, only the creator sees claimant names. */
  reveal_claimant_names?: boolean;
  /** ranked_choice headline method: 'favorite' (IRV, default) or 'consensus'
   *  (Borda). Ignored for other question types. */
  winner_method?: "favorite" | "consensus";
  day_time_windows?: any[] | null;
  duration_window?: any | null;
  reference_latitude?: number | null;
  reference_longitude?: number | null;
  reference_location_label?: string | null;
  is_auto_title?: boolean;
}

export interface CreatePollParams {
  creator_name?: string | null;
  response_deadline?: string | null;
  prephase_deadline?: string | null;
  prephase_deadline_minutes?: number | null;
  /** Adds the new poll to an existing group. None / omitted → server
   *  mints a fresh group. Migration 105 retired the legacy `follow_up_to`
   *  chain pointer; groups are flat lists keyed by `group_id`. */
  group_id?: string | null;
  /** Sets the group's title override at creation time. For existing
   *  groups, prefer `apiUpdateGroupTitle` instead. */
  group_title?: string | null;
  /** Short single-line — drives the auto-title's "for X" suffix. Maps to polls.context. */
  context?: string | null;
  /** Multi-line description with link support. Maps to polls.details. */
  details?: string | null;
  title?: string | null;
  // Migration 098: poll-level results-display + ranked-choice settings.
  min_responses?: number | null;
  show_preliminary_results?: boolean;
  allow_pre_ranking?: boolean;
  // "Plus one/more": null → server default (ON for time polls, OFF otherwise);
  // true/false is the explicit FE toggle override.
  allow_plus_ones?: boolean | null;
  // Recurrence rule (migration 141). When set, the poll becomes a recurring
  // anchor and the server's cron tick materializes future instances. Shape
  // mirrors lib/recurrence.ts RecurrenceRule + a `start` (YYYY-MM-DD).
  recurrence?: import("@/lib/recurrence").RecurrenceRule | null;
  /** Explore feed (migration 143): when true the server files the poll into
   *  the caller's per-user explore group (minted lazily, privacy='explore')
   *  regardless of `group_id`, so it surfaces only at /explore. */
  explore?: boolean;
  questions: CreateQuestionParams[];
}

export async function apiCreatePoll(params: CreatePollParams): Promise<Poll> {
  const data = await pollFetch('', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  // When the server auto-submitted the creator's initial suggestions (the
  // "Collect Suggestions before Vote" path), it returns the resulting vote ids
  // per question. Record them locally so the creating browser recognizes its
  // own vote — otherwise the creator would see their seeds as unowned and a
  // later edit would spawn a duplicate vote.
  const seededVoteIds = (data as { initial_suggestion_vote_ids?: Record<string, string> | null })
    .initial_suggestion_vote_ids;
  if (seededVoteIds) {
    for (const [questionId, voteId] of Object.entries(seededVoteIds)) {
      setStoredVoteId(questionId, voteId);
      setVotedQuestionFlag(questionId, true);
    }
  }
  const poll = toPoll(data);
  cachePoll(poll);
  return poll;
}

const pollInFlight = new Map<string, Promise<Poll>>();

export async function apiGetPollByShortId(shortId: string): Promise<Poll> {
  return coalesced(
    pollInFlight,
    `short:${shortId}`,
    getCachedPollByShortId(shortId),
    async () => {
      const data = await pollFetch(`/${encodeURIComponent(shortId)}`);
      const poll = toPoll(data);
      cachePoll(poll);
      return poll;
    },
  );
}

export async function apiGetPollById(pollId: string): Promise<Poll> {
  return coalesced(
    pollInFlight,
    `id:${pollId}`,
    getCachedPollById(pollId),
    async () => {
      const data = await pollFetch(`/by-id/${encodeURIComponent(pollId)}`);
      const poll = toPoll(data);
      cachePoll(poll);
      return poll;
    },
  );
}

/** Record that this browser viewed the poll right now (fire-and-forget).
 *  Feeds the phase-transition notification's skip-logic — a member who's
 *  already seen the latest options isn't pinged when voting opens. Only worth
 *  calling while the poll's prephase is still active; the server upsert is a
 *  no-op for unknown poll ids. Best-effort: failures are swallowed because the
 *  watermark is an optimization, not correctness-critical. */
export async function apiRecordPollView(pollId: string): Promise<void> {
  try {
    await pollFetch(`/${encodeURIComponent(pollId)}/viewed`, { method: 'POST' });
  } catch {
    // ignore — the next view (or a vote) re-records the watermark
  }
}

/** Gap 1: set the caller's per-poll follow/ignore state. `'old'` (the ✕) files
 *  the poll in the viewer's Old tab + silences its badge/push; `'new'` (the +)
 *  re-follows it. Per-viewer + reversible; NOT a creator action and orthogonal
 *  to group membership. Throws on failure so the caller can revert its
 *  optimistic update. Patches the cached Poll's `viewer_follow_state` (per-poll
 *  + accessible-polls caches) so home + a back-nav reflect the change without a
 *  round-trip. */
/** Event layer Phase 1: set the calling browser's attendance override on a
 *  decided poll's event. 'out' = "can't make it" (back-out from presumed-in),
 *  'in' = (late) opt-in. No cache patching — event data isn't embedded in the
 *  poll caches; callers refetch via `apiGetPollEvent`. */
export async function apiSetEventAttendance(
  pollId: string,
  status: "in" | "out",
): Promise<void> {
  await pollFetch(`/${encodeURIComponent(pollId)}/attendance`, {
    method: "POST",
    body: JSON.stringify({ status }),
  });
}

export async function apiSetPollFollowState(
  pollId: string,
  state: "new" | "old",
): Promise<void> {
  await pollFetch(`/${encodeURIComponent(pollId)}/follow-state`, {
    method: "POST",
    body: JSON.stringify({ state }),
  });
  const cached = getCachedPollById(pollId);
  if (cached && cached.viewer_follow_state !== state) {
    cachePoll({ ...cached, viewer_follow_state: state });
  }
  updateAccessiblePollsIfFresh((polls) =>
    polls.map((p) =>
      p.id === pollId && p.viewer_follow_state !== state
        ? { ...p, viewer_follow_state: state }
        : p,
    ),
  );
}

// Poll-level operations: close/reopen/cutoff the wrapper + every question
// atomically. Each helper invalidates the poll cache (which cascades to
// every question) and the accessible-questions cache so the next read reflects
// the mutation. Authorization is identity-based server-side (migration 123
// retired the per-browser secret): the caller's session / browser-linked
// account must match the poll's creator_user_id — no secret in the body.
async function pollOperation(
  pollId: string,
  path: 'close' | 'reopen' | 'cutoff-suggestions' | 'cutoff-availability',
  body: Record<string, unknown> = {},
): Promise<Poll> {
  const data = await pollFetch(`/${encodeURIComponent(pollId)}/${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const poll = toPoll(data);
  invalidatePoll(pollId);
  cachePoll(poll);
  return poll;
}

export async function apiClosePoll(
  pollId: string,
  closeReason: string = 'manual',
): Promise<Poll> {
  return pollOperation(pollId, 'close', { close_reason: closeReason });
}

export async function apiReopenPoll(pollId: string): Promise<Poll> {
  return pollOperation(pollId, 'reopen');
}

/**
 * Cancel part of a recurring series (creator only). `scope='occurrence'` drops
 * just the instance on `date`; `scope='series'` drops that instance and every
 * later one. `pollId` may be the anchor or any materialized child — the server
 * resolves to the anchor and returns it. Invalidates every cached poll in the
 * group so the Scheduled list refreshes.
 */
export async function apiCancelRecurrence(
  pollId: string,
  scope: 'occurrence' | 'series',
  date: string,
): Promise<Poll> {
  const data = await pollFetch(`/${encodeURIComponent(pollId)}/recurrence/cancel`, {
    method: 'POST',
    body: JSON.stringify({ scope, date }),
  });
  const poll = toPoll(data);
  invalidatePoll(poll.id);
  cachePoll(poll);
  return poll;
}

export async function apiCutoffPollSuggestions(pollId: string): Promise<Poll> {
  return pollOperation(pollId, 'cutoff-suggestions');
}

export async function apiCutoffPollAvailability(pollId: string): Promise<Poll> {
  return pollOperation(pollId, 'cutoff-availability');
}

