"use client";

interface TimeCounterInputProps {
  value: string | null; // HH:MM format (24-hour)
  onChange: (value: string | null) => void;
  increment?: number; // minutes
  min?: string; // HH:MM format
  max?: string; // HH:MM format
  disabled?: boolean;
}

export default function TimeCounterInput({
  value,
  onChange,
  increment = 15,
  min,
  max,
  disabled = false,
}: TimeCounterInputProps) {
  return (
    <input
      type="time"
      value={value || ''}
      onChange={(e) => onChange(e.target.value || null)}
      min={min}
      max={max}
      step={increment * 60}
      disabled={disabled}
      className="px-2 py-1.5 text-center text-xl font-medium border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
    />
  );
}
