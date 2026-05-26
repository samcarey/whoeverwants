// Curated emoji set with keyword tags, used by the custom-category emoji
// picker (components/CategoryEmojiField.tsx). Self-contained — no dependency.
// `rankEmojiOptions(query)` floats emojis whose keywords match the typed
// category word(s) to the front, so picking "Board Game" surfaces 🎲 / 🎮
// first. Ordered roughly by general usefulness so the no-query default still
// reads well. Keep keywords lowercase.

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

/** Float emojis whose keywords match the query word(s) to the front; keep
 *  the curated order for non-matches (stable). Returns the full list always
 *  (sorted, not filtered) so the picker still shows every option. */
export function rankEmojiOptions(query: string): EmojiOption[] {
  const tokens = (query || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && t !== 'custom');
  if (tokens.length === 0) return EMOJI_OPTIONS;

  const scored = EMOJI_OPTIONS.map((opt, idx) => {
    let score = 0;
    for (const token of tokens) {
      let best = 0;
      for (const kw of opt.keywords) {
        if (kw === token) best = Math.max(best, 3);
        else if (kw.startsWith(token) || token.startsWith(kw)) best = Math.max(best, 2);
        else if (token.length >= 3 && kw.includes(token)) best = Math.max(best, 1);
        else if (kw.length >= 3 && token.includes(kw)) best = Math.max(best, 1);
      }
      score += best;
    }
    return { opt, score, idx };
  });
  scored.sort((a, b) => b.score - a.score || a.idx - b.idx);
  return scored.map((s) => s.opt);
}
