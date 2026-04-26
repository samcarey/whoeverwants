import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadSubPollDraft,
  saveSubPollDraft,
  clearSubPollDraft,
  loadMultipollBallotDraft,
  saveMultipollBallotDraft,
  clearMultipollBallotDraft,
  loadBallotDraft,
  saveBallotDraft,
  clearBallotDraft,
  type SubPollDraft,
} from '@/lib/ballotDraft';

const MULTIPOLL_PREFIX = 'ballotDraft:m:';
const LEGACY_PREFIX = 'ballotDraft:';

describe('ballotDraft per-multipoll storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('saves a sub-poll draft inside the multipoll entry', () => {
    saveSubPollDraft('m1', 's1', { yesNoChoice: 'yes' });
    const entry = loadMultipollBallotDraft('m1');
    expect(entry).toEqual({ sub_polls: { s1: { yesNoChoice: 'yes' } } });
    expect(localStorage.getItem(LEGACY_PREFIX + 's1')).toBeNull();
  });

  it('loads back what was saved (sub-poll round-trip)', () => {
    const draft: SubPollDraft = { yesNoChoice: 'no', isAbstaining: true };
    saveSubPollDraft('m1', 's1', draft);
    expect(loadSubPollDraft('m1', 's1')).toEqual(draft);
  });

  it('keeps multiple sub-polls separate within the same multipoll', () => {
    saveSubPollDraft('m1', 'a', { yesNoChoice: 'yes' });
    saveSubPollDraft('m1', 'b', { yesNoChoice: 'no' });
    const entry = loadMultipollBallotDraft('m1');
    expect(entry?.sub_polls).toEqual({
      a: { yesNoChoice: 'yes' },
      b: { yesNoChoice: 'no' },
    });
  });

  it('overwrites an existing sub-poll draft without dropping siblings', () => {
    saveSubPollDraft('m1', 'a', { yesNoChoice: 'yes' });
    saveSubPollDraft('m1', 'b', { yesNoChoice: 'no' });
    saveSubPollDraft('m1', 'a', { yesNoChoice: 'no' });
    const entry = loadMultipollBallotDraft('m1');
    expect(entry?.sub_polls).toEqual({
      a: { yesNoChoice: 'no' },
      b: { yesNoChoice: 'no' },
    });
  });

  it('preserves voter_name on the multipoll entry across sub-poll saves', () => {
    saveMultipollBallotDraft('m1', { voter_name: 'Alice', sub_polls: {} });
    saveSubPollDraft('m1', 's1', { yesNoChoice: 'yes' });
    expect(loadMultipollBallotDraft('m1')?.voter_name).toBe('Alice');
  });

  it('clearSubPollDraft removes only the targeted slot', () => {
    saveSubPollDraft('m1', 'a', { yesNoChoice: 'yes' });
    saveSubPollDraft('m1', 'b', { yesNoChoice: 'no' });
    clearSubPollDraft('m1', 'a');
    const entry = loadMultipollBallotDraft('m1');
    expect(entry?.sub_polls).toEqual({ b: { yesNoChoice: 'no' } });
  });

  it('clearSubPollDraft drops the whole multipoll entry when empty and no voter_name', () => {
    saveSubPollDraft('m1', 'a', { yesNoChoice: 'yes' });
    clearSubPollDraft('m1', 'a');
    expect(loadMultipollBallotDraft('m1')).toBeNull();
    expect(localStorage.getItem(MULTIPOLL_PREFIX + 'm1')).toBeNull();
  });

  it('clearSubPollDraft preserves the entry when voter_name is set', () => {
    saveMultipollBallotDraft('m1', { voter_name: 'Alice', sub_polls: { a: { yesNoChoice: 'yes' } } });
    clearSubPollDraft('m1', 'a');
    const entry = loadMultipollBallotDraft('m1');
    expect(entry).toEqual({ voter_name: 'Alice', sub_polls: {} });
  });

  it('returns null when no draft exists', () => {
    expect(loadSubPollDraft('m1', 'missing')).toBeNull();
    expect(loadMultipollBallotDraft('missing')).toBeNull();
  });
});

