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
 * "Minimum Votes" and "Minimum Participants" fields so the edit-toggle pattern
 * lives in one place.
 */
export default function CompactNumberRow({ label, value, setValue, min = 1, disabled = false }: CompactNumberRowProps) {
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
        {label}
      </label>
      {isEditing ? (
        <input
          ref={inputRef}
          type="number"
          id={id}
          min={min}
          value={value}
          onChange={(e) => {
            const num = parseInt(e.target.value, 10);
            if (!isNaN(num) && num >= min) setValue(num);
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
