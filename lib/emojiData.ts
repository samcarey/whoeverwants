// Curated emoji set with keyword tags, used by the poll-category emoji
// picker (components/EmojiPickerModal.tsx). The curated list defines the
// picker grid's default (no-query) order — emojis are arranged roughly by
// general usefulness — AND gives a small set of hand-tuned, high-priority
// keywords. Keep keywords lowercase.
//
// MATCHING is backed by BOTH this curated list AND a comprehensive,
// auto-generated keyword index (lib/emojiKeywords.generated.ts, sourced from
// the Unicode CLDR annotations — the same data iOS emoji search uses). So
// typing "pie" surfaces 🥧 even though 🥧 isn't curated. The curated list owns
// its emojis (intentional keywords + hand-tuned tie-break order); the
// comprehensive index only fills emojis the curated list lacks — it is NOT
// merged onto curated entries (that would shift the curated ordering). See
// `rankEmojiOptions` / `bestEmojiMatch`. Regenerate the index with
// `node scripts/gen-emoji-keywords.mjs`.

import { EMOJI_KEYWORD_INDEX } from './emojiKeywords.generated';

export interface EmojiOption {
  emoji: string;
  keywords: string[];
}

export const EMOJI_OPTIONS: EmojiOption[] = [
  // Generic / common
  { emoji: '🗳️', keywords: ['vote', 'ballot', 'poll', 'election', 'choose'] },
  { emoji: '✅', keywords: ['check', 'done', 'yes', 'approve', 'task'] },
  { emoji: '⭐', keywords: ['star', 'favorite', 'rating', 'best'] },
  { emoji: '❤️', keywords: ['love', 'heart', 'favorite', 'like'] },
  { emoji: '🔥', keywords: ['fire', 'hot', 'lit', 'trending'] },
  { emoji: '🎉', keywords: ['party', 'celebration', 'fun', 'event'] },
  { emoji: '🎁', keywords: ['gift', 'present', 'birthday', 'secret', 'santa'] },
  { emoji: '💡', keywords: ['idea', 'light', 'bulb', 'suggestion', 'brainstorm'] },
  { emoji: '🧠', keywords: ['brain', 'smart', 'idea', 'mind', 'trivia'] },
  { emoji: '🏆', keywords: ['trophy', 'win', 'champion', 'award', 'winner'] },
  { emoji: '🎯', keywords: ['dart', 'target', 'goal', 'aim', 'game'] },

  // Food
  { emoji: '🍽️', keywords: ['dinner', 'restaurant', 'food', 'plate', 'eat', 'dining', 'meal'] },
  { emoji: '🍕', keywords: ['pizza', 'food', 'italian', 'slice'] },
  { emoji: '🍔', keywords: ['burger', 'food', 'hamburger', 'beef', 'lunch'] },
  { emoji: '🌮', keywords: ['taco', 'mexican', 'food'] },
  { emoji: '🌯', keywords: ['burrito', 'wrap', 'mexican', 'food'] },
  { emoji: '🍜', keywords: ['ramen', 'noodles', 'soup', 'food', 'asian'] },
  { emoji: '🍣', keywords: ['sushi', 'japanese', 'fish', 'food'] },
  { emoji: '🍝', keywords: ['pasta', 'spaghetti', 'italian', 'food', 'noodles'] },
  { emoji: '🥗', keywords: ['salad', 'healthy', 'food', 'greens', 'lunch'] },
  { emoji: '🍲', keywords: ['stew', 'soup', 'hotpot', 'food'] },
  { emoji: '🍛', keywords: ['curry', 'rice', 'food', 'indian'] },
  { emoji: '🥪', keywords: ['sandwich', 'lunch', 'food'] },
  { emoji: '🌭', keywords: ['hotdog', 'food', 'snack'] },
  { emoji: '🍟', keywords: ['fries', 'food', 'snack'] },
  { emoji: '🥘', keywords: ['paella', 'food', 'pan', 'dinner'] },
  { emoji: '🍱', keywords: ['bento', 'lunch', 'food', 'japanese'] },
  { emoji: '🥩', keywords: ['steak', 'meat', 'food', 'dinner', 'bbq', 'barbecue'] },
  { emoji: '🍳', keywords: ['breakfast', 'egg', 'cooking', 'brunch', 'food'] },
  { emoji: '🥞', keywords: ['pancakes', 'breakfast', 'brunch', 'food'] },
  { emoji: '🍦', keywords: ['icecream', 'dessert', 'sweet'] },
  { emoji: '🍰', keywords: ['cake', 'dessert', 'sweet', 'slice'] },
  { emoji: '🎂', keywords: ['birthday', 'cake', 'party', 'celebration'] },
  { emoji: '🧁', keywords: ['cupcake', 'dessert', 'sweet', 'bake'] },
  { emoji: '🍪', keywords: ['cookie', 'dessert', 'snack', 'sweet', 'bake'] },
  { emoji: '🍩', keywords: ['donut', 'dessert', 'sweet'] },
  { emoji: '🍫', keywords: ['chocolate', 'candy', 'sweet'] },
  { emoji: '🍿', keywords: ['popcorn', 'movie', 'snack'] },

  // Drinks
  { emoji: '🍺', keywords: ['beer', 'drink', 'bar', 'pub', 'brew'] },
  { emoji: '🍻', keywords: ['beers', 'cheers', 'drink', 'bar', 'happyhour'] },
  { emoji: '🍷', keywords: ['wine', 'drink', 'bar', 'vino'] },
  { emoji: '🍸', keywords: ['cocktail', 'drink', 'bar', 'martini'] },
  { emoji: '🍹', keywords: ['cocktail', 'tropical', 'drink'] },
  { emoji: '🥂', keywords: ['champagne', 'celebration', 'cheers', 'drink', 'toast'] },
  { emoji: '☕', keywords: ['coffee', 'cafe', 'drink', 'espresso', 'morning'] },
  { emoji: '🍵', keywords: ['tea', 'drink', 'matcha'] },
  { emoji: '🧋', keywords: ['boba', 'bubbletea', 'drink', 'milktea'] },
  { emoji: '🥤', keywords: ['soda', 'drink', 'cup', 'pop'] },

  // Games & tabletop
  { emoji: '🎲', keywords: ['dice', 'game', 'board', 'tabletop', 'random', 'boardgame'] },
  { emoji: '🎮', keywords: ['game', 'video', 'controller', 'gaming', 'videogame'] },
  { emoji: '🕹️', keywords: ['joystick', 'arcade', 'game', 'retro'] },
  { emoji: '🃏', keywords: ['card', 'joker', 'game', 'poker', 'cards'] },
  { emoji: '♟️', keywords: ['chess', 'game', 'strategy'] },
  { emoji: '🧩', keywords: ['puzzle', 'jigsaw', 'game'] },
  { emoji: '🎱', keywords: ['pool', 'billiards', 'game'] },
  { emoji: '🎰', keywords: ['slot', 'casino', 'gamble', 'game'] },

  // Sports & fitness
  { emoji: '⚽', keywords: ['soccer', 'football', 'sport', 'game'] },
  { emoji: '🏀', keywords: ['basketball', 'sport', 'hoops'] },
  { emoji: '🏈', keywords: ['football', 'nfl', 'sport'] },
  { emoji: '⚾', keywords: ['baseball', 'sport'] },
  { emoji: '🎾', keywords: ['tennis', 'sport'] },
  { emoji: '🏐', keywords: ['volleyball', 'sport'] },
  { emoji: '🏓', keywords: ['pingpong', 'tabletennis', 'sport'] },
  { emoji: '🥊', keywords: ['boxing', 'fight', 'sport'] },
  { emoji: '🏊', keywords: ['swimming', 'swim', 'sport', 'pool'] },
  { emoji: '🏃', keywords: ['running', 'run', 'sport', 'race', 'jog'] },
  { emoji: '🚴', keywords: ['cycling', 'bike', 'sport', 'ride'] },
  { emoji: '🧗', keywords: ['climbing', 'rock', 'sport', 'bouldering'] },
  { emoji: '⛳', keywords: ['golf', 'sport'] },
  { emoji: '🎽', keywords: ['marathon', 'race', 'run', 'sport'] },
  { emoji: '💪', keywords: ['workout', 'gym', 'strong', 'fitness', 'exercise', 'lift'] },
  { emoji: '🧘', keywords: ['yoga', 'meditation', 'relax', 'wellness'] },
  { emoji: '⛷️', keywords: ['skiing', 'ski', 'snow', 'sport'] },
  { emoji: '🏂', keywords: ['snowboard', 'snow', 'sport'] },

  // Music & arts
  { emoji: '🎵', keywords: ['music', 'song', 'note', 'tune', 'playlist'] },
  { emoji: '🎤', keywords: ['microphone', 'karaoke', 'sing', 'music'] },
  { emoji: '🎸', keywords: ['guitar', 'music', 'band', 'rock'] },
  { emoji: '🎹', keywords: ['piano', 'music', 'keys'] },
  { emoji: '🥁', keywords: ['drums', 'music', 'band'] },
  { emoji: '🎧', keywords: ['headphones', 'music', 'listen', 'podcast'] },
  { emoji: '🎬', keywords: ['movie', 'film', 'cinema'] },
  { emoji: '🎭', keywords: ['theater', 'drama', 'play', 'mask'] },
  { emoji: '🎨', keywords: ['art', 'paint', 'draw', 'creative', 'craft'] },
  { emoji: '📷', keywords: ['camera', 'photo', 'picture'] },
  { emoji: '📸', keywords: ['photo', 'camera', 'picture', 'selfie'] },
  { emoji: '💃', keywords: ['dance', 'dancing', 'party'] },
  { emoji: '🎟️', keywords: ['ticket', 'event', 'admission', 'show'] },
  { emoji: '🎈', keywords: ['balloon', 'party', 'birthday'] },

  // Travel & places
  { emoji: '✈️', keywords: ['flight', 'travel', 'plane', 'trip', 'vacation', 'fly'] },
  { emoji: '🏖️', keywords: ['beach', 'vacation', 'summer', 'travel'] },
  { emoji: '🏝️', keywords: ['island', 'beach', 'tropical', 'vacation'] },
  { emoji: '🏕️', keywords: ['camping', 'campsite', 'outdoors', 'tent'] },
  { emoji: '🏔️', keywords: ['mountain', 'snow', 'peak', 'alps'] },
  { emoji: '🥾', keywords: ['hike', 'hiking', 'trail', 'boots', 'walk', 'trek'] },
  { emoji: '🗺️', keywords: ['map', 'travel', 'explore', 'route'] },
  { emoji: '🧳', keywords: ['luggage', 'travel', 'suitcase', 'trip', 'packing'] },
  { emoji: '🏨', keywords: ['hotel', 'stay', 'travel', 'lodging', 'airbnb'] },
  { emoji: '🏠', keywords: ['home', 'house', 'place'] },
  { emoji: '🏡', keywords: ['house', 'home', 'garden'] },
  { emoji: '🏢', keywords: ['office', 'building', 'work'] },
  { emoji: '🏰', keywords: ['castle', 'palace'] },
  { emoji: '🎡', keywords: ['ferriswheel', 'fair', 'carnival'] },
  { emoji: '🎢', keywords: ['rollercoaster', 'themepark', 'ride', 'amusement'] },
  { emoji: '🛒', keywords: ['shopping', 'store', 'grocery', 'cart', 'groceries'] },
  { emoji: '🛍️', keywords: ['shopping', 'bags', 'mall', 'shop'] },

  // Transport
  { emoji: '🚗', keywords: ['car', 'drive', 'ride', 'auto', 'roadtrip'] },
  { emoji: '🚕', keywords: ['taxi', 'cab', 'ride', 'uber'] },
  { emoji: '🚌', keywords: ['bus', 'transit'] },
  { emoji: '🚆', keywords: ['train', 'rail', 'transit'] },
  { emoji: '🚲', keywords: ['bike', 'bicycle', 'cycle'] },
  { emoji: '⛵', keywords: ['sailboat', 'sailing', 'boat'] },
  { emoji: '🛳️', keywords: ['cruise', 'ship', 'boat'] },
  { emoji: '🚀', keywords: ['rocket', 'space', 'launch'] },

  // Animals / pets
  { emoji: '🐶', keywords: ['dog', 'puppy', 'pet'] },
  { emoji: '🐱', keywords: ['cat', 'kitten', 'pet'] },
  { emoji: '🐰', keywords: ['rabbit', 'bunny', 'pet'] },
  { emoji: '🐠', keywords: ['fish', 'aquarium', 'pet'] },
  { emoji: '🦄', keywords: ['unicorn', 'magic'] },
  { emoji: '🐉', keywords: ['dragon'] },

  // Nature / weather / seasons
  { emoji: '🌳', keywords: ['tree', 'park', 'nature', 'outdoors'] },
  { emoji: '🌲', keywords: ['tree', 'forest', 'nature', 'christmas'] },
  { emoji: '🌸', keywords: ['flower', 'blossom', 'spring'] },
  { emoji: '☀️', keywords: ['sun', 'sunny', 'summer', 'weather'] },
  { emoji: '🌧️', keywords: ['rain', 'weather'] },
  { emoji: '❄️', keywords: ['snow', 'winter', 'cold', 'weather'] },
  { emoji: '🌊', keywords: ['wave', 'ocean', 'water', 'sea', 'surf'] },
  { emoji: '🌈', keywords: ['rainbow', 'pride', 'color'] },
  { emoji: '🎃', keywords: ['halloween', 'pumpkin', 'spooky'] },
  { emoji: '🎄', keywords: ['christmas', 'tree', 'holiday', 'xmas'] },

  // Work / study / home / misc
  { emoji: '💼', keywords: ['work', 'business', 'job', 'office', 'meeting'] },
  { emoji: '📚', keywords: ['books', 'reading', 'study', 'library', 'bookclub'] },
  { emoji: '📖', keywords: ['book', 'read', 'story', 'novel'] },
  { emoji: '📝', keywords: ['notes', 'memo', 'write', 'list', 'todo'] },
  { emoji: '📅', keywords: ['calendar', 'date', 'schedule', 'when', 'plan'] },
  { emoji: '⏰', keywords: ['alarm', 'time', 'clock', 'when'] },
  { emoji: '💰', keywords: ['money', 'cash', 'budget', 'cost'] },
  { emoji: '🎓', keywords: ['graduation', 'school', 'education', 'degree', 'grad'] },
  { emoji: '🏫', keywords: ['school', 'education', 'class'] },
  { emoji: '💻', keywords: ['laptop', 'computer', 'tech', 'work', 'code'] },
  { emoji: '📱', keywords: ['phone', 'mobile', 'tech', 'app'] },
  { emoji: '🛏️', keywords: ['bed', 'sleep', 'room'] },
  { emoji: '🛋️', keywords: ['couch', 'sofa', 'livingroom', 'furniture'] },
  { emoji: '🧹', keywords: ['cleaning', 'chores', 'broom', 'clean'] },
  { emoji: '🛠️', keywords: ['tools', 'repair', 'fix', 'diy', 'build'] },
  { emoji: '🍀', keywords: ['luck', 'clover', 'lucky'] },
  { emoji: '🐝', keywords: ['bee', 'spelling'] },
];

