'use client';

import { useState, useRef, useEffect, useId } from 'react';

interface CompactMinParticipantsFieldProps {
  value: number;
  setValue: (value: number) => void;
  disabled?: boolean;
}

/**
 * Single settings row "Minimum Participants" for time polls — sits where
 * "Minimum Votes" (CompactMinResponsesField) sits for other poll types.
 * A time slot counts only if at least this many people are available for it;
 * if no slot clears the bar at the availability cutoff the event is cancelled.
 * Mirrors the inline tap-to-edit number row of CompactMinResponsesField.
 */
export default function CompactMinParticipantsField({ value, setValue, disabled = false }: CompactMinParticipantsFieldProps) {
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  return (
    <div className="flex items-center justify-between gap-3 h-12">
      <label htmlFor={id} className="text-base font-normal shrink-0">
        Minimum Participants
      </label>
      {isEditing ? (
        <input
          ref={inputRef}
          type="number"
          id={id}
          min={1}
          value={value}
          onChange={(e) => {
            const num = parseInt(e.target.value, 10);
            if (!isNaN(num) && num >= 1) setValue(num);
          }}
          onBlur={() => setIsEditing(false)}
          onKeyDown={(e) => { if (e.key === 'Enter') setIsEditing(false); }}
          disabled={disabled}
          className="w-16 text-base bg-transparent text-gray-500 dark:text-gray-500 text-right focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
        />
      ) : (
        <button
          type="button"
          onClick={() => setIsEditing(true)}
          disabled={disabled}
          className="text-base font-normal text-gray-500 dark:text-gray-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {value}
        </button>
      )}
    </div>
  );
}
