import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadQuestionDraft,
  saveQuestionDraft,
  clearQuestionDraft,
  loadPollBallotDraft,
  savePollBallotDraft,
  clearPollBallotDraft,
  loadBallotDraft,
  saveBallotDraft,
  clearBallotDraft,
  type QuestionDraft,
} from '@/lib/ballotDraft';

const POLL_PREFIX = 'ballotDraft:m:';
const LEGACY_PREFIX = 'ballotDraft:';

describe('ballotDraft per-poll storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('saves a question draft inside the poll entry', () => {
    saveQuestionDraft('m1', 's1', { yesNoChoice: 'yes' });
    const entry = loadPollBallotDraft('m1');
    expect(entry).toEqual({ questions: { s1: { yesNoChoice: 'yes' } } });
    expect(localStorage.getItem(LEGACY_PREFIX + 's1')).toBeNull();
  });

  it('loads back what was saved (question round-trip)', () => {
    const draft: QuestionDraft = { yesNoChoice: 'no', isAbstaining: true };
    saveQuestionDraft('m1', 's1', draft);
    expect(loadQuestionDraft('m1', 's1')).toEqual(draft);
  });

  it('keeps multiple questions separate within the same poll', () => {
    saveQuestionDraft('m1', 'a', { yesNoChoice: 'yes' });
    saveQuestionDraft('m1', 'b', { yesNoChoice: 'no' });
    const entry = loadPollBallotDraft('m1');
    expect(entry?.questions).toEqual({
      a: { yesNoChoice: 'yes' },
      b: { yesNoChoice: 'no' },
    });
  });

  it('overwrites an existing question draft without dropping siblings', () => {
    saveQuestionDraft('m1', 'a', { yesNoChoice: 'yes' });
    saveQuestionDraft('m1', 'b', { yesNoChoice: 'no' });
    saveQuestionDraft('m1', 'a', { yesNoChoice: 'no' });
    const entry = loadPollBallotDraft('m1');
    expect(entry?.questions).toEqual({
      a: { yesNoChoice: 'no' },
      b: { yesNoChoice: 'no' },
    });
  });

  it('preserves voter_name on the poll entry across question saves', () => {
    savePollBallotDraft('m1', { voter_name: 'Alice', questions: {} });
    saveQuestionDraft('m1', 's1', { yesNoChoice: 'yes' });
    expect(loadPollBallotDraft('m1')?.voter_name).toBe('Alice');
  });

  it('clearQuestionDraft removes only the targeted slot', () => {
    saveQuestionDraft('m1', 'a', { yesNoChoice: 'yes' });
    saveQuestionDraft('m1', 'b', { yesNoChoice: 'no' });
    clearQuestionDraft('m1', 'a');
    const entry = loadPollBallotDraft('m1');
    expect(entry?.questions).toEqual({ b: { yesNoChoice: 'no' } });
  });

  it('clearQuestionDraft drops the whole poll entry when empty and no voter_name', () => {
    saveQuestionDraft('m1', 'a', { yesNoChoice: 'yes' });
    clearQuestionDraft('m1', 'a');
    expect(loadPollBallotDraft('m1')).toBeNull();
    expect(localStorage.getItem(POLL_PREFIX + 'm1')).toBeNull();
  });

  it('clearQuestionDraft preserves the entry when voter_name is set', () => {
    savePollBallotDraft('m1', { voter_name: 'Alice', questions: { a: { yesNoChoice: 'yes' } } });
    clearQuestionDraft('m1', 'a');
    const entry = loadPollBallotDraft('m1');
    expect(entry).toEqual({ voter_name: 'Alice', questions: {} });
  });

  it('returns null when no draft exists', () => {
    expect(loadQuestionDraft('m1', 'missing')).toBeNull();
    expect(loadPollBallotDraft('missing')).toBeNull();
  });
});