// Lowercase the query and split into ≥2-char tokens, dropping the noise word
// "custom" (the create-poll draft category for un-typed customs).
function tokenizeEmojiQuery(query: string): string[] {
  return (query || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && t !== 'custom');
}

// Keyword-match score for one emoji against the tokenized query
// (exact > prefix > length-4 substring). 0 = no keyword matched.
function scoreEmojiOption(tokens: string[], opt: EmojiOption): number {
  let score = 0;
  for (const token of tokens) {
    let best = 0;
    for (const kw of opt.keywords) {
      if (kw === token) best = Math.max(best, 3);
      else if (kw.startsWith(token) || token.startsWith(kw)) best = Math.max(best, 2);
      // Substring matches use a length-4 floor so a short keyword like "pet"
      // doesn't surface pet emojis for "competition" (and vice versa).
      else if (token.length >= 4 && kw.includes(token)) best = Math.max(best, 1);
      else if (kw.length >= 4 && token.includes(kw)) best = Math.max(best, 1);
    }
    score += best;
  }
  return score;
}

// A match candidate, pooled from the curated list + the comprehensive index.
// `curated` + `order` drive the tiebreak: curated emojis rank ahead of
// comprehensive-only ones on equal scores, then by their position within each
// pool (so curated keeps its hand-tuned ordering and comprehensive keeps CLDR
// order). Built once, lazily.
interface MatchCandidate extends EmojiOption {
  curated: boolean;
  order: number;
}

