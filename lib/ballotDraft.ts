// Ballot draft persistence — saves in-progress vote state to localStorage
// so it survives page navigation.
//
// Storage layout: keyed by poll_id. Each entry holds shared poll-level
// fields (voter_name) plus a per-question map of in-progress vote state.
// The legacy per-question key path (pollId === null) is retained for
// pre-Phase-4 questions that haven't been wrapped.

import type { DayTimeWindow } from "./types";

const POLL_PREFIX = 'ballotDraft:m:';
const LEGACY_PREFIX = 'ballotDraft:';

export interface QuestionDraft {
  yesNoChoice?: 'yes' | 'no' | null;
  isAbstaining?: boolean;
  voterDayTimeWindows?: DayTimeWindow[];
  durationMinValue?: number | null;
  durationMaxValue?: number | null;
  durationMinEnabled?: boolean;
  durationMaxEnabled?: boolean;
}

export interface PollBallotDraft {
  voter_name?: string;
  questions: { [subQuestionId: string]: QuestionDraft };
}

export type BallotDraft = QuestionDraft;

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

export function loadPollBallotDraft(pollId: string): PollBallotDraft | null {
  return readJson<PollBallotDraft>(POLL_PREFIX + pollId);
}

export function savePollBallotDraft(pollId: string, draft: PollBallotDraft): void {
  writeJson(POLL_PREFIX + pollId, draft);
}

export function clearPollBallotDraft(pollId: string): void {
  removeKey(POLL_PREFIX + pollId);
}

// When pollId is null, falls back to the legacy per-question key (used
// by any pre-Phase-4 questions that haven't been wrapped in a poll).
export function loadQuestionDraft(
  pollId: string | null | undefined,
  subQuestionId: string
): QuestionDraft | null {
  if (typeof window === 'undefined') return null;
  if (!pollId) {
    return readJson<QuestionDraft>(LEGACY_PREFIX + subQuestionId);
  }
  const entry = loadPollBallotDraft(pollId);
  if (entry?.questions?.[subQuestionId]) return entry.questions[subQuestionId];
  // One-shot migration: hoist a stray legacy per-question entry into the
  // poll entry and drop the legacy key. Preserves any other slots
  // already in the entry.
  const legacy = readJson<QuestionDraft>(LEGACY_PREFIX + subQuestionId);
  if (!legacy) return null;
  const next = entry ?? { questions: {} };
  next.questions[subQuestionId] = legacy;
  savePollBallotDraft(pollId, next);
  removeKey(LEGACY_PREFIX + subQuestionId);
  return legacy;
}

export function saveQuestionDraft(
  pollId: string | null | undefined,
  subQuestionId: string,
  draft: QuestionDraft
): void {
  if (typeof window === 'undefined') return;
  if (!pollId) {
    writeJson(LEGACY_PREFIX + subQuestionId, draft);
    return;
  }
  const entry = loadPollBallotDraft(pollId) ?? { questions: {} };
  entry.questions[subQuestionId] = draft;
  savePollBallotDraft(pollId, entry);
}

export function clearQuestionDraft(
  pollId: string | null | undefined,
  subQuestionId: string
): void {
  if (typeof window === 'undefined') return;
  if (!pollId) {
    removeKey(LEGACY_PREFIX + subQuestionId);
    return;
  }
  // Defensive: clear any stray legacy entry too, in case a save bypassed
  // the migration path in loadQuestionDraft.
  removeKey(LEGACY_PREFIX + subQuestionId);
  const entry = loadPollBallotDraft(pollId);
  if (!entry) return;
  const { [subQuestionId]: _removed, ...rest } = entry.questions ?? {};
  if (Object.keys(rest).length === 0 && !entry.voter_name) {
    clearPollBallotDraft(pollId);
    return;
  }
  savePollBallotDraft(pollId, { ...entry, questions: rest });
}

// Legacy aliases — remove once all callers migrate.
export function loadBallotDraft(questionId: string): QuestionDraft | null {
  return loadQuestionDraft(null, questionId);
}

export function saveBallotDraft(questionId: string, draft: QuestionDraft): void {
  saveQuestionDraft(null, questionId, draft);
}

export function clearBallotDraft(questionId: string): void {
  clearQuestionDraft(null, questionId);
}
