/**
 * User profile (per-browser) API helpers.
 *
 * Mirrors the group image upload pattern from `lib/api/groups.ts`. The
 * server keys profiles by `browser_id` (the per-browser uuid issued by
 * `BrowserIdMiddleware`) so the caller's identity is implicit on the
 * `/me/*` endpoints — they read `request.state.browser_id`.
 *
 * `buildUserImageUrl` is the URL builder for the public `/by-user-id`
 * endpoint, used wherever the FE renders the current user's avatar
 * (across navigations) without going through a fresh fetch. The photo is
 * account data (migration 124): keyed by `user_id`, it follows the user
 * across devices and clears on sign-out.
 */

import type { OptionMetadataEntry } from "@/lib/types";
import { API_ORIGIN, userFetch } from "./_internal";

// Bumped to v2 when the cache shape changed from browser_id to user_id
// (migration 124). A stale v1 entry would parse to user_id=undefined → no
// image until the next /me/profile refresh; the rename avoids even that
// transient miss for existing installs.
const PROFILE_STORAGE_KEY = 'whoeverwants_user_profile_v2';

// Module-level cache: every group/home page mount calls
// `getCachedMyUserProfile` once per `useMyUserImageUrl` instance (i.e.
// once per visible card). Without a cache that's N localStorage reads
// + JSON parses on first paint. The cache is invalidated by every
// write path (cacheMyUserProfile, clearCachedMyUserProfile) since
// they're the only way the value can change in-process. `undefined`
// means "not yet read"; `null` means "no profile stored".
let _profileMemo: UserProfile | null | undefined = undefined;

export interface UserProfile {
  // The account the photo is keyed to. Null when the caller has no
  // account yet (→ no photo possible until they upload one, which mints
  // an account).
  user_id: string | null;
  image_updated_at: string | null;
}

export async function apiGetMyUserProfile(): Promise<UserProfile> {
  const data = await userFetch<any>('/me/profile');
  return {
    user_id: (data.user_id ?? null) as string | null,
    image_updated_at: (data.image_updated_at ?? null) as string | null,
  };
}

/** Recency-ordered poll categories the current browser (+ linked devices)
 *  has created — `group` scoped to the passed group route id, `general`
 *  across all groups. Drives the category bubble bar ordering on group
 *  pages. Pass the current `<body data-group-id>` (the group uuid) as
 *  `groupRouteId`; omit it on the empty `/g/` placeholder. */
export interface PollCategoryHistory {
  group: string[];
  general: string[];
}

export async function apiGetPollCategoryHistory(
  groupRouteId?: string | null,
): Promise<PollCategoryHistory> {
  const qs = groupRouteId ? `?group=${encodeURIComponent(groupRouteId)}` : '';
  const data = await userFetch<any>(`/me/poll-category-history${qs}`);
  return {
    group: Array.isArray(data.group) ? (data.group as string[]) : [],
    general: Array.isArray(data.general) ? (data.general as string[]) : [],
  };
}

/** A previously-referenced option for a category: its display text + optional
 *  rich metadata (favicon / poster / address / rating / coords), so the
 *  autocomplete dropdown can render and re-attach it like a fresh search hit. */
export interface CategoryOptionEntry {
  label: string;
  metadata?: OptionMetadataEntry;
}

/** Options previously referenced (given as ballot options OR suggested) for a
 *  category, most-recent-first. `group` is scoped to the passed group route id;
 *  `general` spans every group the caller can see (group labels excluded). Used
 *  to prime the create-poll autocomplete field before the user types. Drops to
 *  empty lists on any failure (the field must still work). */
export async function apiGetCategoryOptions(
  category: string,
  groupRouteId?: string | null,
): Promise<{ group: CategoryOptionEntry[]; general: CategoryOptionEntry[] }> {
  const params = new URLSearchParams({ category });
  if (groupRouteId) params.set('group', groupRouteId);
  const data = await userFetch<any>(`/me/category-options?${params}`);
  const norm = (arr: any): CategoryOptionEntry[] =>
    Array.isArray(arr)
      ? arr
          .filter((e) => e && typeof e.label === 'string')
          .map((e) => ({
            label: e.label,
            // Server sends metadata: null for entries with none; normalize to
            // undefined to match the optional field type.
            metadata: (e.metadata ?? undefined) as OptionMetadataEntry | undefined,
          }))
      : [];
  return { group: norm(data.group), general: norm(data.general) };
}

