"use client";

import ScrollWheel from './ScrollWheel';

interface TimeCounterInputProps {
  value: string | null; // HH:MM format (24-hour)
  onChange: (value: string | null) => void;
  increment?: number; // minutes (used to generate minute options)
  min?: string; // HH:MM format
  max?: string; // HH:MM format
  disabled?: boolean;
}

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1); // 1-12
const HOUR_LABELS = HOURS.map(String);
const PERIODS = ['AM', 'PM'];

function getMinuteOptions(increment: number): number[] {
  const options: number[] = [];
  for (let m = 0; m < 60; m += increment) {
    options.push(m);
  }
  return options;
}

function to24Hour(hour12: number, period: 'AM' | 'PM'): number {
  if (period === 'AM') return hour12 === 12 ? 0 : hour12;
  return hour12 === 12 ? 12 : hour12 + 12;
}

function from24Hour(hour24: number): { hour12: number; period: 'AM' | 'PM' } {
  const period: 'AM' | 'PM' = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 === 0 ? 12 : hour24 > 12 ? hour24 - 12 : hour24;
  return { hour12, period };
}

export default function TimeCounterInput({
  value,
  onChange,
  increment = 15,
  disabled = false,
}: TimeCounterInputProps) {
  const minuteOptions = getMinuteOptions(increment);
  const minuteLabels = minuteOptions.map(m => m.toString().padStart(2, '0'));

  // Parse current value
  let hourIndex = 8; // default 9 AM -> index 8 (9-1=8 in 0-based)
  let minuteIndex = 0;
  let periodIndex = 0; // AM

  if (value) {
    const [h24, m] = value.split(':').map(Number);
    const { hour12, period } = from24Hour(h24);
    hourIndex = hour12 - 1; // 1-12 -> 0-11
    minuteIndex = minuteOptions.indexOf(m);
    if (minuteIndex === -1) {
      // Snap to nearest increment
      const nearest = minuteOptions.reduce((prev, curr) =>
        Math.abs(curr - m) < Math.abs(prev - m) ? curr : prev
      );
      minuteIndex = minuteOptions.indexOf(nearest);
    }
    periodIndex = period === 'AM' ? 0 : 1;
  }

  const handleChange = (newHourIndex: number, newMinuteIndex: number, newPeriodIndex: number) => {
    if (disabled) return;
    const hour12 = HOURS[newHourIndex];
    const minute = minuteOptions[newMinuteIndex];
    const period = PERIODS[newPeriodIndex] as 'AM' | 'PM';
    const hour24 = to24Hour(hour12, period);
    const timeStr = `${hour24.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    onChange(timeStr);
  };

  return (
    <div className={`flex items-center gap-0 ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      <ScrollWheel
        items={HOUR_LABELS}
        selectedIndex={hourIndex}
        onChange={(i) => handleChange(i, minuteIndex, periodIndex)}
        width={45}
      />
      <div className="text-xl font-semibold text-gray-900 dark:text-white px-0.5 self-center">:</div>
      <ScrollWheel
        items={minuteLabels}
        selectedIndex={minuteIndex}
        onChange={(i) => handleChange(hourIndex, i, periodIndex)}
        width={45}
      />
      <div className="w-1" />
      <ScrollWheel
        items={PERIODS}
        selectedIndex={periodIndex}
        onChange={(i) => handleChange(hourIndex, minuteIndex, i)}
        width={42}
      />
    </div>
  );
}
