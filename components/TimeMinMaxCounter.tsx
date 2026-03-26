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
  disabled = false
}: TimeMinMaxCounterProps) {
  return (
    <div>
      <div className="flex justify-center items-center">
        <div className="flex items-center gap-3">
          {/* Min counter - arrows on left */}
          <TimeCounterInput
            value={minValue}
            onChange={onMinChange}
            increment={increment}
            max={maxValue || undefined}
            disabled={disabled}
            arrowPosition="left"
          />

          {/* Hyphen separator */}
          <span className="text-xl text-gray-500 dark:text-gray-400">—</span>

          {/* Max counter - arrows on right */}
          <TimeCounterInput
            value={maxValue}
            onChange={onMaxChange}
            increment={increment}
            min={minValue || undefined}
            disabled={disabled}
            arrowPosition="right"
          />
        </div>
      </div>
    </div>
  );
}