// Strip variation selectors so 🏖️ (curated, +FE0F) and a bare 🏖 collapse to
// one key — the generator already FE0F-qualifies, this is belt-and-suspenders.
const stripVariationSelectors = (e: string): string => e.replace(/[\uFE0E\uFE0F]/g, '');

let _candidates: MatchCandidate[] | null = null;
function matchCandidates(): MatchCandidate[] {
  if (_candidates) return _candidates;
  // The curated list owns its emojis entirely — its keywords are intentional
  // and its tie-break order is hand-tuned, so we DON'T merge comprehensive
  // keywords onto curated entries (that would shift the curated ordering, e.g.
  // 📷 stealing "trip" from 🏖️). The comprehensive index only adds emojis the
  // curated list doesn't already have, extending COVERAGE without disturbing
  // the curated behavior.
  const curatedKeys = new Set<string>();
  const list: MatchCandidate[] = [];
  EMOJI_OPTIONS.forEach((opt, idx) => {
    curatedKeys.add(stripVariationSelectors(opt.emoji));
    list.push({ emoji: opt.emoji, keywords: opt.keywords, curated: true, order: idx });
  });
  EMOJI_KEYWORD_INDEX.forEach(([emoji, kw], idx) => {
    if (curatedKeys.has(stripVariationSelectors(emoji))) return; // curated owns it
    list.push({ emoji, keywords: kw.split(' '), curated: false, order: idx });
  });
  _candidates = list;
  return list;
}

