/**
 * Shared infrastructure for the lib/api/* modules: endpoint resolution,
 * fetch wrappers, response→Poll/Multipoll/PollResults mappers, and the
 * coalesced-fetch helper. Underscore-prefixed because consumers should
 * import from lib/api/<domain>.ts (or the index) instead of reaching in
 * here directly.
 */

import type { Multipoll, Poll, PollResults } from "@/lib/types";
import { branchToSlug } from "@/lib/slug";

// API URL resolution:
// - NEXT_PUBLIC_API_URL overrides everything
// - Server-side: absolute URLs (no browser privacy concerns in SSR)
// - Client-side: relative /api/polls path, proxied by Next.js rewrites
//   (keeps requests same-origin, avoiding Safari ITP warnings)
export function getApiEndpoint(endpoint: string): string {
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL.replace(/\/api\/polls\/?$/, `/api/${endpoint}`);
  }
  if (typeof window === 'undefined') {
    if (process.env.NODE_ENV !== 'production') {
      return `http://localhost:8000/api/${endpoint}`;
    }
    const branch = process.env.NEXT_PUBLIC_VERCEL_GIT_BRANCH || process.env.VERCEL_GIT_COMMIT_REF;
    if (branch && branch !== 'main' && branch !== 'master') {
      const slug = branchToSlug(branch);
      return `https://${slug}.api.whoeverwants.com/api/${endpoint}`;
    }
    return `https://api.whoeverwants.com/api/${endpoint}`;
  }
  return `/api/${endpoint}`;
}

export const API_BASE = getApiEndpoint('polls');
export const MULTIPOLL_BASE = getApiEndpoint('multipolls');
export const SEARCH_BASE = getApiEndpoint('search');

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function fetchWithBase<T>(base: string, path: string, options?: RequestInit): Promise<T> {
  const url = `${base}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || detail;
    } catch {
      // ignore parse errors
    }
    throw new ApiError(res.status, detail);
  }

  return res.json();
}

export function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  return fetchWithBase<T>(API_BASE, path, options);
}

export function multipollFetch<T>(path: string, options?: RequestInit): Promise<T> {
  return fetchWithBase<T>(MULTIPOLL_BASE, path, options);
}

/**
 * Deduplicate concurrent identical fetches using an in-flight Map.
 * Returns the cached value if present, otherwise starts (or joins) a fetch
 * and stores the result. Needed because React StrictMode double-mounts
 * effects in dev, causing two simultaneous calls to the same endpoint.
 */
export async function coalesced<T>(
  map: Map<string, Promise<T>>,
  key: string,
  cached: T | null,
  fetcher: () => Promise<T>,
): Promise<T> {
  if (cached !== null) return cached;
  const existing = map.get(key);
  if (existing) return existing;
  const promise = (async () => {
    try {
      return await fetcher();
    } finally {
      map.delete(key);
    }
  })();
  map.set(key, promise);
  return promise;
}

// --- Response → domain type mappers ---

export interface ApiRankedChoiceRound {
  round_number: number;
  option_name: string;
  vote_count: number;
  is_eliminated: boolean;
  borda_score: number | null;
  tie_broken_by_borda: boolean;
}

export type Results = PollResults & { ranked_choice_rounds?: ApiRankedChoiceRound[]; ranked_choice_winner?: string };

export function toPoll(data: any): Poll {
  // Phase 5b: wrapper-level fields (response_deadline, creator_secret,
  // creator_name, is_closed, close_reason, short_id, thread_title,
  // suggestion_deadline) are sourced from the parent Multipoll. The FE
  // consumes them via getMultipollForPoll() / Multipoll-typed props.
  return {
    id: data.id,
    title: data.title,
    poll_type: data.poll_type,
    options: data.options ?? undefined,
    created_at: data.created_at,
    updated_at: data.updated_at,
    multipoll_follow_up_to: data.multipoll_follow_up_to ?? null,
    suggestion_deadline_minutes: data.suggestion_deadline_minutes ?? undefined,
    allow_pre_ranking: data.allow_pre_ranking ?? true,
    details: data.details ?? undefined,
    day_time_windows: data.day_time_windows ?? undefined,
    duration_window: data.duration_window ?? undefined,
    category: data.category ?? undefined,
    options_metadata: data.options_metadata ?? undefined,
    reference_latitude: data.reference_latitude ?? undefined,
    reference_longitude: data.reference_longitude ?? undefined,
    reference_location_label: data.reference_location_label ?? undefined,
    min_responses: data.min_responses ?? undefined,
    show_preliminary_results: data.show_preliminary_results ?? true,
    response_count: data.response_count ?? undefined,
    min_availability_percent: data.min_availability_percent ?? undefined,
    multipoll_id: data.multipoll_id ?? null,
    sub_poll_index: data.sub_poll_index ?? null,
    voter_names: data.voter_names ?? undefined,
  };
}

export function toPollResults(data: any): Results {
  return {
    poll_id: data.poll_id,
    title: data.title,
    poll_type: data.poll_type,
    created_at: data.created_at,
    response_deadline: data.response_deadline ?? undefined,
    options: data.options ?? undefined,
    yes_count: data.yes_count ?? undefined,
    no_count: data.no_count ?? undefined,
    abstain_count: data.abstain_count ?? undefined,
    total_votes: data.total_votes,
    yes_percentage: data.yes_percentage ?? undefined,
    no_percentage: data.no_percentage ?? undefined,
    winner: data.winner ?? undefined,
    suggestion_counts: data.suggestion_counts ?? undefined,
    ranked_choice_rounds: data.ranked_choice_rounds ?? undefined,
    ranked_choice_winner: data.ranked_choice_winner ?? undefined,
    availability_counts: data.availability_counts ?? undefined,
    max_availability: data.max_availability ?? undefined,
    included_slots: data.included_slots ?? undefined,
    like_counts: data.like_counts ?? undefined,
    dislike_counts: data.dislike_counts ?? undefined,
  };
}

export function toMultipoll(data: any): Multipoll {
  return {
    id: data.id,
    short_id: data.short_id ?? null,
    creator_secret: data.creator_secret ?? null,
    creator_name: data.creator_name ?? null,
    response_deadline: data.response_deadline ?? null,
    prephase_deadline: data.prephase_deadline ?? null,
    prephase_deadline_minutes: data.prephase_deadline_minutes ?? null,
    is_closed: data.is_closed ?? false,
    close_reason: data.close_reason ?? null,
    follow_up_to: data.follow_up_to ?? null,
    thread_title: data.thread_title ?? null,
    context: data.context ?? null,
    title: data.title,
    created_at: data.created_at,
    updated_at: data.updated_at,
    sub_polls: Array.isArray(data.sub_polls) ? data.sub_polls.map(toPoll) : [],
    voter_names: Array.isArray(data.voter_names) ? data.voter_names : [],
    anonymous_count: typeof data.anonymous_count === 'number' ? data.anonymous_count : 0,
  };
}
