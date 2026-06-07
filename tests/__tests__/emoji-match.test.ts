import { describe, it, expect } from 'vitest';
import { bestEmojiMatch, rankEmojiOptions, splitLeadingEmoji, EMOJI_OPTIONS } from '@/lib/emojiData';

describe('bestEmojiMatch', () => {
  it('returns null for empty / whitespace input', () => {
    expect(bestEmojiMatch('')).toBeNull();
    expect(bestEmojiMatch('   ')).toBeNull();
  });

  it('returns null when nothing in the set is described', () => {
    expect(bestEmojiMatch('xyzzy qwerty')).toBeNull();
    // sub-2-char and the noise word "custom" are dropped → no tokens
    expect(bestEmojiMatch('a')).toBeNull();
    expect(bestEmojiMatch('custom')).toBeNull();
  });

  it('matches a single keyword (exact)', () => {
    expect(bestEmojiMatch('pizza')).toBe('🍕');
    expect(bestEmojiMatch('beer')).toBe('🍺');
    // 🍿 (keyword 'movie') is curated before 🎬, so it wins the score tie —
    // same earliest-wins ordering as rankEmojiOptions.
    expect(bestEmojiMatch('movie')).toBe('🍿');
  });

  it('matches inside a phrase (yes/no title style text)', () => {
    expect(bestEmojiMatch('Should we get pizza tonight?')).toBe('🍕');
    expect(bestEmojiMatch('Who wants to go hiking this weekend')).toBe('🥾');
  });

  it('matches a custom category word', () => {
    expect(bestEmojiMatch('Board Game')).toBe('🎲');
    expect(bestEmojiMatch('Workout')).toBe('💪');
  });

  it('agrees with rankEmojiOptions top suggestion when matched', () => {
    for (const q of ['pizza', 'movie night', 'beach trip', 'coffee run']) {
      expect(bestEmojiMatch(q)).toBe(rankEmojiOptions(q)[0].emoji);
    }
  });

  // The curated list is small; matching is backed by the comprehensive CLDR
  // keyword index (lib/emojiKeywords.generated.ts) so words outside the curated
  // set still resolve — this is the "pie shows 🥧" fix.
  it('matches words outside the curated set via the CLDR index', () => {
    expect(bestEmojiMatch('pie')).toBe('🥧'); // 🥧 is NOT in EMOJI_OPTIONS
    expect(bestEmojiMatch('avocado')).toBe('🥑');
    expect(bestEmojiMatch('robot')).toBe('🤖');
    expect(bestEmojiMatch('cactus')).toBe('🌵');
  });

  it('comprehensive matches still agree with rankEmojiOptions[0]', () => {
    for (const q of ['pie', 'avocado', 'penguin', 'bowling']) {
      expect(bestEmojiMatch(q)).toBe(rankEmojiOptions(q)[0].emoji);
    }
  });

  it('surfaces a non-curated match at the top of the picker grid', () => {
    const ranked = rankEmojiOptions('pie');
    expect(ranked[0].emoji).toBe('🥧');
    // the curated browseable set still follows the matches
    expect(ranked.length).toBeGreaterThan(EMOJI_OPTIONS.length);
  });
});

describe('rankEmojiOptions', () => {
  it('returns the curated list unchanged with no query', () => {
    expect(rankEmojiOptions('')).toBe(EMOJI_OPTIONS);
    expect(rankEmojiOptions('   ')).toBe(EMOJI_OPTIONS);
  });

  it('never returns a bare (non-FE0F) variation-selector twin', () => {
    // Every emoji the matcher can surface must be the fully-qualified form, so
    // it renders as an emoji (not text) and dedupes against curated FE0F forms.
    for (const q of ['umbrella', 'ski', 'beach', 'heart', 'sun', 'snow']) {
      const top = bestEmojiMatch(q);
      if (top) {
        const stripped = top.replace(/[\uFE0E\uFE0F]/g, '');
        // If the glyph has a text-default base, it must carry FE0F.
        expect(top === stripped || top.includes('\uFE0F')).toBe(true);
      }
    }
  });
});

describe('splitLeadingEmoji', () => {
  it('peels a leading emoji and trims the gap', () => {
    expect(splitLeadingEmoji('🎲 board game')).toEqual({ emoji: '🎲', rest: 'board game' });
    expect(splitLeadingEmoji('🍕pizza or tacos')).toEqual({ emoji: '🍕', rest: 'pizza or tacos' });
  });

  it('handles multi-codepoint emoji (ZWJ, flags, keycaps) as one unit', () => {
    expect(splitLeadingEmoji('👨‍👩‍👧 family dinner')).toEqual({ emoji: '👨‍👩‍👧', rest: 'family dinner' });
    expect(splitLeadingEmoji('🇺🇸 election')).toEqual({ emoji: '🇺🇸', rest: 'election' });
    expect(splitLeadingEmoji('5️⃣ rounds')).toEqual({ emoji: '5️⃣', rest: 'rounds' });
  });

  it('returns the input unchanged when there is no leading emoji', () => {
    expect(splitLeadingEmoji('board game')).toEqual({ emoji: null, rest: 'board game' });
    expect(splitLeadingEmoji('movie 🎬 night')).toEqual({ emoji: null, rest: 'movie 🎬 night' });
    expect(splitLeadingEmoji('')).toEqual({ emoji: null, rest: '' });
  });

  it('handles an emoji-only input (empty rest)', () => {
    expect(splitLeadingEmoji('🎲')).toEqual({ emoji: '🎲', rest: '' });
  });
});
