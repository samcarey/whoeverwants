/**
 * localStorage persistence for the RankableOptions component.
 *
 * The shape `{ mainList, noPreferenceList, linkedPairs, timestamp }` is owned
 * by the calling component; this module just serialises it. Saved entries
 * are validated against the current options on load — if they don't match,
 * we return null so the caller can fall back to its randomized initial order.
 */

export interface RankableOption {
  id: string;
  text: string;
  top: number;
}

interface SavedRankingState {
  mainList: RankableOption[];
  noPreferenceList: RankableOption[];
  linkedPairs: string[];
  timestamp: number;
}

/**
 * Load a previously-saved ranking from localStorage. Returns null when there's
 * no saved state, when the saved options don't match `currentOptions`, or on
 * any parse error.
 */
export function loadSavedRanking(
  storageKey: string | undefined,
  currentOptions: string[],
): SavedRankingState | null {
  if (!storageKey || typeof window === 'undefined') return null;
  try {
    const saved = localStorage.getItem(storageKey);
    if (!saved) return null;
    const parsed = JSON.parse(saved) as SavedRankingState;
    const allSavedTexts = [...parsed.mainList, ...parsed.noPreferenceList].map(opt => opt.text).sort();
    const sortedCurrent = [...currentOptions].sort();
    if (allSavedTexts.length !== sortedCurrent.length) return null;
    if (!allSavedTexts.every((text, i) => text === sortedCurrent[i])) return null;
    return parsed;
  } catch (e) {
    console.error('Failed to load saved ranking state:', e);
    return null;
  }
}

/**
 * Persist the current ranking + linked-pair set to localStorage. No-ops
 * server-side and when no `storageKey` is provided.
 */
export function saveRanking(
  storageKey: string | undefined,
  mainList: RankableOption[],
  noPreferenceList: RankableOption[],
  linkedPairs: Set<string>,
): void {
  if (!storageKey || typeof window === 'undefined') return;
  try {
    localStorage.setItem(storageKey, JSON.stringify({
      mainList,
      noPreferenceList,
      linkedPairs: Array.from(linkedPairs),
      timestamp: Date.now(),
    }));
  } catch (e) {
    console.error('Failed to save ranking state:', e);
  }
}

/** Fisher-Yates shuffle. Returns a new array; does not mutate the input. */
export function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/** Build RankableOption[] from raw option strings (initial top=0; positions
 *  get filled in by the caller's updateItemPositions). */
export function createRankedOptions(optionTexts: string[]): RankableOption[] {
  return optionTexts.map((text, index) => ({
    id: `option-${index}`,
    text,
    top: 0,
  }));
}
