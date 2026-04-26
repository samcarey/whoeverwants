// Ballot draft persistence — saves in-progress vote state to localStorage
// so it survives page navigation.
//
// Storage layout: keyed by multipoll_id. Each entry holds shared multipoll-level
// fields (voter_name) plus a per-sub-poll map of in-progress vote state.
// Participation polls have no multipoll wrapper — they use the legacy per-poll
// key path (multipollId === null in the helpers below).

import type { DayTimeWindow } from "./types";

const MULTIPOLL_PREFIX = 'ballotDraft:m:';
const LEGACY_PREFIX = 'ballotDraft:';

export interface SubPollDraft {
  yesNoChoice?: 'yes' | 'no' | null;
  isAbstaining?: boolean;
  voterMinParticipants?: number | null;
  voterMaxParticipants?: number | null;
  voterMaxEnabled?: boolean;
  voterDayTimeWindows?: DayTimeWindow[];
  durationMinValue?: number | null;
  durationMaxValue?: number | null;
  durationMinEnabled?: boolean;
  durationMaxEnabled?: boolean;
}

export interface MultipollBallotDraft {
  voter_name?: string;
  sub_polls: { [subPollId: string]: SubPollDraft };
}

export type BallotDraft = SubPollDraft;

function readJson<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch { return null; }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* ignore quota errors */ }
}

function removeKey(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(key);
  } catch { /* ignore */ }
}

export function loadMultipollBallotDraft(multipollId: string): MultipollBallotDraft | null {
  return readJson<MultipollBallotDraft>(MULTIPOLL_PREFIX + multipollId);
}

export function saveMultipollBallotDraft(multipollId: string, draft: MultipollBallotDraft): void {
  writeJson(MULTIPOLL_PREFIX + multipollId, draft);
}

export function clearMultipollBallotDraft(multipollId: string): void {
  removeKey(MULTIPOLL_PREFIX + multipollId);
}

// When multipollId is null, falls back to the legacy per-sub-poll key (used by
// participation polls, which have no multipoll wrapper).
export function loadSubPollDraft(
  multipollId: string | null | undefined,
  subPollId: string
): SubPollDraft | null {
  if (typeof window === 'undefined') return null;
  if (!multipollId) {
    return readJson<SubPollDraft>(LEGACY_PREFIX + subPollId);
  }
  const entry = loadMultipollBallotDraft(multipollId);
  if (entry?.sub_polls?.[subPollId]) return entry.sub_polls[subPollId];
  // One-shot migration: hoist a stray legacy per-sub-poll entry into the
  // multipoll entry and drop the legacy key. Preserves any other slots
  // already in the entry.
  const legacy = readJson<SubPollDraft>(LEGACY_PREFIX + subPollId);
  if (!legacy) return null;
  const next = entry ?? { sub_polls: {} };
  next.sub_polls[subPollId] = legacy;
  saveMultipollBallotDraft(multipollId, next);
  removeKey(LEGACY_PREFIX + subPollId);
  return legacy;
}

export function saveSubPollDraft(
  multipollId: string | null | undefined,
  subPollId: string,
  draft: SubPollDraft
): void {
  if (typeof window === 'undefined') return;
  if (!multipollId) {
    writeJson(LEGACY_PREFIX + subPollId, draft);
    return;
  }
  const entry = loadMultipollBallotDraft(multipollId) ?? { sub_polls: {} };
  entry.sub_polls[subPollId] = draft;
  saveMultipollBallotDraft(multipollId, entry);
}

export function clearSubPollDraft(
  multipollId: string | null | undefined,
  subPollId: string
): void {
  if (typeof window === 'undefined') return;
  if (!multipollId) {
    removeKey(LEGACY_PREFIX + subPollId);
    return;
  }
  // Defensive: clear any stray legacy entry too, in case a save bypassed
  // the migration path in loadSubPollDraft.
  removeKey(LEGACY_PREFIX + subPollId);
  const entry = loadMultipollBallotDraft(multipollId);
  if (!entry) return;
  const { [subPollId]: _removed, ...rest } = entry.sub_polls ?? {};
  if (Object.keys(rest).length === 0 && !entry.voter_name) {
    clearMultipollBallotDraft(multipollId);
    return;
  }
  saveMultipollBallotDraft(multipollId, { ...entry, sub_polls: rest });
}

// Legacy aliases — remove once all callers migrate.
export function loadBallotDraft(pollId: string): SubPollDraft | null {
  return loadSubPollDraft(null, pollId);
}

export function saveBallotDraft(pollId: string, draft: SubPollDraft): void {
  saveSubPollDraft(null, pollId, draft);
}

export function clearBallotDraft(pollId: string): void {
  clearSubPollDraft(null, pollId);
}
