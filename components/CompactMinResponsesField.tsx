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

  if (isEditing) {
    return (
      <div>
        <label htmlFor={id} className="block text-sm font-medium mb-1">
          Min Responses
        </label>
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
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
        />
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between">
      <button
        type="button"
        onClick={() => setIsEditing(true)}
        className="text-sm font-medium text-left"
      >
        Min Responses: <span className="font-normal text-blue-600 dark:text-blue-400">{value}</span>
      </button>
      <label htmlFor={checkboxId} className="flex items-center gap-1.5 cursor-pointer">
        <span className="text-xs text-gray-500 dark:text-gray-400">then show results</span>
        <input
          type="checkbox"
          id={checkboxId}
          checked={showPreliminary}
          onChange={(e) => setShowPreliminary(e.target.checked)}
          disabled={disabled}
          className="w-3.5 h-3.5 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        />
      </label>
    </div>
  );
}
