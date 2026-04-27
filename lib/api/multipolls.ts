import type { Multipoll } from "@/lib/types";
import type { OptionsMetadata } from "@/lib/types";
import {
  cacheMultipoll,
  getCachedMultipollById,
  getCachedMultipollByShortId,
  invalidateMultipoll,
} from "@/lib/pollCache";
import { multipollFetch, coalesced, toMultipoll } from "./_internal";

// Mirrors server/routers/multipolls.py. Multipolls wrap one or more sub-polls;
// a 1-sub-poll multipoll renders identically to today's single poll. See
// docs/multipoll-phasing.md.

export type SubPollType = 'yes_no' | 'ranked_choice' | 'time';

export interface CreateSubPollParams {
  poll_type?: SubPollType;
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

export interface CreateMultipollParams {
  creator_secret: string;
  creator_name?: string | null;
  response_deadline?: string | null;
  prephase_deadline?: string | null;
  prephase_deadline_minutes?: number | null;
  follow_up_to?: string | null;
  thread_title?: string | null;
  context?: string | null;
  title?: string | null;
  sub_polls: CreateSubPollParams[];
}

export async function apiCreateMultipoll(params: CreateMultipollParams): Promise<Multipoll> {
  const data = await multipollFetch('', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  const multipoll = toMultipoll(data);
  cacheMultipoll(multipoll);
  return multipoll;
}

const multipollInFlight = new Map<string, Promise<Multipoll>>();

export async function apiGetMultipollByShortId(shortId: string): Promise<Multipoll> {
  return coalesced(
    multipollInFlight,
    `short:${shortId}`,
    getCachedMultipollByShortId(shortId),
    async () => {
      const data = await multipollFetch(`/${encodeURIComponent(shortId)}`);
      const multipoll = toMultipoll(data);
      cacheMultipoll(multipoll);
      return multipoll;
    },
  );
}

export async function apiGetMultipollById(multipollId: string): Promise<Multipoll> {
  return coalesced(
    multipollInFlight,
    `id:${multipollId}`,
    getCachedMultipollById(multipollId),
    async () => {
      const data = await multipollFetch(`/by-id/${encodeURIComponent(multipollId)}`);
      const multipoll = toMultipoll(data);
      cacheMultipoll(multipoll);
      return multipoll;
    },
  );
}

// Multipoll-level operations: close/reopen/cutoff the wrapper + every sub-poll
// atomically. Each helper invalidates the multipoll cache (which cascades to
// every sub-poll) and the accessible-polls cache so the next read reflects
// the mutation.
async function multipollOperation(
  multipollId: string,
  path: 'close' | 'reopen' | 'cutoff-suggestions' | 'cutoff-availability',
  body: Record<string, unknown>,
): Promise<Multipoll> {
  const data = await multipollFetch(`/${encodeURIComponent(multipollId)}/${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const multipoll = toMultipoll(data);
  invalidateMultipoll(multipollId);
  cacheMultipoll(multipoll);
  return multipoll;
}

export async function apiCloseMultipoll(
  multipollId: string,
  creatorSecret: string,
  closeReason: string = 'manual',
): Promise<Multipoll> {
  return multipollOperation(multipollId, 'close', {
    creator_secret: creatorSecret,
    close_reason: closeReason,
  });
}

export async function apiReopenMultipoll(
  multipollId: string,
  creatorSecret: string,
): Promise<Multipoll> {
  return multipollOperation(multipollId, 'reopen', { creator_secret: creatorSecret });
}

export async function apiCutoffMultipollSuggestions(
  multipollId: string,
  creatorSecret: string,
): Promise<Multipoll> {
  return multipollOperation(multipollId, 'cutoff-suggestions', { creator_secret: creatorSecret });
}

export async function apiCutoffMultipollAvailability(
  multipollId: string,
  creatorSecret: string,
): Promise<Multipoll> {
  return multipollOperation(multipollId, 'cutoff-availability', { creator_secret: creatorSecret });
}

/** Update (or clear) a multipoll's thread_title override. Empty string clears it. */
export async function apiUpdateMultipollThreadTitle(multipollId: string, threadTitle: string | null): Promise<Multipoll> {
  const data = await multipollFetch<any>(`/${encodeURIComponent(multipollId)}/thread-title`, {
    method: 'POST',
    body: JSON.stringify({ thread_title: threadTitle }),
  });
  const multipoll = toMultipoll(data);
  invalidateMultipoll(multipollId);
  cacheMultipoll(multipoll);
  return multipoll;
}
