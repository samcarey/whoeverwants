/**
 * Shared infrastructure for the lib/api/* modules: endpoint resolution,
 * fetch wrappers, response→Question/Poll/QuestionResults mappers, and the
 * coalesced-fetch helper. Underscore-prefixed because consumers should
 * import from lib/api/<domain>.ts (or the index) instead of reaching in
 * here directly.
 */

import type { Poll, Question, QuestionResults } from "@/lib/types";
import { branchToSlug } from "@/lib/slug";
import { adoptServerBrowserId, getBrowserId } from "@/lib/browserIdentity";

// API URL resolution:
// - NEXT_PUBLIC_API_URL overrides everything
// - Server-side: absolute URLs (no browser privacy concerns in SSR)
// - Client-side: relative /api/questions path, proxied by Next.js rewrites
//   (keeps requests same-origin, avoiding Safari ITP warnings)
export function getApiEndpoint(endpoint: string): string {
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL.replace(/\/api\/questions\/?$/, `/api/${endpoint}`);
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

export const API_BASE = getApiEndpoint('questions');
export const POLL_BASE = getApiEndpoint('polls');
export const GROUP_BASE = getApiEndpoint('groups');
export const USER_BASE = getApiEndpoint('users');
export const SEARCH_BASE = getApiEndpoint('search');
export const NOTIFICATIONS_BASE = getApiEndpoint('notifications');

const BROWSER_ID_HEADER = 'X-Browser-Id';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function fetchWithBase<T>(base: string, path: string, options?: RequestInit): Promise<T> {
  const url = `${base}${path}`;
  // Phase B.3: attach the browser_id (if known) on the way out, and adopt
  // whatever value the server returns. The header round-trip is the FE↔BE
  // identity handshake that Phase C will hang membership off of.
  const browserId = getBrowserId();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string> | undefined),
  };
  if (browserId) headers[BROWSER_ID_HEADER] = browserId;

  const res = await fetch(url, {
    ...options,
    headers,
  });

  // Adopt the server-issued id BEFORE error-throwing — even 4xx/5xx
  // responses carry the header, and capturing it on the very first request
  // means subsequent retries already have an id.
  adoptServerBrowserId(res.headers.get(BROWSER_ID_HEADER));

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

export function pollFetch<T>(path: string, options?: RequestInit): Promise<T> {
  return fetchWithBase<T>(POLL_BASE, path, options);
}

export function groupFetch<T>(path: string, options?: RequestInit): Promise<T> {
  return fetchWithBase<T>(GROUP_BASE, path, options);
}

export function userFetch<T>(path: string, options?: RequestInit): Promise<T> {
  return fetchWithBase<T>(USER_BASE, path, options);
}

export function notificationsFetch<T>(path: string, options?: RequestInit): Promise<T> {
  return fetchWithBase<T>(NOTIFICATIONS_BASE, path, options);
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

export type Results = QuestionResults & { ranked_choice_rounds?: ApiRankedChoiceRound[]; ranked_choice_winner?: string };

export function toQuestion(data: any): Question {
  // Phase 5b: wrapper-level fields (response_deadline, creator_secret,
  // creator_name, is_closed, close_reason, short_id, group_title,
  // suggestion_deadline) are sourced from the parent Poll. Migration 105
  // also dropped the FE-only `poll_follow_up_to` chain pointer.
  return {
    id: data.id,
    title: data.title,
    question_type: data.question_type,
    options: data.options ?? undefined,
    created_at: data.created_at,
    updated_at: data.updated_at,
    suggestion_deadline_minutes: data.suggestion_deadline_minutes ?? undefined,
    details: data.details ?? undefined,
    day_time_windows: data.day_time_windows ?? undefined,
    duration_window: data.duration_window ?? undefined,
    category: data.category ?? undefined,
    options_metadata: data.options_metadata ?? undefined,
    reference_latitude: data.reference_latitude ?? undefined,
    reference_longitude: data.reference_longitude ?? undefined,
    reference_location_label: data.reference_location_label ?? undefined,
    response_count: data.response_count ?? undefined,
    min_availability_percent: data.min_availability_percent ?? undefined,
    is_auto_title: data.is_auto_title ?? undefined,
    poll_id: data.poll_id ?? null,
    question_index: data.question_index ?? null,
    voter_names: data.voter_names ?? undefined,
  };
}

export function toQuestionResults(data: any): Results {
  return {
    question_id: data.question_id,
    title: data.title,
    question_type: data.question_type,
    created_at: data.created_at,
    response_deadline: data.response_deadline ?? undefined,
    options: data.options ?? undefined,
    options_are_tentative: data.options_are_tentative ?? false,
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

export function toPoll(data: any): Poll {
  return {
    id: data.id,
    short_id: data.short_id ?? null,
    // Phase B.4 + Migration 105: every poll carries its group's id +
    // short_id and the group-level title override (sourced from
    // groups.title server-side). Tolerates absence (synthesized
    // placeholder polls and pre-Phase-B.4 cached polls don't have these
    // fields).
    group_id: data.group_id ?? null,
    group_short_id: data.group_short_id ?? null,
    creator_secret: data.creator_secret ?? null,
    creator_name: data.creator_name ?? null,
    response_deadline: data.response_deadline ?? null,
    prephase_deadline: data.prephase_deadline ?? null,
    prephase_deadline_minutes: data.prephase_deadline_minutes ?? null,
    is_closed: data.is_closed ?? false,
    close_reason: data.close_reason ?? null,
    group_title: data.group_title ?? null,
    group_image_updated_at: data.group_image_updated_at ?? null,
    context: data.context ?? null,
    details: data.details ?? null,
    title: data.title,
    created_at: data.created_at,
    updated_at: data.updated_at,
    min_responses: data.min_responses ?? undefined,
    show_preliminary_results: data.show_preliminary_results ?? true,
    allow_pre_ranking: data.allow_pre_ranking ?? true,
    questions: Array.isArray(data.questions) ? data.questions.map(toQuestion) : [],
    voter_names: Array.isArray(data.voter_names) ? data.voter_names : [],
    anonymous_count: typeof data.anonymous_count === 'number' ? data.anonymous_count : 0,
  };
}
