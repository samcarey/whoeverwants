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

export function saveUserName(name: string) {
  if (typeof window === 'undefined') return;
  if (name.trim()) {
    localStorage.setItem(USER_NAME_KEY, name.trim());
  } else {
    localStorage.removeItem(USER_NAME_KEY);
  }
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