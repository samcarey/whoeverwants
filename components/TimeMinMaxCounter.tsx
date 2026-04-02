"use client";

import TimeCounterInput from './TimeCounterInput';

interface TimeMinMaxCounterProps {
  minValue: string | null; // HH:MM format
  maxValue: string | null; // HH:MM format
  onMinChange: (value: string | null) => void;
  onMaxChange: (value: string | null) => void;
  increment?: number; // minutes
  disabled?: boolean;
  constraintMin?: string; // HH:MM 24h — poll window lower bound
  constraintMax?: string; // HH:MM 24h — poll window upper bound
}

export default function TimeMinMaxCounter({
  minValue,
  maxValue,
  onMinChange,
  onMaxChange,
  increment = 15,
  disabled = false,
  constraintMin,
  constraintMax,
}: TimeMinMaxCounterProps) {
  return (
    <div className="flex justify-center items-center gap-1.5">
      <TimeCounterInput
        value={minValue}
        onChange={onMinChange}
        increment={increment}
        disabled={disabled}
        constraintMin={constraintMin}
        constraintMax={constraintMax}
        siblingValue={maxValue}
        role="min"
      />
      <span className="text-base text-gray-400 dark:text-gray-500">–</span>
      <TimeCounterInput
        value={maxValue}
        onChange={onMaxChange}
        increment={increment}
        disabled={disabled}
        constraintMin={constraintMin}
        constraintMax={constraintMax}
        siblingValue={minValue}
        role="max"
      />
    </div>
  );
}
