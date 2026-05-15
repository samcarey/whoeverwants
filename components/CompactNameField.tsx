'use client';

import { useId } from 'react';
import { enterAdvancesFocus } from '@/lib/formNavigation';

interface CompactNameFieldProps {
  name: string;
  setName: (name: string) => void;
  disabled?: boolean;
  maxLength?: number;
}

export default function CompactNameField({ name, setName, disabled = false, maxLength = 50 }: CompactNameFieldProps) {
  const id = useId();

  return (
    <div className="flex items-center justify-between gap-3 h-12">
      <label htmlFor={id} className="text-base font-normal shrink-0">
        Your Name
      </label>
      <input
        id={id}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => setName(name.trim())}
        onKeyDown={enterAdvancesFocus}
        disabled={disabled}
        maxLength={maxLength}
        className="flex-1 min-w-0 text-base bg-transparent text-gray-600 dark:text-gray-400 text-right focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
      />
    </div>
  );
}
