"use client";

import TimeCounterInput from './TimeCounterInput';

interface TimeMinMaxCounterProps {
  minValue: string | null; // HH:MM format
  maxValue: string | null; // HH:MM format
  onMinChange: (value: string | null) => void;
  onMaxChange: (value: string | null) => void;
  increment?: number; // minutes
  disabled?: boolean;
}

export default function TimeMinMaxCounter({
  minValue,
  maxValue,
  onMinChange,
  onMaxChange,
  increment = 15,
  disabled = false,
}: TimeMinMaxCounterProps) {
  return (
    <div className="flex justify-center items-center gap-3">
      <TimeCounterInput
        value={minValue}
        onChange={onMinChange}
        increment={increment}
        disabled={disabled}
      />
      <span className="text-xl text-gray-500 dark:text-gray-400">—</span>
      <TimeCounterInput
        value={maxValue}
        onChange={onMaxChange}
        increment={increment}
        disabled={disabled}
      />
    </div>
  );
}