// Score every candidate against the tokens, drop non-matches, and sort by
// score then the curated-first / in-pool-order tiebreak. Single source of the
// match ordering so `rankEmojiOptions` and `bestEmojiMatch` can't drift.
function rankedMatches(tokens: string[]): { cand: MatchCandidate; score: number }[] {
  return matchCandidates()
    .map((cand) => ({ cand, score: scoreEmojiOption(tokens, cand) }))
    .filter((s) => s.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.cand.curated === b.cand.curated ? 0 : a.cand.curated ? -1 : 1) ||
        a.cand.order - b.cand.order,
    );
}

/** Rank emojis for the picker grid. With a query, matching emojis (across the
 *  curated list AND the comprehensive index) lead, best first; then the
 *  curated remainder follows in its default order so the grid stays a
 *  browseable set. With no query, returns the curated list unchanged (the
 *  hand-ordered default grid). */
export function rankEmojiOptions(query: string): EmojiOption[] {
  const tokens = tokenizeEmojiQuery(query);
  if (tokens.length === 0) return EMOJI_OPTIONS;

  const matches = rankedMatches(tokens).map((s) => ({
    emoji: s.cand.emoji,
    keywords: s.cand.keywords,
  }));
  const matched = new Set(matches.map((m) => m.emoji));
  const rest = EMOJI_OPTIONS.filter((o) => !matched.has(o.emoji));
  return [...matches, ...rest];
}

