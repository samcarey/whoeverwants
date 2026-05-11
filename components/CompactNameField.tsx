'use client';

import { useId } from 'react';

interface CompactNameFieldProps {
  name: string;
  setName: (name: string) => void;
  disabled?: boolean;
  maxLength?: number;
}

export default function CompactNameField({ name, setName, disabled = false, maxLength = 50 }: CompactNameFieldProps) {
  const id = useId();

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium mb-1">
        Your Name
      </label>
      <input
        type="text"
        id={id}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => setName(name.trim())}
        disabled={disabled}
        maxLength={maxLength}
        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
      />
    </div>
  );
}
