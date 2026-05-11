'use client';

import { useState, useRef, useEffect, useId } from 'react';

interface CompactMinResponsesFieldProps {
  value: number;
  setValue: (value: number) => void;
  showPreliminary: boolean;
  setShowPreliminary: (value: boolean) => void;
  disabled?: boolean;
}

export default function CompactMinResponsesField({ value, setValue, showPreliminary, setShowPreliminary, disabled = false }: CompactMinResponsesFieldProps) {
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const checkboxId = useId();

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  return (
    <div className="flex items-center justify-between gap-3">
      <label htmlFor={isEditing ? id : checkboxId} className="text-sm font-medium shrink-0">
        Min Responses{' '}
        <span className="font-normal text-xs text-gray-500 dark:text-gray-400">then show results</span>
      </label>
      <div className="flex items-center gap-3">
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
            className="w-16 text-sm bg-transparent text-blue-600 dark:text-blue-400 text-right focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
          />
        ) : (
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            disabled={disabled}
            className="text-sm font-normal text-blue-600 dark:text-blue-400 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {value}
          </button>
        )}
        <input
          type="checkbox"
          id={checkboxId}
          checked={showPreliminary}
          onChange={(e) => setShowPreliminary(e.target.checked)}
          disabled={disabled}
          className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        />
      </div>
    </div>
  );
}
