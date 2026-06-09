/**
 * Per-poll recurrence store (prototype).
 *
 * Recurrence has no backend column yet (see lib/recurrence.ts), so the
 * structured rule a creator picks is persisted client-side, keyed by the
 * created poll's id, alongside the start date (when the series began). The
 * Scheduled page reads this to enumerate the upcoming auto-opening instances
 * of each recurring poll in a group.
 *
 * Per-browser by nature — the creator's browser is the one that knows the
 * schedule. A real implementation would move this to a `polls.recurrence`
 * column + a server scheduler; the shape here is deliberately the exact
 * RecurrenceRule so that migration is mechanical.
 */
import { RecurrenceRule } from './recurrence';

const KEY = 'whoeverwants_poll_recurrences';
const MAX_ENTRIES = 200;

export interface StoredRecurrence {
  rule: RecurrenceRule;
  /** First-occurrence anchor (YYYY-MM-DD). */
  start: string;
  /** When this entry was written (epoch ms) — used for LRU eviction. */
  savedAt: number;
}

/** Fired after a write so a mounted Scheduled page can refresh. */
export const RECURRENCE_STORE_CHANGED_EVENT = 'recurrence-store-changed';

function readAll(): Record<string, StoredRecurrence> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(map: Record<string, StoredRecurrence>): void {
  if (typeof window === 'undefined') return;
  // LRU-bound: drop the oldest entries when over the cap.
  const entries = Object.entries(map);
  if (entries.length > MAX_ENTRIES) {
    entries.sort((a, b) => a[1].savedAt - b[1].savedAt);
    map = Object.fromEntries(entries.slice(entries.length - MAX_ENTRIES));
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
    window.dispatchEvent(new Event(RECURRENCE_STORE_CHANGED_EVENT));
  } catch {
    /* quota / serialization — non-fatal for a prototype */
  }
}

export function saveRecurrenceForPoll(pollId: string, rule: RecurrenceRule, start: string): void {
  if (!pollId) return;
  const map = readAll();
  map[pollId] = { rule, start, savedAt: Date.now() };
  writeAll(map);
}

export function getRecurrenceForPoll(pollId: string): StoredRecurrence | null {
  return readAll()[pollId] ?? null;
}

export function getAllRecurrences(): Record<string, StoredRecurrence> {
  return readAll();
}

export function clearRecurrenceForPoll(pollId: string): void {
  const map = readAll();
  if (map[pollId]) {
    delete map[pollId];
    writeAll(map);
  }
}
