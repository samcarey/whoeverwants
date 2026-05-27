'use client';

// Emoji selector for a custom poll category. Rendered as a row inside the
// create-poll form's Category card (only when the category is custom). The
// row shows just the label + value input until focused; focusing it reveals
// the multi-line preset grid, sorted so emojis whose keywords match the typed
// custom category word surface first (see lib/emojiData.ts). Free-text entry
// is validated to be a single emoji (isEmoji); anything else is rejected with
// a hint. An empty value means "no custom emoji" — the app falls back to the
// generic question-type glyph (the value passed as `placeholder`).

import { useMemo, useState } from 'react';
import { rankEmojiOptions, isEmoji } from '@/lib/emojiData';

interface CategoryEmojiFieldProps {
  value: string;
  onChange: (emoji: string) => void;
  /** The custom category text — drives relevance-sorted suggestions. */
  categoryWord?: string;
  disabled?: boolean;
  /** Glyph shown faded when no emoji is chosen (the default fallback icon). */
  placeholder?: string;
}

export default function CategoryEmojiField({
  value,
  onChange,
  categoryWord = '',
  disabled = false,
  placeholder = '🗳️',
}: CategoryEmojiFieldProps) {
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState(false);
  const emojis = useMemo(
    () => rankEmojiOptions(categoryWord).map((o) => o.emoji),
    [categoryWord],
  );
  const trimmed = value.trim();

  // Free-text entry must be a single emoji. Empty clears; a valid emoji
  // commits; anything else (letters, words, multiple emoji) is rejected —
  // the controlled input snaps back and a hint shows.
  const handleInput = (raw: string) => {
    if (raw.trim() === '') {
      setError(false);
      onChange('');
      return;
    }
    if (isEmoji(raw)) {
      setError(false);
      onChange(raw.trim());
    } else {
      setError(true);
    }
  };

  const select = (emoji: string) => {
    setError(false);
    onChange(emoji);
  };

  const renderButton = (emoji: string) => {
    const selected = trimmed === emoji;
    return (
      <button
        key={emoji}
        type="button"
        // preventDefault keeps the input focused (and the grid expanded) so
        // the user can keep browsing/selecting without it collapsing.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => select(emoji)}
        disabled={disabled}
        aria-label={`Use ${emoji}`}
        aria-pressed={selected}
        className={`shrink-0 w-9 h-9 flex items-center justify-center rounded-lg text-xl select-none disabled:opacity-50 disabled:cursor-not-allowed ${
          selected
            ? 'bg-blue-100 dark:bg-blue-900/40 ring-1 ring-blue-400 dark:ring-blue-500'
            : 'bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600'
        }`}
      >
        {emoji}
      </button>
    );
  };

  return (
    <div className="py-2.5">
      <div className="flex items-center justify-between gap-3 h-7">
        <span className="text-base font-normal shrink-0">Emoji</span>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={value}
            onChange={(e) => handleInput(e.target.value)}
            onFocus={() => setExpanded(true)}
            onBlur={() => { setExpanded(false); setError(false); }}
            disabled={disabled}
            maxLength={20}
            aria-label="Category emoji"
            aria-invalid={error}
            placeholder={placeholder}
            className="w-12 text-xl text-center bg-transparent focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed placeholder:opacity-40"
          />
          {trimmed && !disabled && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => select('')}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-sm shrink-0"
              aria-label="Clear emoji"
            >
              ✕
            </button>
          )}
        </div>
      </div>
      {error && (
        <p className="text-xs text-red-500 dark:text-red-400 text-right pt-1">
          Enter a single emoji
        </p>
      )}
      {expanded && (
        <div
          // preventDefault on the container so tapping the gaps between
          // buttons doesn't blur the input and collapse the grid mid-pick.
          onMouseDown={(e) => e.preventDefault()}
          className="flex flex-wrap gap-1 pt-1 max-h-44 overflow-y-auto"
        >
          {emojis.map(renderButton)}
        </div>
      )}
    </div>
  );
}
