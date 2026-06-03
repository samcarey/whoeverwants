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
import { clearSession, getSessionToken } from "@/lib/session";

// Production browser builds bypass Next.js' `/api/*` rewrites and hit the
// FastAPI origin directly — Vercel's edge proxy (May 2026) fails the TLS
// handshake against LE post-Generation-Y intermediates (E8, R12, ...) on
// ~5-10% of US POPs, returning ROUTER_EXTERNAL_TARGET_HANDSHAKE_ERROR.
// Going cross-origin sidesteps the broken hop. CORS is fine: FastAPI runs
// allow_origins=["*"] + allow_credentials=False, and X-Browser-Id is a
// header (not a cookie) so there's no credentialed-preflight mode to
// negotiate. Dev mode keeps the relative URL so the Mac dev server's
// rewrite to the in-container FastAPI continues to work — Vercel isn't
// in the dev path. Captured at module load: `typeof window` and
// `window.location.hostname` are stable for the bundle's lifetime
// (server bundle vs client bundle each get their own value).
function isBranchPreviewRef(branch: string | null | undefined): boolean {
  return !!branch && branch !== 'main' && branch !== 'production';
}

function computeApiOrigin(): string {
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL.replace(/\/api\/questions\/?$/, '');
  }
  if (typeof window === 'undefined') {
    if (process.env.NODE_ENV !== 'production') {
      return 'http://localhost:8000';
    }
    const branch = process.env.NEXT_PUBLIC_VERCEL_GIT_BRANCH || process.env.VERCEL_GIT_COMMIT_REF;
    return isBranchPreviewRef(branch)
      ? `https://${branchToSlug(branch!)}.api.whoeverwants.com`
      : 'https://api.whoeverwants.com';
  }
  if (process.env.NODE_ENV !== 'production') {
    // Mac dev server: relative URL → Next.js rewrite to the in-container API.
    return '';
  }
  // Vercel-built browser bundle; host-conditional like the legacy rewrites.
  const host = window.location.hostname;
  if (host === 'latest.whoeverwants.com') {
    return 'https://api.latest.whoeverwants.com';
  }
  const branch = process.env.NEXT_PUBLIC_VERCEL_GIT_BRANCH;
  return isBranchPreviewRef(branch)
    ? `https://${branchToSlug(branch!)}.api.whoeverwants.com`
    : 'https://api.whoeverwants.com';
}

export const API_ORIGIN = computeApiOrigin();

export function getApiEndpoint(endpoint: string): string {
  return `${API_ORIGIN}/api/${endpoint}`;
}

