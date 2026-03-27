const USER_NAME_KEY = 'whoeverwants_user_name';
const USER_LOCATION_KEY = 'whoeverwants_user_location';

export interface UserLocation {
  latitude: number;
  longitude: number;
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