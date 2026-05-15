'use client';

import { useState, useRef, useEffect, useId } from 'react';
import SliderSwitch from './SliderSwitch';

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
    <>
      <div className="flex items-center justify-between gap-3 h-12">
        <label htmlFor={id} className="text-base font-normal shrink-0">
          Min Responses
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
      <div
        className="flex items-center justify-between gap-3 h-12 cursor-pointer"
        onClick={() => { if (!disabled) setShowPreliminary(!showPreliminary); }}
      >
        <span id={checkboxId} className="text-base font-normal">
          Share Results
        </span>
        <SliderSwitch
          checked={showPreliminary}
          onChange={setShowPreliminary}
          disabled={disabled}
          aria-labelledby={checkboxId}
        />
      </div>
    </>
  );
}