describe('ballotDraft legacy fallback (multipollId === null)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('writes legacy per-poll key when no multipoll id is provided', () => {
    saveSubPollDraft(null, 'p1', { yesNoChoice: 'yes' });
    expect(JSON.parse(localStorage.getItem(LEGACY_PREFIX + 'p1') || 'null')).toEqual({ yesNoChoice: 'yes' });
    expect(localStorage.getItem(MULTIPOLL_PREFIX + 'p1')).toBeNull();
  });

  it('reads legacy per-poll key when no multipoll id is provided', () => {
    localStorage.setItem(LEGACY_PREFIX + 'p1', JSON.stringify({ yesNoChoice: 'no' }));
    expect(loadSubPollDraft(null, 'p1')).toEqual({ yesNoChoice: 'no' });
  });

  it('clears legacy per-poll key when no multipoll id is provided', () => {
    localStorage.setItem(LEGACY_PREFIX + 'p1', JSON.stringify({ yesNoChoice: 'yes' }));
    clearSubPollDraft(null, 'p1');
    expect(localStorage.getItem(LEGACY_PREFIX + 'p1')).toBeNull();
  });

  it('legacy aliases (loadBallotDraft/saveBallotDraft/clearBallotDraft) match the null-multipollId path', () => {
    saveBallotDraft('p1', { yesNoChoice: 'yes' });
    expect(loadBallotDraft('p1')).toEqual({ yesNoChoice: 'yes' });
    clearBallotDraft('p1');
    expect(loadBallotDraft('p1')).toBeNull();
  });
});

describe('ballotDraft legacy → multipoll migration', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('hoists a legacy per-sub-poll entry into the multipoll entry on read', () => {
    localStorage.setItem(LEGACY_PREFIX + 's1', JSON.stringify({ yesNoChoice: 'yes' }));
    const draft = loadSubPollDraft('m1', 's1');
    expect(draft).toEqual({ yesNoChoice: 'yes' });
    expect(localStorage.getItem(LEGACY_PREFIX + 's1')).toBeNull();
    expect(loadMultipollBallotDraft('m1')?.sub_polls).toEqual({ s1: { yesNoChoice: 'yes' } });
  });

  it('migration does not overwrite an existing multipoll-keyed slot', () => {
    saveSubPollDraft('m1', 's1', { yesNoChoice: 'no' });
    localStorage.setItem(LEGACY_PREFIX + 's1', JSON.stringify({ yesNoChoice: 'yes' }));
    const draft = loadSubPollDraft('m1', 's1');
    // Multipoll entry wins; legacy entry left untouched (no migration triggered).
    expect(draft).toEqual({ yesNoChoice: 'no' });
    expect(localStorage.getItem(LEGACY_PREFIX + 's1')).not.toBeNull();
  });

  it('migration merges with existing multipoll entry (other sub-polls preserved)', () => {
    saveSubPollDraft('m1', 'other', { yesNoChoice: 'no' });
    localStorage.setItem(LEGACY_PREFIX + 's1', JSON.stringify({ yesNoChoice: 'yes' }));
    loadSubPollDraft('m1', 's1');
    const entry = loadMultipollBallotDraft('m1');
    expect(entry?.sub_polls).toEqual({
      other: { yesNoChoice: 'no' },
      s1: { yesNoChoice: 'yes' },
    });
  });

  it('clearSubPollDraft also clears any stray legacy entry under the same id', () => {
    localStorage.setItem(LEGACY_PREFIX + 's1', JSON.stringify({ yesNoChoice: 'yes' }));
    saveSubPollDraft('m1', 's1', { yesNoChoice: 'no' });
    clearSubPollDraft('m1', 's1');
    expect(localStorage.getItem(LEGACY_PREFIX + 's1')).toBeNull();
    expect(loadMultipollBallotDraft('m1')).toBeNull();
  });
});

describe('clearMultipollBallotDraft', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('removes the entire multipoll entry', () => {
    saveSubPollDraft('m1', 'a', { yesNoChoice: 'yes' });
    saveSubPollDraft('m1', 'b', { yesNoChoice: 'no' });
    clearMultipollBallotDraft('m1');
    expect(loadMultipollBallotDraft('m1')).toBeNull();
  });
});
