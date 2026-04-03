'use client';

import { useState, useRef, useEffect, useId } from 'react';

interface CompactNameFieldProps {
  name: string;
  setName: (name: string) => void;
  disabled?: boolean;
  maxLength?: number;
}

export default function CompactNameField({ name, setName, disabled = false, maxLength = 50 }: CompactNameFieldProps) {
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
    }
  }, [isEditing]);

  if (isEditing) {
    return (
      <div>
        <label htmlFor={id} className="block text-sm font-medium mb-1">
          Your Name{!name.trim() && <> <span className="font-normal">(optional)</span></>}
        </label>
        <input
          ref={inputRef}
          type="text"
          id={id}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => setIsEditing(false)}
          disabled={disabled}
          maxLength={maxLength}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
          placeholder="Enter your name..."
        />
      </div>
    );
  }

  if (name.trim()) {
    return (
      <button
        type="button"
        onClick={() => setIsEditing(true)}
        className="block text-sm font-medium text-left"
      >
        Your Name: <span className="font-normal text-blue-600 dark:text-blue-400">{name.trim()}</span>
      </button>
    );
  }

  return (
    <div className="text-sm font-medium">
      Your Name <span className="font-normal">(optional)</span>:{' '}
      <button
        type="button"
        onClick={() => setIsEditing(true)}
        className="font-normal text-blue-600 dark:text-blue-400"
      >
        Add
      </button>
    </div>
  );
}