/** One AI-predicted poll the caller might create next, as STRUCTURED draft
 *  fields (NOT a title — the FE re-derives the title from these, same as every
 *  poll). `title` is the typed prompt for yes_no / item for limited_supply;
 *  `options` is a fixed ballot list for choice categories; `context` is the
 *  short "for X" subject. */
export interface PollSuggestion {
  category: string;
  title?: string;
  options?: string[];
  context?: string;
}

/** Cached, per-(user, group) AI-predicted next polls for the create-poll box.
 *  Empty until the server has generated them (it does so on poll-create and on
 *  a stale/missing read). Tolerant: returns an empty list on any failure — the
 *  box must still work from its deterministic heuristic suggestions. */
export async function apiGetPollSuggestions(
  groupRouteId?: string | null,
): Promise<{ suggestions: PollSuggestion[]; generatedAt: string | null }> {
  const qs = groupRouteId ? `?group=${encodeURIComponent(groupRouteId)}` : '';
  const data = await userFetch<any>(`/me/poll-suggestions${qs}`);
  const arr = Array.isArray(data.suggestions) ? data.suggestions : [];
  const suggestions: PollSuggestion[] = arr
    .filter((s: any) => s && typeof s.category === 'string')
    .map((s: any) => ({
      category: s.category as string,
      title: typeof s.title === 'string' ? s.title : undefined,
      options: Array.isArray(s.options)
        ? (s.options.filter((o: any) => typeof o === 'string') as string[])
        : undefined,
      context: typeof s.context === 'string' ? s.context : undefined,
    }));
  return {
    suggestions,
    generatedAt: (data.generated_at ?? null) as string | null,
  };
}

/** A group the caller shares with the profiled user. `routeId` builds the
 *  `/g/<routeId>` link; `name` is the group's display name (may be null). */
export interface SharedGroupSummary {
  routeId: string;
  name: string | null;
}

/** The long-press profile modal payload for another user. */
export interface UserProfileCard {
  user_id: string;
  name: string | null;
  image_updated_at: string | null;
  /** ISO timestamp the account was created — drives the "joined X ago" age. */
  created_at: string;
  shared_groups: SharedGroupSummary[];
}

/** Fetch another user's profile card. Throws ApiError(404) when missing. */
export async function apiGetUserProfileCard(
  userId: string,
): Promise<UserProfileCard> {
  const data = await userFetch<any>(`/${encodeURIComponent(userId)}/profile-card`);
  return {
    user_id: data.user_id,
    name: (data.name ?? null) as string | null,
    image_updated_at: (data.image_updated_at ?? null) as string | null,
    created_at: data.created_at,
    shared_groups: Array.isArray(data.shared_groups)
      ? data.shared_groups
          .filter((g: any) => g && typeof g.route_id === 'string')
          .map((g: any) => ({
            routeId: g.route_id as string,
            name: (g.name ?? null) as string | null,
          }))
      : [],
  };
}

/**
 * Remove an account from the caller's address book ("forget" them). Backs
 * the profile modal's Forget button (shown only when no groups are shared —
 * `reconcile_contacts` server-side re-adds anyone you currently share a
 * group with, so forgetting only sticks in that case). Idempotent: the
 * server returns 204 even when no contact row existed.
 */
