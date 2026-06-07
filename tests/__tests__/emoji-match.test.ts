import { describe, it, expect } from 'vitest';
import { bestEmojiMatch, rankEmojiOptions, splitLeadingEmoji } from '@/lib/emojiData';

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
