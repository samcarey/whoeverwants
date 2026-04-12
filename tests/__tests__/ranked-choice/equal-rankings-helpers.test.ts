import { describe, it, expect } from 'vitest';
import {
  pairKey,
  computeTierIndices,
  tiersFromList,
  tierRanks,
  getTierRange,
} from '@/components/RankableOptions';

describe('pairKey', () => {
  it('returns the same key regardless of argument order', () => {
    expect(pairKey('a', 'b')).toBe(pairKey('b', 'a'));
  });
  it('uses lexicographic ordering for canonical form', () => {
    expect(pairKey('z', 'a')).toBe('a|z');
  });
  it('handles identical ids (shouldn\'t happen in practice)', () => {
    expect(pairKey('a', 'a')).toBe('a|a');
  });
});

describe('computeTierIndices', () => {
  const mk = (...ids: string[]) => ids.map(id => ({ id }));

  it('returns empty tiers for empty list', () => {
    expect(computeTierIndices([], new Set())).toEqual([]);
  });

  it('returns one tier per item when nothing is linked', () => {
    const list = mk('a', 'b', 'c');
    expect(computeTierIndices(list, new Set())).toEqual([[0], [1], [2]]);
  });

  it('groups items linked to their next neighbor', () => {
    const list = mk('a', 'b', 'c');
    const linked = new Set([pairKey('a', 'b')]);
    expect(computeTierIndices(list, linked)).toEqual([[0, 1], [2]]);
  });

  it('chains multiple consecutive links into one tier', () => {
    const list = mk('a', 'b', 'c', 'd');
    const linked = new Set([pairKey('a', 'b'), pairKey('b', 'c')]);
    expect(computeTierIndices(list, linked)).toEqual([[0, 1, 2], [3]]);
  });

  it('breaks a chain where a non-link gap exists', () => {
    const list = mk('a', 'b', 'c', 'd', 'e');
    // link a-b and d-e, not b-c or c-d
    const linked = new Set([pairKey('a', 'b'), pairKey('d', 'e')]);
    expect(computeTierIndices(list, linked)).toEqual([[0, 1], [2], [3, 4]]);
  });

  it('ignores stale pair entries when items are no longer adjacent', () => {
    const list = mk('a', 'b', 'c');
    // Originally a-c were linked (unusual), but the visual order places b
    // between them. Since we only check adjacent pairs, the a-c entry is
    // ignored and we end up with three singletons.
    const linked = new Set([pairKey('a', 'c')]);
    expect(computeTierIndices(list, linked)).toEqual([[0], [1], [2]]);
  });
});

describe('tiersFromList', () => {
  const mkFull = (...items: [string, string][]) =>
    items.map(([id, text]) => ({ id, text }));

  it('converts linked indices into text-based tiers', () => {
    const list = mkFull(['i1', 'Alice'], ['i2', 'Bob'], ['i3', 'Carol']);
    const linked = new Set([pairKey('i2', 'i3')]);
    expect(tiersFromList(list, linked)).toEqual([['Alice'], ['Bob', 'Carol']]);
  });

  it('returns singleton tiers when nothing is linked', () => {
    const list = mkFull(['i1', 'Alice'], ['i2', 'Bob']);
    expect(tiersFromList(list, new Set())).toEqual([['Alice'], ['Bob']]);
  });

  it('handles all items grouped into one tier', () => {
    const list = mkFull(['i1', 'A'], ['i2', 'B'], ['i3', 'C']);
    const linked = new Set([pairKey('i1', 'i2'), pairKey('i2', 'i3')]);
    expect(tiersFromList(list, linked)).toEqual([['A', 'B', 'C']]);
  });
});

