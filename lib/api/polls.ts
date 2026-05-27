import type { Poll } from "@/lib/types";
import type { OptionsMetadata } from "@/lib/types";
import {
  cachePoll,
  getCachedPollById,
  getCachedPollByShortId,
  invalidatePoll,
} from "@/lib/questionCache";
import { pollFetch, coalesced, toPoll } from "./_internal";

// Mirrors server/routers/polls.py. Polls wrap one or more questions;
// a 1-question poll renders identically to today's single question. See
// docs/poll-phasing.md.

export type QuestionType = 'yes_no' | 'ranked_choice' | 'time';

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
  questions: CreateQuestionParams[];
}

export async function apiCreatePoll(params: CreatePollParams): Promise<Poll> {
  const data = await pollFetch('', {
    method: 'POST',
    body: JSON.stringify(params),
  });
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

export async function apiCutoffPollSuggestions(pollId: string): Promise<Poll> {
  return pollOperation(pollId, 'cutoff-suggestions');
}

export async function apiCutoffPollAvailability(pollId: string): Promise<Poll> {
  return pollOperation(pollId, 'cutoff-availability');
}