export async function apiForgetUserContact(userId: string): Promise<void> {
  await userFetch<void>(`/me/contacts/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  });
}

/**
 * Upload a profile image. `creatorName` is used ONLY when the caller has
 * no account yet — it names the lightweight account the server mints to
 * own the photo (ignored when an account already resolves). The FE gates
 * this behind the account-setup modal so a name is present.
 */
export async function apiUploadMyUserImage(
  imageBlob: Blob,
  creatorName?: string | null,
): Promise<UserProfile> {
  const mimeType = imageBlob.type || 'image/jpeg';
  const arrayBuffer = await imageBlob.arrayBuffer();
  const base64 = base64FromArrayBuffer(arrayBuffer);
  const data = await userFetch<any>('/me/image', {
    method: 'POST',
    body: JSON.stringify({
      image_base64: base64,
      mime_type: mimeType,
      creator_name: creatorName?.trim() || null,
    }),
  });
  const result: UserProfile = {
    user_id: (data.user_id ?? null) as string | null,
    image_updated_at: (data.image_updated_at ?? null) as string | null,
  };
  cacheMyUserProfile(result);
  return result;
}

export async function apiDeleteMyUserImage(): Promise<UserProfile> {
  const data = await userFetch<any>('/me/image', { method: 'DELETE' });
  const result: UserProfile = {
    user_id: (data.user_id ?? null) as string | null,
    image_updated_at: null,
  };
  cacheMyUserProfile(result);
  return result;
}

/**
 * Returns `/api/users/by-user-id/<id>/image?v=<isoTimestamp>` or null
 * when either input is missing. The `?v=` query is the cache-buster: a
 * fresh upload bumps `image_updated_at` so the new URL doesn't collide
 * with the previous image's immutable cache entry.
 */
export function buildUserImageUrl(
  userId: string | null | undefined,
  imageUpdatedAt: string | null | undefined,
): string | null {
  if (!userId || !imageUpdatedAt) return null;
  const v = encodeURIComponent(imageUpdatedAt);
  return `${API_ORIGIN}/api/users/by-user-id/${encodeURIComponent(userId)}/image?v=${v}`;
}

function profilesEqual(a: UserProfile | null, b: UserProfile | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.user_id === b.user_id && a.image_updated_at === b.image_updated_at;
}

/**
 * Local cache of the caller's own profile so display surfaces don't
 * have to wait on `apiGetMyUserProfile` after a navigation. Stored in
 * localStorage keyed by browser_id — switching browsers (e.g. fresh
 * incognito) starts with an empty cache and rehydrates on the next
 * `/me/profile` call.
 */
export function cacheMyUserProfile(profile: UserProfile): void {
  if (typeof window === 'undefined') return;
  if (profilesEqual(_profileMemo ?? null, profile)) return;
  try {
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Quota / privacy mode — fail open.
  }
  _profileMemo = profile;
  notifyProfileChange();
}

export function getCachedMyUserProfile(): UserProfile | null {
  if (typeof window === 'undefined') return null;
  if (_profileMemo !== undefined) return _profileMemo;
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!raw) {
      _profileMemo = null;
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.user_id !== 'string') {
      _profileMemo = null;
      return null;
    }
    _profileMemo = {
      user_id: parsed.user_id,
      image_updated_at:
        typeof parsed.image_updated_at === 'string' ? parsed.image_updated_at : null,
    };
    return _profileMemo;
  } catch {
    _profileMemo = null;
    return null;
  }
}

export function clearCachedMyUserProfile(): void {
  if (typeof window === 'undefined') return;
  if (_profileMemo === null) return;
  try {
    localStorage.removeItem(PROFILE_STORAGE_KEY);
  } catch {
    // ignore
  }
  _profileMemo = null;
  notifyProfileChange();
}

/**
 * The current user's avatar URL (or null when no image is uploaded).
 * Reads from the localStorage cache so it's synchronous and safe to
 * call from a render path.
 */
export function getMyUserImageUrl(): string | null {
  const profile = getCachedMyUserProfile();
  if (!profile) return null;
  return buildUserImageUrl(profile.user_id, profile.image_updated_at);
}

/** Custom event fired when the cached profile changes (upload, delete,
 *  clear). UI surfaces that show the user's avatar listen for this so
 *  they refresh without a navigation. */
export const USER_PROFILE_CHANGED_EVENT = 'whoeverwants:user-profile-changed';

function notifyProfileChange(): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(USER_PROFILE_CHANGED_EVENT));
  } catch {
    // ignore
  }
}

function base64FromArrayBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + CHUNK)),
    );
  }
  return btoa(binary);
}