describe('tierRanks (standard competition ranking)', () => {
  it('returns [1] for a single tier', () => {
    expect(tierRanks([[0]])).toEqual([1]);
  });

  it('returns sequential ranks for all singletons', () => {
    expect(tierRanks([[0], [1], [2]])).toEqual([1, 2, 3]);
  });

  it('skips ranks after a multi-item tier (1, 2, 2, 4 pattern)', () => {
    expect(tierRanks([[0], [1, 2], [3]])).toEqual([1, 2, 4]);
  });

  it('handles a 3-item tied block', () => {
    // Tiers: [A], [B, C, D], [E] -> ranks 1, 2, 5
    expect(tierRanks([[0], [1, 2, 3], [4]])).toEqual([1, 2, 5]);
  });

  it('handles multiple tied blocks', () => {
    // Tiers: [A, B], [C], [D, E, F] -> ranks 1, 3, 4
    expect(tierRanks([[0, 1], [2], [3, 4, 5]])).toEqual([1, 3, 4]);
  });

  it('returns empty array for no tiers', () => {
    expect(tierRanks([])).toEqual([]);
  });
});

describe('getTierRange', () => {
  const mk = (...ids: string[]) => ids.map(id => ({ id }));

  it('returns [index, 1] for an untied item', () => {
    const list = mk('a', 'b', 'c');
    expect(getTierRange(list, new Set(), 1)).toEqual([1, 1]);
  });

  it('returns full tier range when item is in the middle of a tier', () => {
    const list = mk('a', 'b', 'c', 'd', 'e');
    // a-b-c are tied
    const linked = new Set([pairKey('a', 'b'), pairKey('b', 'c')]);
    // Grab the middle item
    expect(getTierRange(list, linked, 1)).toEqual([0, 3]);
  });

  it('returns full tier range when grabbing the tier head', () => {
    const list = mk('a', 'b', 'c');
    const linked = new Set([pairKey('a', 'b'), pairKey('b', 'c')]);
    expect(getTierRange(list, linked, 0)).toEqual([0, 3]);
  });

  it('returns full tier range when grabbing the tier tail', () => {
    const list = mk('a', 'b', 'c');
    const linked = new Set([pairKey('a', 'b'), pairKey('b', 'c')]);
    expect(getTierRange(list, linked, 2)).toEqual([0, 3]);
  });

  it('handles a two-item tier', () => {
    const list = mk('a', 'b', 'c', 'd');
    // b-c are tied
    const linked = new Set([pairKey('b', 'c')]);
    expect(getTierRange(list, linked, 1)).toEqual([1, 2]);
    expect(getTierRange(list, linked, 2)).toEqual([1, 2]);
    // Outside the tier
    expect(getTierRange(list, linked, 0)).toEqual([0, 1]);
    expect(getTierRange(list, linked, 3)).toEqual([3, 1]);
  });

  it('does not cross a tier boundary when adjacent tiers exist', () => {
    const list = mk('a', 'b', 'c', 'd');
    // a-b tied, c-d tied, but b-c NOT tied
    const linked = new Set([pairKey('a', 'b'), pairKey('c', 'd')]);
    expect(getTierRange(list, linked, 0)).toEqual([0, 2]);
    expect(getTierRange(list, linked, 1)).toEqual([0, 2]);
    expect(getTierRange(list, linked, 2)).toEqual([2, 2]);
    expect(getTierRange(list, linked, 3)).toEqual([2, 2]);
  });

  it('returns [index, 1] for out-of-bounds indices', () => {
    const list = mk('a', 'b');
    expect(getTierRange(list, new Set(), -1)).toEqual([-1, 1]);
    expect(getTierRange(list, new Set(), 5)).toEqual([5, 1]);
  });
});

describe('round-trip: list + pairs -> tiers -> rank display', () => {
  it('matches the spec example [A], [B, C], [D] -> ranks 1, 2, 4', () => {
    const list = [
      { id: 'o1', text: 'A' },
      { id: 'o2', text: 'B' },
      { id: 'o3', text: 'C' },
      { id: 'o4', text: 'D' },
    ];
    const linked = new Set([pairKey('o2', 'o3')]);
    const tiers = tiersFromList(list, linked);
    expect(tiers).toEqual([['A'], ['B', 'C'], ['D']]);
    expect(tierRanks(tiers)).toEqual([1, 2, 4]);
  });
});
