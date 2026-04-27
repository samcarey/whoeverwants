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
  options?: string[] | null;
  options_metadata?: OptionsMetadata | null;
  context?: string | null;
  suggestion_deadline_minutes?: number | null;
  allow_pre_ranking?: boolean;
  min_responses?: number | null;
  show_preliminary_results?: boolean;
  min_availability_percent?: number;
  day_time_windows?: any[] | null;
  duration_window?: any | null;
  reference_latitude?: number | null;
  reference_longitude?: number | null;
  reference_location_label?: string | null;
  is_auto_title?: boolean;
}

export interface CreatePollParams {
  creator_secret: string;
  creator_name?: string | null;
  response_deadline?: string | null;
  prephase_deadline?: string | null;
  prephase_deadline_minutes?: number | null;
  follow_up_to?: string | null;
  thread_title?: string | null;
  context?: string | null;
  title?: string | null;
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

// Poll-level operations: close/reopen/cutoff the wrapper + every question
// atomically. Each helper invalidates the poll cache (which cascades to
// every question) and the accessible-questions cache so the next read reflects
// the mutation.
async function pollOperation(
  pollId: string,
  path: 'close' | 'reopen' | 'cutoff-suggestions' | 'cutoff-availability',
  body: Record<string, unknown>,
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
  creatorSecret: string,
  closeReason: string = 'manual',
): Promise<Poll> {
  return pollOperation(pollId, 'close', {
    creator_secret: creatorSecret,
    close_reason: closeReason,
  });
}

export async function apiReopenPoll(
  pollId: string,
  creatorSecret: string,
): Promise<Poll> {
  return pollOperation(pollId, 'reopen', { creator_secret: creatorSecret });
}

export async function apiCutoffPollSuggestions(
  pollId: string,
  creatorSecret: string,
): Promise<Poll> {
  return pollOperation(pollId, 'cutoff-suggestions', { creator_secret: creatorSecret });
}

export async function apiCutoffPollAvailability(
  pollId: string,
  creatorSecret: string,
): Promise<Poll> {
  return pollOperation(pollId, 'cutoff-availability', { creator_secret: creatorSecret });
}

/** Update (or clear) a poll's thread_title override. Empty string clears it. */
export async function apiUpdatePollThreadTitle(pollId: string, threadTitle: string | null): Promise<Poll> {
  const data = await pollFetch<any>(`/${encodeURIComponent(pollId)}/thread-title`, {
    method: 'POST',
    body: JSON.stringify({ thread_title: threadTitle }),
  });
  const poll = toPoll(data);
  invalidatePoll(pollId);
  cachePoll(poll);
  return poll;
}