export const API_BASE = getApiEndpoint('questions');
export const POLL_BASE = getApiEndpoint('polls');
export const GROUP_BASE = getApiEndpoint('groups');
export const USER_BASE = getApiEndpoint('users');
export const SEARCH_BASE = getApiEndpoint('search');
export const NOTIFICATIONS_BASE = getApiEndpoint('notifications');
export const AUTH_BASE = getApiEndpoint('auth');

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
  // Phase A: attach the session bearer token (if signed in). The server's
  // IdentityMiddleware resolves it to a user_id on every request.
  const sessionToken = getSessionToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string> | undefined),
  };
  if (browserId) headers[BROWSER_ID_HEADER] = browserId;
  if (sessionToken) headers['Authorization'] = `Bearer ${sessionToken}`;

  const res = await fetch(url, {
    ...options,
    headers,
  });

  // Adopt the server-issued id BEFORE error-throwing — even 4xx/5xx
  // responses carry the header, and capturing it on the very first request
  // means subsequent retries already have an id.
  adoptServerBrowserId(res.headers.get(BROWSER_ID_HEADER));

  if (!res.ok) {
    // Phase A: a 401 with a session token attached means the server
    // says the token is no longer valid (revoked / expired / user
    // deleted). Drop local session state so the FE stops attaching the
    // dead token to every subsequent request. The sign-in surface will
    // re-fetch and show the user as signed out.
    if (res.status === 401 && sessionToken) {
      clearSession();
    }
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || detail;
    } catch {
      // ignore parse errors
    }
    throw new ApiError(res.status, detail);
  }

  // 204 No Content (sign-out, delete-passkey, delete-account) has an
  // empty body — calling res.json() on it throws "Unexpected end of JSON
  // input". Return undefined for void callers instead.
  if (res.status === 204) {
    return undefined as T;
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

export function authFetch<T>(path: string, options?: RequestInit): Promise<T> {
  return fetchWithBase<T>(AUTH_BASE, path, options);
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
  // Phase 5b: wrapper-level fields (response_deadline,
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
    category_icon: data.category_icon ?? undefined,
    options_metadata: data.options_metadata ?? undefined,
    reference_latitude: data.reference_latitude ?? undefined,
    reference_longitude: data.reference_longitude ?? undefined,
    reference_location_label: data.reference_location_label ?? undefined,
    response_count: data.response_count ?? undefined,
    min_availability_percent: data.min_availability_percent ?? undefined,
    time_min_participants: data.time_min_participants ?? undefined,
    exclusion_tolerance: data.exclusion_tolerance ?? undefined,
    supply_count: data.supply_count ?? undefined,
    reveal_claimant_names: data.reveal_claimant_names ?? undefined,
    winner_method: data.winner_method ?? undefined,
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
    consensus_winner: data.consensus_winner ?? undefined,
    winner_method: data.winner_method ?? undefined,
    borda_scores: data.borda_scores ?? undefined,
    availability_counts: data.availability_counts ?? undefined,
    max_availability: data.max_availability ?? undefined,
    availability_respondents: data.availability_respondents ?? undefined,
    included_slots: data.included_slots ?? undefined,
    like_counts: data.like_counts ?? undefined,
    dislike_counts: data.dislike_counts ?? undefined,
    time_event_cancelled: data.time_event_cancelled ?? undefined,
    supply_count: data.supply_count ?? undefined,
    secured_count: data.secured_count ?? undefined,
    waitlist_count: data.waitlist_count ?? undefined,
    claims: data.claims ?? undefined,
    names_hidden: data.names_hidden ?? undefined,
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
    creator_name: data.creator_name ?? null,
    creator_user_id: data.creator_user_id ?? null,
    viewer_is_creator: data.viewer_is_creator ?? false,
    viewer_follow_state: data.viewer_follow_state === "old" ? "old" : "new",
    response_deadline: data.response_deadline ?? null,
    prephase_deadline: data.prephase_deadline ?? null,
    prephase_deadline_minutes: data.prephase_deadline_minutes ?? null,
    is_closed: data.is_closed ?? false,
    close_reason: data.close_reason ?? null,
    group_title: data.group_title ?? null,
    group_image_updated_at: data.group_image_updated_at ?? null,
    // Migration 114 (Phase E): group-level privacy + creator user_id
    // surfaced per poll so the FE can render the badge + creator-only
    // toggle without an extra fetch. Tolerates absence on synthesized
    // placeholder polls and pre-Phase-E cached polls.
    group_privacy: data.group_privacy ?? null,
    group_creator_user_id: data.group_creator_user_id ?? null,
    context: data.context ?? null,
    details: data.details ?? null,
    title: data.title,
    created_at: data.created_at,
    updated_at: data.updated_at,
    min_responses: data.min_responses ?? undefined,
    show_preliminary_results: data.show_preliminary_results ?? true,
    allow_pre_ranking: data.allow_pre_ranking ?? true,
    allow_plus_ones: data.allow_plus_ones ?? false,
    questions: Array.isArray(data.questions) ? data.questions.map(toQuestion) : [],
    voter_names: Array.isArray(data.voter_names) ? data.voter_names : [],
    anonymous_count: typeof data.anonymous_count === 'number' ? data.anonymous_count : 0,
    voter_name_counts:
      data.voter_name_counts && typeof data.voter_name_counts === 'object'
        ? (data.voter_name_counts as Record<string, number>)
        : undefined,
    viewed_ignored_count: typeof data.viewed_ignored_count === 'number' ? data.viewed_ignored_count : 0,
    viewed_total: typeof data.viewed_total === 'number' ? data.viewed_total : 0,
    suggestion_count: typeof data.suggestion_count === 'number' ? data.suggestion_count : 0,
  };
}
