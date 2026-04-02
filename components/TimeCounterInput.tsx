"use client";

import { useRef, useMemo, useCallback } from 'react';
import ScrollWheel from './ScrollWheel';

interface TimeCounterInputProps {
  value: string | null; // HH:MM format (24-hour)
  onChange: (value: string | null) => void;
  increment?: number; // minutes (used to generate minute options)
  disabled?: boolean;
  constraintMin?: string; // HH:MM 24h — lower bound of valid time window
  constraintMax?: string; // HH:MM 24h — upper bound of valid time window
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

function timeToMins(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/** Check if a time (in minutes) falls within a window, handling cross-midnight */
function isInWindow(mins: number, minMins: number, maxMins: number): boolean {
  if (maxMins <= minMins) {
    // Cross-midnight (e.g., 22:00–02:00): valid if >= min OR <= max
    return mins >= minMins || mins <= maxMins;
  }
  return mins >= minMins && mins <= maxMins;
}

export default function TimeCounterInput({
  value,
  onChange,
  increment = 15,
  disabled = false,
  constraintMin,
  constraintMax,
}: TimeCounterInputProps) {
  const minuteOptions = useMemo(() => getMinuteOptions(increment), [increment]);
  const minuteLabels = useMemo(() => minuteOptions.map(m => m.toString().padStart(2, '0')), [minuteOptions]);

  const prevHourIndex = useRef<number | null>(null);
  const prevMinuteIndex = useRef<number | null>(null);

  const constrained = !!constraintMin && !!constraintMax;
  const cMinMins = constrained ? timeToMins(constraintMin!) : 0;
  const cMaxMins = constrained ? timeToMins(constraintMax!) : 0;

  // Parse current value
  let currentHour24 = 9, currentMinute = 0;
  if (value) {
    [currentHour24, currentMinute] = value.split(':').map(Number);
  }
  const { hour12: currentHour12, period: currentPeriod } = from24Hour(currentHour24);

  // === UNCONSTRAINED MODE indices (existing logic) ===
  let hourIndex = currentHour12 - 1; // 1-12 -> 0-11
  let minuteIndex = minuteOptions.indexOf(currentMinute);
  if (minuteIndex === -1) {
    const nearest = minuteOptions.reduce((prev, curr) =>
      Math.abs(curr - currentMinute) < Math.abs(prev - currentMinute) ? curr : prev
    );
    minuteIndex = minuteOptions.indexOf(nearest);
  }
  const periodIndex = currentPeriod === 'AM' ? 0 : 1;

  // === CONSTRAINED MODE: compute effective (filtered) wheel items ===
  const effectivePeriods = useMemo(() => {
    if (!constrained) return PERIODS;
    const result: string[] = [];
    for (let m = 0; m < 720; m += increment) {
      if (isInWindow(m, cMinMins, cMaxMins)) { result.push('AM'); break; }
    }
    for (let m = 720; m < 1440; m += increment) {
      if (isInWindow(m, cMinMins, cMaxMins)) { result.push('PM'); break; }
    }
    return result.length > 0 ? result : PERIODS;
  }, [constrained, cMinMins, cMaxMins, increment]);

  const effectivePeriodIndex = constrained
    ? Math.max(0, effectivePeriods.indexOf(currentPeriod))
    : periodIndex;

  const effectiveHours = useMemo(() => {
    if (!constrained) return HOURS;
    const period = effectivePeriods[effectivePeriodIndex] as 'AM' | 'PM';
    const hours = new Set<number>();
    for (let m = 0; m < 1440; m += increment) {
      if (!isInWindow(m, cMinMins, cMaxMins)) continue;
      const h24 = Math.floor(m / 60);
      const { hour12, period: p } = from24Hour(h24);
      if (p === period) hours.add(hour12);
    }
    const result = HOURS.filter(h => hours.has(h));
    return result.length > 0 ? result : HOURS;
  }, [constrained, cMinMins, cMaxMins, increment, effectivePeriodIndex, effectivePeriods]);

  const effectiveHourLabels = useMemo(() => effectiveHours.map(String), [effectiveHours]);

  const effectiveHourIndex = constrained
    ? Math.max(0, effectiveHours.indexOf(currentHour12))
    : hourIndex;

  const effectiveMinuteOptions = useMemo(() => {
    if (!constrained) return minuteOptions;
    const period = effectivePeriods[effectivePeriodIndex] as 'AM' | 'PM';
    const hour12 = effectiveHours[Math.min(effectiveHourIndex, effectiveHours.length - 1)];
    if (!hour12) return minuteOptions;
    const h24 = to24Hour(hour12, period);
    const result = minuteOptions.filter(m => isInWindow(h24 * 60 + m, cMinMins, cMaxMins));
    return result.length > 0 ? result : minuteOptions;
  }, [constrained, cMinMins, cMaxMins, effectivePeriodIndex, effectivePeriods, effectiveHourIndex, effectiveHours, minuteOptions]);

  const effectiveMinuteLabels = useMemo(() =>
    effectiveMinuteOptions.map(m => m.toString().padStart(2, '0')),
    [effectiveMinuteOptions]);

  const effectiveMinuteIndex = constrained
    ? Math.max(0, effectiveMinuteOptions.indexOf(currentMinute))
    : minuteIndex;

  // Keep refs in sync with current parsed values
  if (prevHourIndex.current === null) prevHourIndex.current = constrained ? effectiveHourIndex : hourIndex;
  if (prevMinuteIndex.current === null) prevMinuteIndex.current = constrained ? effectiveMinuteIndex : minuteIndex;

  // === EMIT FUNCTIONS ===

  const emit = (h: number, m: number, p: number) => {
    if (disabled) return;
    const hour12 = HOURS[h];
    const minute = minuteOptions[m];
    const period = PERIODS[p] as 'AM' | 'PM';
    const hour24 = to24Hour(hour12, period);
    const timeStr = `${hour24.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    onChange(timeStr);
  };

  const emitConstrained = useCallback((periodIdx: number, hourIdx: number, minuteIdx: number) => {
    if (disabled) return;
    const period = effectivePeriods[periodIdx] as 'AM' | 'PM';
    let hour12 = effectiveHours[hourIdx];
    let minute = effectiveMinuteOptions[minuteIdx];

    // Safety: if index out of range, use first valid value
    if (hour12 === undefined) hour12 = effectiveHours[0] || 12;
    if (minute === undefined) minute = effectiveMinuteOptions[0] || 0;

    const h24 = to24Hour(hour12, period);
    let timeMins = h24 * 60 + minute;

    // If this combination isn't valid (can happen during period/hour transitions),
    // find the nearest valid time in the constraint window
    if (!isInWindow(timeMins, cMinMins, cMaxMins)) {
      let bestTime = cMinMins;
      let bestDist = Infinity;
      for (let m = 0; m < 1440; m += increment) {
        if (!isInWindow(m, cMinMins, cMaxMins)) continue;
        const dist = Math.min(Math.abs(m - timeMins), 1440 - Math.abs(m - timeMins));
        if (dist < bestDist) { bestDist = dist; bestTime = m; }
      }
      timeMins = bestTime;
    }

    const h = Math.floor(timeMins / 60);
    const min = timeMins % 60;
    onChange(`${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`);
  }, [disabled, effectivePeriods, effectiveHours, effectiveMinuteOptions, cMinMins, cMaxMins, increment, onChange]);

  // === HANDLERS ===

  const handleHourChange = (newHourIndex: number) => {
    if (constrained) {
      emitConstrained(effectivePeriodIndex, newHourIndex, effectiveMinuteIndex);
      return;
    }
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
    if (constrained) {
      emitConstrained(effectivePeriodIndex, effectiveHourIndex, newMinuteIndex);
      return;
    }
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
    if (constrained) {
      emitConstrained(newPeriodIndex, effectiveHourIndex, effectiveMinuteIndex);
      return;
    }
    emit(hourIndex, minuteIndex, newPeriodIndex);
  };

  // === RENDER ===

  const itemHeight = 40;
  const visibleItems = 5;
  const highlightTop = Math.floor(visibleItems / 2) * itemHeight;

  const hourItems = constrained ? effectiveHourLabels : HOUR_LABELS;
  const hourSelIdx = constrained ? effectiveHourIndex : hourIndex;
  const minItems = constrained ? effectiveMinuteLabels : minuteLabels;
  const minSelIdx = constrained ? effectiveMinuteIndex : minuteIndex;
  const periodItems = constrained ? effectivePeriods : PERIODS;
  const periodSelIdx = constrained ? effectivePeriodIndex : periodIndex;

  return (
    <div className={`relative flex items-center gap-0 ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      {/* Unified highlight band spanning all wheels */}
      <div
        className="absolute left-0 right-0 pointer-events-none bg-blue-200/50 dark:bg-blue-700/30 z-0 rounded-xl"
        style={{ top: highlightTop, height: itemHeight }}
      />
      <ScrollWheel
        key={constrained ? `h:${hourItems.join(',')}` : 'h'}
        items={hourItems}
        selectedIndex={hourSelIdx}
        onChange={handleHourChange}
        width={45}
        loop={!constrained}
        hideHighlight
      />
      <div className="text-xl font-semibold text-gray-900 dark:text-white px-0.5 self-center">:</div>
      <ScrollWheel
        key={constrained ? `m:${minItems.join(',')}` : 'm'}
        items={minItems}
        selectedIndex={minSelIdx}
        onChange={handleMinuteChange}
        width={45}
        loop={!constrained}
        hideHighlight
      />
      <div className="w-1" />
      <ScrollWheel
        key={constrained ? `p:${periodItems.join(',')}` : 'p'}
        items={periodItems}
        selectedIndex={periodSelIdx}
        onChange={handlePeriodChange}
        width={42}
        hideHighlight
      />
    </div>
  );
}
