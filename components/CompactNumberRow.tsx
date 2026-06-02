'use client';

import { useState, useRef, useEffect, useId } from 'react';

interface CompactNumberRowProps {
  label: string;
  value: number;
  setValue: (value: number) => void;
  min?: number;
  disabled?: boolean;
}

/**
 * A single settings row: a label on the left and a tap-to-edit number on the
 * right (faded-grey value → inline numeric input). Shared by the create-poll
 * "Minimum Votes" and "Minimum Participants" fields, and the time-ballot
 * per-voter minimum, so the edit-toggle pattern lives in one place.
 *
 * The field can be backspaced to empty while editing (so typing a fresh number
 * doesn't require selecting/clearing the existing one first). The committed
 * `value` stays a valid number between edits — an empty or below-`min` draft is
 * auto-corrected UP to `min` when the edit commits (blur / Enter).
 */
export default function CompactNumberRow({ label, value, setValue, min = 1, disabled = false }: CompactNumberRowProps) {
  const [isEditing, setIsEditing] = useState(false);
  // Editing draft (string so it can be empty). Seeded from `value` on edit start.
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  const startEditing = () => {
    if (disabled) return;
    setDraft(String(value));
    setIsEditing(true);
  };

  // Commit the draft: empty / non-numeric / below-min all snap up to `min`.
  const commit = () => {
    const num = parseInt(draft, 10);
    setValue(Number.isNaN(num) || num < min ? min : num);
    setIsEditing(false);
  };

  return (
    <div className="flex items-center justify-between gap-3 h-12">
      <label htmlFor={id} className="text-base font-normal shrink-0">
        {label}
      </label>
      {isEditing ? (
        <input
          ref={inputRef}
          type="number"
          inputMode="numeric"
          id={id}
          min={min}
          value={draft}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '' || /^\d+$/.test(raw)) {
              setDraft(raw);
              // Live-commit only valid in-range values. While the draft is empty
              // or below `min` the committed value is left alone, so the field
              // can sit empty mid-edit without snapping back — the clamp runs on
              // commit (blur / Enter) instead.
              const num = parseInt(raw, 10);
              if (!Number.isNaN(num) && num >= min) setValue(num);
            }
          }}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
          disabled={disabled}
          className="w-16 text-base bg-transparent text-gray-500 dark:text-gray-500 text-right focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
        />
      ) : (
        <button
          type="button"
          onClick={startEditing}
          disabled={disabled}
          className="text-base font-normal text-gray-500 dark:text-gray-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {value}
        </button>
      )}
    </div>
  );
}
