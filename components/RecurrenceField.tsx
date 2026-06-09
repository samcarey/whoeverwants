'use client';

import { useState } from 'react';
import RecurrenceModal from '@/components/RecurrenceModal';
import { RecurrenceRule, shortRecurrenceLabel, recurrenceIsActive } from '@/lib/recurrence';

interface RecurrenceFieldProps {
  /** First-occurrence anchor (YYYY-MM-DD). */
  start: string;
  value: RecurrenceRule;
  setValue: (rule: RecurrenceRule) => void;
  disabled?: boolean;
}

/**
 * A single settings row: "Repeat" on the left, the current cadence
 * (faded-grey, e.g. "Off" / "Weekly") on the right, tappable to open the full
 * recurrence modal. Mirrors the VotingCutoffField / CompactNumberRow row shape
 * (label-left, tappable-value-right, h-12) used across the create-poll bottom
 * settings card.
 */
export default function RecurrenceField({ start, value, setValue, disabled = false }: RecurrenceFieldProps) {
  const [open, setOpen] = useState(false);
  const active = recurrenceIsActive(value);

  return (
    <>
      <div
        className={`flex items-center justify-between gap-3 h-12 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
        onClick={() => { if (!disabled) setOpen(true); }}
      >
        <span className="text-base font-normal">Repeat</span>
        <span
          className={`text-base text-right shrink-0 flex items-center gap-1.5 ${
            active ? 'text-blue-600 dark:text-blue-400 font-medium' : 'text-gray-500 dark:text-gray-500'
          }`}
        >
          {active && <span aria-hidden className="text-sm">🔁</span>}
          {shortRecurrenceLabel(value)}
          <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </span>
      </div>

      <RecurrenceModal
        isOpen={open}
        start={start}
        value={value}
        onChange={setValue}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
