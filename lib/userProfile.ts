const USER_NAME_KEY = 'whoeverwants_user_name';

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