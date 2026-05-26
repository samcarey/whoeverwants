'use client';

// Emoji selector for a custom poll category. Rendered as a row inside the
// create-poll form's Category card (only when the category is custom). The
// user can tap a preset or type/paste any emoji into the field. An empty
// value means "no custom emoji" — the app falls back to the generic
// question-type glyph (the value passed as `placeholder`).

interface CategoryEmojiFieldProps {
  value: string;
  onChange: (emoji: string) => void;
  disabled?: boolean;
  /** Glyph shown faded when no emoji is chosen (the default fallback icon). */
  placeholder?: string;
}

// Curated common-category emojis for quick selection. The free-text input
// covers anything not in this strip.
const PRESET_EMOJIS = [
  '🗳️', '✅', '⭐', '🎯', '🎉', '🍕', '🍻', '☕',
  '🏈', '⚽', '🎵', '📚', '🐶', '🐱', '✈️', '🏠',
  '💼', '💡', '🎂', '🛒', '🎁', '💪', '🌮', '🍦',
  '🎲', '🚗', '🏖️', '🎨', '📸', '🔥', '❤️', '🏆',
];

export default function CategoryEmojiField({
  value,
  onChange,
  disabled = false,
  placeholder = '🗳️',
}: CategoryEmojiFieldProps) {
  return (
    <div className="py-2.5">
      <div className="flex items-center justify-between gap-3 h-7">
        <span className="text-base font-normal shrink-0">Emoji</span>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            maxLength={12}
            aria-label="Category emoji"
            placeholder={placeholder}
            className="w-12 text-xl text-center bg-transparent focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed placeholder:opacity-40"
          />
          {value.trim() && !disabled && (
            <button
              type="button"
              onClick={() => onChange('')}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-sm shrink-0"
              aria-label="Clear emoji"
            >
              ✕
            </button>
          )}
        </div>
      </div>
      <div className="flex gap-1 overflow-x-auto pt-1 -mx-1 px-1">
        {PRESET_EMOJIS.map((emoji) => {
          const selected = value.trim() === emoji;
          return (
            <button
              key={emoji}
              type="button"
              onClick={() => onChange(emoji)}
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
        })}
      </div>
    </div>
  );
}
