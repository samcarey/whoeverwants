"use client";

interface TimeCounterInputProps {
  value: string | null; // HH:MM format (24-hour)
  onChange: (value: string | null) => void;
  increment?: number; // minutes
  min?: string; // HH:MM format
  max?: string; // HH:MM format
  disabled?: boolean;
}

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

export default function TimeCounterInput({
  value,
  onChange,
  increment = 15,
  min,
  max,
  disabled = false,
}: TimeCounterInputProps) {
  const currentMinutes = value ? timeToMinutes(value) : null;
  const minMinutes = min ? timeToMinutes(min) : 0;
  const maxMinutes = max ? timeToMinutes(max) : 24 * 60 - 1;

  const canDecrement = !disabled && currentMinutes !== null && currentMinutes - increment >= minMinutes;
  const canIncrement = !disabled && currentMinutes !== null && currentMinutes + increment <= maxMinutes;

  const handleIncrement = () => {
    if (!canIncrement || currentMinutes === null) return;
    onChange(minutesToTime(currentMinutes + increment));
  };

  const handleDecrement = () => {
    if (!canDecrement || currentMinutes === null) return;
    onChange(minutesToTime(currentMinutes - increment));
  };

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={handleDecrement}
        disabled={!canDecrement}
        className="p-1.5 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded disabled:opacity-30"
        aria-label="Decrease time"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
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
      <button
        type="button"
        onClick={handleIncrement}
        disabled={!canIncrement}
        className="p-1.5 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded disabled:opacity-30"
        aria-label="Increase time"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
        </svg>
      </button>
    </div>
  );
}
