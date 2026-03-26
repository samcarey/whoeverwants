"use client";

import { useRef } from 'react';
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

  const prevHourIndex = useRef<number | null>(null);
  const prevMinuteIndex = useRef<number | null>(null);

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
      const nearest = minuteOptions.reduce((prev, curr) =>
        Math.abs(curr - m) < Math.abs(prev - m) ? curr : prev
      );
      minuteIndex = minuteOptions.indexOf(nearest);
    }
    periodIndex = period === 'AM' ? 0 : 1;
  }

  // Keep refs in sync with current parsed values
  if (prevHourIndex.current === null) prevHourIndex.current = hourIndex;
  if (prevMinuteIndex.current === null) prevMinuteIndex.current = minuteIndex;

  const emit = (h: number, m: number, p: number) => {
    if (disabled) return;
    const hour12 = HOURS[h];
    const minute = minuteOptions[m];
    const period = PERIODS[p] as 'AM' | 'PM';
    const hour24 = to24Hour(hour12, period);
    const timeStr = `${hour24.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    onChange(timeStr);
  };

  const handleHourChange = (newHourIndex: number) => {
    const prev = prevHourIndex.current ?? hourIndex;
    let newPeriod = periodIndex;

    // Detect crossing the 11↔12 boundary (noon/midnight crossing)
    // 11 is index 10, 12 is index 11
    if (prev === 10 && newHourIndex === 11) {
      // Scrolled from 11 → 12 (forward): toggle AM/PM
      newPeriod = periodIndex === 0 ? 1 : 0;
    } else if (prev === 11 && newHourIndex === 10) {
      // Scrolled from 12 → 11 (backward): toggle AM/PM
      newPeriod = periodIndex === 0 ? 1 : 0;
    }

    prevHourIndex.current = newHourIndex;
    emit(newHourIndex, minuteIndex, newPeriod);
  };

  const handleMinuteChange = (newMinuteIndex: number) => {
    const prev = prevMinuteIndex.current ?? minuteIndex;
    const lastIdx = minuteOptions.length - 1;
    let newHourIdx = hourIndex;
    let newPeriod = periodIndex;

    // Detect minute wraparound (e.g. 45→00 or 00→45)
    if (prev === lastIdx && newMinuteIndex === 0) {
      // Scrolled past last minute → wrap forward, increment hour
      newHourIdx = (hourIndex + 1) % 12;
      // If hour crosses 11→12 boundary, toggle AM/PM
      if (hourIndex === 10 && newHourIdx === 11) {
        newPeriod = periodIndex === 0 ? 1 : 0;
      }
    } else if (prev === 0 && newMinuteIndex === lastIdx) {
      // Scrolled past first minute → wrap backward, decrement hour
      newHourIdx = (hourIndex - 1 + 12) % 12;
      // If hour crosses 12→11 boundary, toggle AM/PM
      if (hourIndex === 11 && newHourIdx === 10) {
        newPeriod = periodIndex === 0 ? 1 : 0;
      }
    }

    prevMinuteIndex.current = newMinuteIndex;
    prevHourIndex.current = newHourIdx;
    emit(newHourIdx, newMinuteIndex, newPeriod);
  };

  const handlePeriodChange = (newPeriodIndex: number) => {
    emit(hourIndex, minuteIndex, newPeriodIndex);
  };

  return (
    <div className={`flex items-center gap-0 ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      <ScrollWheel
        items={HOUR_LABELS}
        selectedIndex={hourIndex}
        onChange={handleHourChange}
        width={45}
        loop
      />
      <div className="text-xl font-semibold text-gray-900 dark:text-white px-0.5 self-center">:</div>
      <ScrollWheel
        items={minuteLabels}
        selectedIndex={minuteIndex}
        onChange={handleMinuteChange}
        width={45}
        loop
      />
      <div className="w-1" />
      <ScrollWheel
        items={PERIODS}
        selectedIndex={periodIndex}
        onChange={handlePeriodChange}
        width={42}
      />
    </div>
  );
}
