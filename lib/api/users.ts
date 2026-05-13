/**
 * User profile (per-browser) API helpers.
 *
 * Mirrors the group image upload pattern from `lib/api/groups.ts`. The
 * server keys profiles by `browser_id` (the per-browser uuid issued by
 * `BrowserIdMiddleware`) so the caller's identity is implicit on the
 * `/me/*` endpoints — they read `request.state.browser_id`.
 *
 * `buildUserImageUrl` is the URL builder for the public `/by-browser-id`
 * endpoint, used wherever the FE renders someone else's avatar (or its
 * own across navigations) without going through a fresh fetch.
 */

import { userFetch } from "./_internal";

const PROFILE_STORAGE_KEY = 'whoeverwants_user_profile';

// Module-level cache: every group/home page mount calls
// `getCachedMyUserProfile` once per `useMyUserImageUrl` instance (i.e.
// once per visible card). Without a cache that's N localStorage reads
// + JSON parses on first paint. The cache is invalidated by every
// write path (cacheMyUserProfile, clearCachedMyUserProfile) since
// they're the only way the value can change in-process. `undefined`
// means "not yet read"; `null` means "no profile stored".
let _profileMemo: UserProfile | null | undefined = undefined;

export interface UserProfile {
  browser_id: string;
  image_updated_at: string | null;
}

export async function apiGetMyUserProfile(): Promise<UserProfile> {
  const data = await userFetch<any>('/me/profile');
  return {
    browser_id: data.browser_id as string,
    image_updated_at: (data.image_updated_at ?? null) as string | null,
  };
}

export async function apiUploadMyUserImage(imageBlob: Blob): Promise<UserProfile> {
  const mimeType = imageBlob.type || 'image/jpeg';
  const arrayBuffer = await imageBlob.arrayBuffer();
  const base64 = base64FromArrayBuffer(arrayBuffer);
  const data = await userFetch<any>('/me/image', {
    method: 'POST',
    body: JSON.stringify({ image_base64: base64, mime_type: mimeType }),
  });
  const result: UserProfile = {
    browser_id: data.browser_id as string,
    image_updated_at: (data.image_updated_at ?? null) as string | null,
  };
  cacheMyUserProfile(result);
  return result;
}

export async function apiDeleteMyUserImage(): Promise<UserProfile> {
  const data = await userFetch<any>('/me/image', { method: 'DELETE' });
  const result: UserProfile = {
    browser_id: data.browser_id as string,
    image_updated_at: null,
  };
  cacheMyUserProfile(result);
  return result;
}

/**
 * Returns `/api/users/by-browser-id/<id>/image?v=<isoTimestamp>` or null
 * when either input is missing. The `?v=` query is the cache-buster: a
 * fresh upload bumps `image_updated_at` so the new URL doesn't collide
 * with the previous image's immutable cache entry.
 */
export function buildUserImageUrl(
  browserId: string | null | undefined,
  imageUpdatedAt: string | null | undefined,
): string | null {
  if (!browserId || !imageUpdatedAt) return null;
  const v = encodeURIComponent(imageUpdatedAt);
  return `/api/users/by-browser-id/${encodeURIComponent(browserId)}/image?v=${v}`;
}

function profilesEqual(a: UserProfile | null, b: UserProfile | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.browser_id === b.browser_id && a.image_updated_at === b.image_updated_at;
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
    if (!parsed || typeof parsed.browser_id !== 'string') {
      _profileMemo = null;
      return null;
    }
    _profileMemo = {
      browser_id: parsed.browser_id,
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
  return buildUserImageUrl(profile.browser_id, profile.image_updated_at);
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
