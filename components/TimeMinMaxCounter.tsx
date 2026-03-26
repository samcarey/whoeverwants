"use client";

import TimeCounterInput from './TimeCounterInput';

interface TimeMinMaxCounterProps {
  minValue: string | null; // HH:MM format
  maxValue: string | null; // HH:MM format
  onMinChange: (value: string | null) => void;
  onMaxChange: (value: string | null) => void;
  increment?: number; // minutes
  disabled?: boolean;
  absoluteMin?: string; // HH:MM - hard lower bound (voter can't go earlier)
  absoluteMax?: string; // HH:MM - hard upper bound (voter can't go later)
}

export default function TimeMinMaxCounter({
  minValue,
  maxValue,
  onMinChange,
  onMaxChange,
  increment = 15,
  disabled = false,
  absoluteMin,
  absoluteMax,
}: TimeMinMaxCounterProps) {
  return (
    <div className="flex justify-center items-center gap-3">
      <TimeCounterInput
        value={minValue}
        onChange={onMinChange}
        increment={increment}
        min={absoluteMin}
        max={maxValue || undefined}
        disabled={disabled}
      />
      <span className="text-xl text-gray-500 dark:text-gray-400">—</span>
      <TimeCounterInput
        value={maxValue}
        onChange={onMaxChange}
        increment={increment}
        min={minValue || undefined}
        max={absoluteMax}
        disabled={disabled}
      />
    </div>
  );
}