describe('ballotDraft legacy fallback (pollId === null)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('writes legacy per-question key when no poll id is provided', () => {
    saveQuestionDraft(null, 'p1', { yesNoChoice: 'yes' });
    expect(JSON.parse(localStorage.getItem(LEGACY_PREFIX + 'p1') || 'null')).toEqual({ yesNoChoice: 'yes' });
    expect(localStorage.getItem(POLL_PREFIX + 'p1')).toBeNull();
  });

  it('reads legacy per-question key when no poll id is provided', () => {
    localStorage.setItem(LEGACY_PREFIX + 'p1', JSON.stringify({ yesNoChoice: 'no' }));
    expect(loadQuestionDraft(null, 'p1')).toEqual({ yesNoChoice: 'no' });
  });

  it('clears legacy per-question key when no poll id is provided', () => {
    localStorage.setItem(LEGACY_PREFIX + 'p1', JSON.stringify({ yesNoChoice: 'yes' }));
    clearQuestionDraft(null, 'p1');
    expect(localStorage.getItem(LEGACY_PREFIX + 'p1')).toBeNull();
  });

  it('legacy aliases (loadBallotDraft/saveBallotDraft/clearBallotDraft) match the null-pollId path', () => {
    saveBallotDraft('p1', { yesNoChoice: 'yes' });
    expect(loadBallotDraft('p1')).toEqual({ yesNoChoice: 'yes' });
    clearBallotDraft('p1');
    expect(loadBallotDraft('p1')).toBeNull();
  });
});

describe('ballotDraft legacy → poll migration', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('hoists a legacy per-question entry into the poll entry on read', () => {
    localStorage.setItem(LEGACY_PREFIX + 's1', JSON.stringify({ yesNoChoice: 'yes' }));
    const draft = loadQuestionDraft('m1', 's1');
    expect(draft).toEqual({ yesNoChoice: 'yes' });
    expect(localStorage.getItem(LEGACY_PREFIX + 's1')).toBeNull();
    expect(loadPollBallotDraft('m1')?.questions).toEqual({ s1: { yesNoChoice: 'yes' } });
  });

  it('migration does not overwrite an existing poll-keyed slot', () => {
    saveQuestionDraft('m1', 's1', { yesNoChoice: 'no' });
    localStorage.setItem(LEGACY_PREFIX + 's1', JSON.stringify({ yesNoChoice: 'yes' }));
    const draft = loadQuestionDraft('m1', 's1');
    // Poll entry wins; legacy entry left untouched (no migration triggered).
    expect(draft).toEqual({ yesNoChoice: 'no' });
    expect(localStorage.getItem(LEGACY_PREFIX + 's1')).not.toBeNull();
  });

  it('migration merges with existing poll entry (other questions preserved)', () => {
    saveQuestionDraft('m1', 'other', { yesNoChoice: 'no' });
    localStorage.setItem(LEGACY_PREFIX + 's1', JSON.stringify({ yesNoChoice: 'yes' }));
    loadQuestionDraft('m1', 's1');
    const entry = loadPollBallotDraft('m1');
    expect(entry?.questions).toEqual({
      other: { yesNoChoice: 'no' },
      s1: { yesNoChoice: 'yes' },
    });
  });

  it('clearQuestionDraft also clears any stray legacy entry under the same id', () => {
    localStorage.setItem(LEGACY_PREFIX + 's1', JSON.stringify({ yesNoChoice: 'yes' }));
    saveQuestionDraft('m1', 's1', { yesNoChoice: 'no' });
    clearQuestionDraft('m1', 's1');
    expect(localStorage.getItem(LEGACY_PREFIX + 's1')).toBeNull();
    expect(loadPollBallotDraft('m1')).toBeNull();
  });
});

describe('clearPollBallotDraft', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('removes the entire poll entry', () => {
    saveQuestionDraft('m1', 'a', { yesNoChoice: 'yes' });
    saveQuestionDraft('m1', 'b', { yesNoChoice: 'no' });
    clearPollBallotDraft('m1');
    expect(loadPollBallotDraft('m1')).toBeNull();
  });
});
