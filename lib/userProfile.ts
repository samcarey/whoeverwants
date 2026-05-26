const USER_NAME_KEY = 'whoeverwants_user_name';
const USER_LOCATION_KEY = 'whoeverwants_user_location';
const USER_MIN_RESPONSES_KEY = 'whoeverwants_min_responses';

export interface Coords {
  latitude: number;
  longitude: number;
}

export interface UserLocation extends Coords {
  label: string; // City/zip for display, e.g. "San Francisco, CA" or "90210"
}

/**
 * Write the name to this browser's localStorage only — no account sync.
 * Used by the auth layer to mirror an account name down on sign-in without
 * echoing the same value straight back up to the account.
 */
export function saveUserNameLocalOnly(name: string) {
  if (typeof window === 'undefined') return;
  if (name.trim()) {
    localStorage.setItem(USER_NAME_KEY, name.trim());
  } else {
    localStorage.removeItem(USER_NAME_KEY);
  }
}

export function saveUserName(name: string) {
  if (typeof window === 'undefined') return;
  saveUserNameLocalOnly(name);
  // When signed in, the name is tied to the account: mirror every change up
  // so it follows the user across devices. Best-effort + deduped in the auth
  // layer (no-op when signed out or when the account already has this value).
  // Lazy import keeps the network layer out of this low-level module's static
  // graph and off the SSR path (the window guard above already returned).
  void import('@/lib/api/auth')
    .then((m) => m.pushLocalNameToAccount(name.trim()))
    .catch(() => {
      // Best-effort: local storage remains the source of truth this session.
    });
}

export function getUserName(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(USER_NAME_KEY);
}

export function clearUserName() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(USER_NAME_KEY);
}

export function saveUserLocation(location: UserLocation) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(USER_LOCATION_KEY, JSON.stringify(location));
}

export function getUserLocation(): UserLocation | null {
  if (typeof window === 'undefined') return null;
  const stored = localStorage.getItem(USER_LOCATION_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored) as UserLocation;
  } catch {
    return null;
  }
}

export function clearUserLocation() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(USER_LOCATION_KEY);
}

export function saveUserMinResponses(value: number) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(USER_MIN_RESPONSES_KEY, String(value));
}

export function clearUserMinResponses() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(USER_MIN_RESPONSES_KEY);
}

/**
 * Wipe every piece of locally-stored personal user data — display name,
 * reference location, and the min-responses default. Called on sign-out
 * (via `clearSession`) so the next anonymous session starts with a clean
 * slate. Does NOT touch the account's server-side display_name (signing
 * back into the same account restores the name) nor browser-scoped
 * identity (`browser_id`, group memberships, theme preference).
 */
export function clearStoredUserData() {
  if (typeof window === 'undefined') return;
  clearUserName();
  clearUserLocation();
  clearUserMinResponses();
}

export function getUserMinResponses(): number | null {
  if (typeof window === 'undefined') return null;
  const stored = localStorage.getItem(USER_MIN_RESPONSES_KEY);
  if (!stored) return null;
  const num = parseInt(stored, 10);
  return isNaN(num) ? null : num;
}

/**
 * True iff `name` matches the current user's saved name (case-
 * insensitive, trimmed). Used to decide whether a name-keyed bubble
 * should render the current user's profile image instead of initials.
 *
 * Returns false when the user hasn't saved a name yet — there's
 * nothing meaningful to compare against and we don't want every
 * anonymous name bubble to suddenly inherit the current browser's
 * profile photo.
 */
export function isCurrentUserName(name: string | null | undefined): boolean {
  if (!name) return false;
  const mine = getUserName();
  if (!mine) return false;
  return name.trim().toLowerCase() === mine.trim().toLowerCase();
}

export function getUserInitials(name: string | null): string {
  if (!name || !name.trim()) return '?';

  const trimmedName = name.trim();
  const words = trimmedName.split(/\s+/).filter(word => word.length > 0);

  if (words.length === 0) return '?';
  if (words.length === 1) {
    return words[0][0].toUpperCase();
  }

  // Take first letter of first word and first letter of last word
  const firstInitial = words[0][0].toUpperCase();
  const lastInitial = words[words.length - 1][0].toUpperCase();
  return firstInitial + lastInitial;
}