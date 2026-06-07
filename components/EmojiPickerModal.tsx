'use client';

// Modal emoji picker for the poll's category emoji. Opened by tapping the
// emoji shown in front of the create-poll title preview. Same UI the old
// inline CategoryEmojiField row used: a single-emoji-validated text input
// above a relevance-sorted grid of preset emojis (see lib/emojiData.ts).
// An empty value means "no explicit emoji" — the caller falls back to the
// category's default glyph (rendered faded).

import { useEffect, useMemo, useState } from 'react';
import ModalPortal from './ModalPortal';
import { rankEmojiOptions, isEmoji } from '@/lib/emojiData';

interface EmojiPickerModalProps {
  open: boolean;
  value: string;
  onChange: (emoji: string) => void;
  onClose: () => void;
  /** The category text — drives relevance-sorted suggestions. */
  categoryWord?: string;
  /** Glyph shown faded in the input when no emoji is chosen. */
  placeholder?: string;
}

export default function EmojiPickerModal({
  open,
  value,
  onChange,
  onClose,
  categoryWord = '',
  placeholder = '🗳️',
}: EmojiPickerModalProps) {
  const [error, setError] = useState(false);
  const emojis = useMemo(
    () => rankEmojiOptions(categoryWord).map((o) => o.emoji),
    [categoryWord],
  );
  const trimmed = value.trim();

  // Escape closes the modal.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  // Free-text entry must be a single emoji. Empty clears; a valid emoji
  // commits; anything else is rejected and a hint shows.
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
    onClose();
  };

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-[80] flex items-center justify-center p-4"
        onClick={onClose}
      >
        <div className="absolute inset-0 bg-black/50" />
        <div
          className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-fit max-w-[calc(100vw-2rem)] p-4"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 className="text-base font-semibold">Choose an emoji</h2>
            <div className="flex items-center gap-2">
              {trimmed && (
                <button
                  type="button"
                  onClick={() => {
                    setError(false);
                    onChange('');
                  }}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-sm shrink-0"
                  aria-label="Clear emoji"
                >
                  ✕
                </button>
              )}
              <input
                type="text"
                value={value}
                onChange={(e) => handleInput(e.target.value)}
                maxLength={20}
                aria-label="Category emoji"
                aria-invalid={error}
                placeholder={placeholder}
                className="w-12 text-xl text-center bg-transparent border-b border-gray-300 dark:border-gray-600 focus:outline-none focus:border-blue-500 placeholder:opacity-40"
              />
            </div>
          </div>
          {error && (
            <p className="text-xs text-red-500 dark:text-red-400 text-right mb-2 -mt-1">
              Enter a single emoji
            </p>
          )}
          <div className="grid grid-cols-[repeat(7,2.25rem)] gap-1 max-h-64 overflow-y-auto">
            {emojis.map((emoji) => {
              const selected = trimmed === emoji;
              return (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => select(emoji)}
                  aria-label={`Use ${emoji}`}
                  aria-pressed={selected}
                  className={`shrink-0 w-9 h-9 flex items-center justify-center rounded-lg text-xl select-none ${
                    selected
                      ? 'bg-blue-100 dark:bg-blue-900/40 ring-1 ring-blue-400 dark:ring-blue-500'
                      : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  {emoji}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
