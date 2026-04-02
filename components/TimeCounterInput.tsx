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
    return mins >= minMins || mins <= maxMins;
  }
  return mins >= minMins && mins <= maxMins;
}

// no-op handler for the locked AM/PM wheel
function noop() {}

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

  // === UNCONSTRAINED MODE indices ===
  let hourIndex = currentHour12 - 1; // 1-12 -> 0-11
  let minuteIndex = minuteOptions.indexOf(currentMinute);
  if (minuteIndex === -1) {
    const nearest = minuteOptions.reduce((prev, curr) =>
      Math.abs(curr - currentMinute) < Math.abs(prev - currentMinute) ? curr : prev
    );
    minuteIndex = minuteOptions.indexOf(nearest);
  }
  const periodIndex = currentPeriod === 'AM' ? 0 : 1;

  // === CONSTRAINED MODE ===
  // All valid hours in chronological order across AM/PM (e.g., 9,10,11,12,1,2,3,4,5).
  // AM/PM wheel is visible but non-interactive — it follows the selected hour automatically.

  const constrainedHours = useMemo(() => {
    if (!constrained) return [];
    const items: { label: string; hour24: number }[] = [];
    const seen = new Set<number>();
    const startHour = Math.floor(cMinMins / 60);
    for (let i = 0; i < 24; i++) {
      const h24 = (startHour + i) % 24;
      if (seen.has(h24)) continue;
      let hasValid = false;
      for (let m = 0; m < 60; m += increment) {
        if (isInWindow(h24 * 60 + m, cMinMins, cMaxMins)) { hasValid = true; break; }
      }
      if (hasValid) {
        seen.add(h24);
        const { hour12 } = from24Hour(h24);
        items.push({ label: String(hour12), hour24: h24 });
      }
    }
    return items;
  }, [constrained, cMinMins, cMaxMins, increment]);

  const constrainedHourLabels = useMemo(
    () => constrainedHours.map(h => h.label),
    [constrainedHours],
  );

  const constrainedHourIndex = useMemo(() => {
    const idx = constrainedHours.findIndex(h => h.hour24 === currentHour24);
    return idx >= 0 ? idx : 0;
  }, [constrainedHours, currentHour24]);

  // Minutes filtered for the selected constrained hour
  const constrainedMinutes = useMemo(() => {
    if (!constrained || constrainedHours.length === 0) return minuteOptions;
    const h24 = constrainedHours[constrainedHourIndex]?.hour24 ?? 0;
    const result = minuteOptions.filter(m => isInWindow(h24 * 60 + m, cMinMins, cMaxMins));
    return result.length > 0 ? result : minuteOptions;
  }, [constrained, constrainedHours, constrainedHourIndex, cMinMins, cMaxMins, minuteOptions]);

  const constrainedMinuteLabels = useMemo(
    () => constrainedMinutes.map(m => m.toString().padStart(2, '0')),
    [constrainedMinutes],
  );

  const constrainedMinuteIndex = useMemo(() => {
    const idx = constrainedMinutes.indexOf(currentMinute);
    return idx >= 0 ? idx : 0;
  }, [constrainedMinutes, currentMinute]);

  // Keep refs in sync
  if (prevHourIndex.current === null) prevHourIndex.current = hourIndex;
  if (prevMinuteIndex.current === null) prevMinuteIndex.current = minuteIndex;

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

  const handleConstrainedHourChange = useCallback((newIdx: number) => {
    if (disabled) return;
    const hourItem = constrainedHours[newIdx];
    if (!hourItem) return;
    const h24 = hourItem.hour24;
    let minute = currentMinute;
    if (!isInWindow(h24 * 60 + minute, cMinMins, cMaxMins)) {
      for (let m = 0; m < 60; m += increment) {
        if (isInWindow(h24 * 60 + m, cMinMins, cMaxMins)) { minute = m; break; }
      }
    }
    onChange(`${h24.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`);
  }, [disabled, constrainedHours, currentMinute, cMinMins, cMaxMins, increment, onChange]);

  const handleConstrainedMinuteChange = useCallback((newIdx: number) => {
    if (disabled) return;
    const minute = constrainedMinutes[newIdx];
    if (minute === undefined) return;
    const h24 = constrainedHours[constrainedHourIndex]?.hour24 ?? 0;
    onChange(`${h24.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`);
  }, [disabled, constrainedMinutes, constrainedHours, constrainedHourIndex, onChange]);

  // === UNCONSTRAINED HANDLERS ===

  const handleHourChange = (newHourIndex: number) => {
    const prev = prevHourIndex.current ?? hourIndex;
    let newPeriod = periodIndex;

    if (prev === 10 && newHourIndex === 11) {
      newPeriod = periodIndex === 0 ? 1 : 0;
    } else if (prev === 11 && newHourIndex === 10) {
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

    if (prev === lastIdx && newMinuteIndex === 0) {
      newHourIdx = (hourIndex + 1) % 12;
      if (hourIndex === 10 && newHourIdx === 11) {
        newPeriod = periodIndex === 0 ? 1 : 0;
      }
    } else if (prev === 0 && newMinuteIndex === lastIdx) {
      newHourIdx = (hourIndex - 1 + 12) % 12;
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

  // === RENDER ===

  const itemHeight = 40;
  const visibleItems = 5;
  const highlightTop = Math.floor(visibleItems / 2) * itemHeight;

  return (
    <div className={`flex items-center gap-0 ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      {constrained ? (
        <>
          {/* Hour + minute wheels with highlight band (excludes AM/PM) */}
          <div className="relative flex items-center gap-0">
            <div
              className="absolute left-0 right-0 pointer-events-none bg-blue-200/50 dark:bg-blue-700/30 z-0 rounded-xl"
              style={{ top: highlightTop, height: itemHeight }}
            />
            <ScrollWheel
              key={`h:${constrainedHourLabels.join(',')}`}
              items={constrainedHourLabels}
              selectedIndex={constrainedHourIndex}
              onChange={handleConstrainedHourChange}
              width={45}
              hideHighlight
            />
            <div className="text-xl font-semibold text-gray-900 dark:text-white px-0.5 self-center">:</div>
            <ScrollWheel
              key={`m:${constrainedMinuteLabels.join(',')}`}
              items={constrainedMinuteLabels}
              selectedIndex={constrainedMinuteIndex}
              onChange={handleConstrainedMinuteChange}
              width={45}
              hideHighlight
            />
          </div>
          <div className="w-1" />
          {/* AM/PM wheel: visible but non-interactive, follows the selected hour */}
          <div style={{ pointerEvents: 'none' }}>
            <ScrollWheel
              items={PERIODS}
              selectedIndex={periodIndex}
              onChange={noop}
              width={42}
              hideHighlight
            />
          </div>
        </>
      ) : (
        <div className="relative flex items-center gap-0">
          {/* Unified highlight band spanning all wheels */}
          <div
            className="absolute left-0 right-0 pointer-events-none bg-blue-200/50 dark:bg-blue-700/30 z-0 rounded-xl"
            style={{ top: highlightTop, height: itemHeight }}
          />
          <ScrollWheel
            items={HOUR_LABELS}
            selectedIndex={hourIndex}
            onChange={handleHourChange}
            width={45}
            loop
            hideHighlight
          />
          <div className="text-xl font-semibold text-gray-900 dark:text-white px-0.5 self-center">:</div>
          <ScrollWheel
            items={minuteLabels}
            selectedIndex={minuteIndex}
            onChange={handleMinuteChange}
            width={45}
            loop
            hideHighlight
          />
          <div className="w-1" />
          <ScrollWheel
            items={PERIODS}
            selectedIndex={periodIndex}
            onChange={handlePeriodChange}
            width={42}
            hideHighlight
          />
        </div>
      )}
    </div>
  );
}