/** The single best-matching emoji for a free-text query, or null when no
 *  keyword matched anywhere. Always equals `rankEmojiOptions(query)[0]` when a
 *  match exists (shared ordering), so the auto-picked icon agrees with the
 *  custom-category picker's top suggestion. */
export function bestEmojiMatch(query: string): string | null {
  const tokens = tokenizeEmojiQuery(query);
  if (tokens.length === 0) return null;
  const ranked = rankedMatches(tokens);
  return ranked.length > 0 ? ranked[0].cand.emoji : null;
}

// Whole string must consist only of emoji-related code points: pictographs,
// skin-tone modifiers, ZWJ (200D), variation selectors (FE0F/FE0E), keycap
// combining mark (20E3), regional-indicator flag letters, and keycap bases
// (# * 0-9).
const EMOJI_ONLY =
  /^[\p{Extended_Pictographic}\p{Emoji_Modifier}\u200D\uFE0F\uFE0E\u20E3\u{1F1E6}-\u{1F1FF}#*0-9]+$/u;
// ...AND carry at least one real pictographic / flag / keycap mark, so bare
// digits ("5") or symbols ("#") — allowed above only as keycap bases — don't
// pass on their own.
const HAS_PICTOGRAPHIC = /[\p{Extended_Pictographic}\u20E3\u{1F1E6}-\u{1F1FF}]/u;

// Lazily-built grapheme segmenter (the granularity option is constant, so
// there's no reason to reconstruct it per keystroke). null = unsupported.
let _segmenter: Intl.Segmenter | null | undefined;
function graphemeSegmenter(): Intl.Segmenter | null {
  if (_segmenter === undefined) {
    try {
      _segmenter =
        typeof Intl !== 'undefined' && (Intl as any).Segmenter
          ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
          : null;
    } catch {
      _segmenter = null;
    }
  }
  return _segmenter;
}

/** If `s` begins with a single emoji grapheme, return that emoji plus the
 *  remaining text (leading whitespace trimmed); otherwise `{ emoji: null, rest: s }`.
 *  Uses the grapheme segmenter so multi-codepoint emoji (ZWJ sequences, flags,
 *  skin tones, keycaps) are split off as one unit. Degrades to "no emoji" when
 *  the segmenter is unavailable (very old engine). */
export function splitLeadingEmoji(s: string): { emoji: string | null; rest: string } {
  const seg = graphemeSegmenter();
  if (!seg) return { emoji: null, rest: s };
  for (const { segment } of seg.segment(s)) {
    if (!isEmoji(segment)) return { emoji: null, rest: s };
    return { emoji: segment, rest: s.slice(segment.length).trimStart() };
  }
  return { emoji: null, rest: s };
}

/** True when `s` is a single emoji (incl. ZWJ sequences, skin-tone modifiers,
 *  flags, keycaps). Rejects letters, words, and multi-emoji strings. */
export function isEmoji(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  if (!EMOJI_ONLY.test(t) || !HAS_PICTOGRAPHIC.test(t)) return false;
  const seg = graphemeSegmenter();
  if (seg) {
    let count = 0;
    for (const _ of seg.segment(t)) {
      count++;
      if (count > 1) return false;
    }
    return count === 1;
  }
  // Segmenter unsupported (very old engine) — best-effort: the regex checks
  // above already guarantee emoji-only content; we can't cheaply count
  // grapheme clusters, so a multi-emoji string would pass here. The server
  // length cap (validate_category_icon) bounds the abuse.
  return true;
}
