import { describe, it, expect } from 'vitest';
import {
  BUILT_IN_TYPES,
  getBuiltInType,
  categoryMatchesQuery,
  categoryLabelMatchesQuery,
} from '@/components/TypeFieldInput';

// Mirror the new-poll search box's tokenization (app/create-poll/page.tsx).
const toTokens = (q: string) => q.toLowerCase().split(/[\s,]+/).filter(Boolean);

// Reproduce the search box's category section: filter to matches, then rank
// exact-label hits ahead of alias-only hits. Returns category values in the
// order they'd be presented (best/nearest-the-bar first).
function rankedCategoryMatches(query: string): string[] {
  const tokens = toTokens(query);
  const matched = BUILT_IN_TYPES.filter(
    (t) => t.value !== 'yes_no' && t.value !== 'limited_supply' && categoryMatchesQuery(t, tokens),
  );
  return [
    ...matched.filter((t) => categoryLabelMatchesQuery(t, tokens)),
    ...matched.filter((t) => !categoryLabelMatchesQuery(t, tokens)),
  ].map((t) => t.value);
}

describe('categoryMatchesQuery', () => {
  it('matches the literal label', () => {
    expect(categoryMatchesQuery(getBuiltInType('movie'), toTokens('movie'))).toBe(true);
    expect(categoryMatchesQuery(getBuiltInType('video_game'), toTokens('video ga'))).toBe(true);
  });

  it('matches via curated alias keywords', () => {
    // The motivating case: "Movie" should surface "Showtime".
    expect(categoryMatchesQuery(getBuiltInType('showtime'), toTokens('movie'))).toBe(true);
    // ...and reciprocally "Showtime" surfaces "Movie".
    expect(categoryMatchesQuery(getBuiltInType('movie'), toTokens('showtime'))).toBe(true);
    expect(categoryMatchesQuery(getBuiltInType('restaurant'), toTokens('dinner'))).toBe(true);
    expect(categoryMatchesQuery(getBuiltInType('location'), toTokens('venue'))).toBe(true);
    expect(categoryMatchesQuery(getBuiltInType('time'), toTokens('when'))).toBe(true);
  });

  it('does not match unrelated queries', () => {
    expect(categoryMatchesQuery(getBuiltInType('showtime'), toTokens('restaurant'))).toBe(false);
    expect(categoryMatchesQuery(getBuiltInType('time'), toTokens('movie'))).toBe(false);
  });

  it('empty query matches everything; undefined category never matches', () => {
    expect(categoryMatchesQuery(getBuiltInType('movie'), [])).toBe(true);
    expect(categoryMatchesQuery(undefined, toTokens('movie'))).toBe(false);
  });
});

describe('categoryLabelMatchesQuery', () => {
  it('matches the label but NOT alias-only hits', () => {
    expect(categoryLabelMatchesQuery(getBuiltInType('movie'), toTokens('movie'))).toBe(true);
    // "movie" is only an alias on showtime, not its label → label match is false.
    expect(categoryLabelMatchesQuery(getBuiltInType('showtime'), toTokens('movie'))).toBe(false);
  });
});

describe('ranked category matches (label before alias)', () => {
  it('surfaces Showtime when typing Movie, with Movie ranked first', () => {
    const ranked = rankedCategoryMatches('movie');
    expect(ranked).toContain('movie');
    expect(ranked).toContain('showtime');
    expect(ranked.indexOf('movie')).toBeLessThan(ranked.indexOf('showtime'));
  });

  it('surfaces Movie when typing Showtime, with Showtime ranked first', () => {
    const ranked = rankedCategoryMatches('showtime');
    expect(ranked.indexOf('showtime')).toBeLessThan(ranked.indexOf('movie'));
  });
});
