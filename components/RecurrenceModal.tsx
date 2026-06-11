'use client';

import { useCallback, useEffect } from 'react';
import ModalPortal from '@/components/ModalPortal';
import { useBodyScrollLock } from '@/lib/useBodyScrollLock';
import {
  RecurrenceRule,
  RecurrenceFrequency,
  DEFAULT_RECURRENCE,
  WEEKDAY_LABELS,
  generateOccurrences,
  summarizeRecurrence,
  monthlyNthWeekdayLabel,
  monthlyDayOfMonthLabel,
  recurrenceIsActive,
  formatLocalDateISO,
} from '@/lib/recurrence';
import { haptic } from '@/lib/haptics';

interface RecurrenceModalProps {
  isOpen: boolean;
  /** The first occurrence (YYYY-MM-DD). Anchors weekly/monthly summaries +
   *  the preview. Usually the poll's voting-deadline date or today. */
  start: string;
  value: RecurrenceRule;
  onChange: (rule: RecurrenceRule) => void;
  onClose: () => void;
}

const FREQ_OPTIONS: { value: RecurrenceFrequency; label: string }[] = [
  { value: 'none', label: 'Off' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

const UNIT_LABEL: Record<Exclude<RecurrenceFrequency, 'none'>, string> = {
  daily: 'day',
  weekly: 'week',
  monthly: 'month',
};

export default function RecurrenceModal({ isOpen, start, value, onChange, onClose }: RecurrenceModalProps) {
  useBodyScrollLock(isOpen);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const patch = useCallback(
    (p: Partial<RecurrenceRule>) => onChange({ ...value, ...p }),
    [value, onChange],
  );

  const setFrequency = (freq: RecurrenceFrequency) => {
    haptic.light();
    if (freq === 'none') {
      onChange({ ...DEFAULT_RECURRENCE });
      return;
    }
    // Seed weekly's day-of-week from the start date the first time it turns on.
    const startWeekday = new Date(`${start}T12:00:00`).getDay();
    onChange({
      ...value,
      frequency: freq,
      interval: Math.max(1, value.interval || 1),
      weekdays: freq === 'weekly' && value.weekdays.length === 0 ? [startWeekday] : value.weekdays,
    });
  };

  const toggleWeekday = (d: number) => {
    haptic.light();
    const has = value.weekdays.includes(d);
    const next = has ? value.weekdays.filter(x => x !== d) : [...value.weekdays, d];
    // Never allow an empty weekly set — fall back to the start weekday.
    patch({ weekdays: next.length ? next : [new Date(`${start}T12:00:00`).getDay()] });
  };

  const bumpInterval = (delta: number) => {
    haptic.light();
    patch({ interval: Math.min(99, Math.max(1, (value.interval || 1) + delta)) });
  };

  if (!isOpen) return null;

  const active = recurrenceIsActive(value);
  const unit = active ? UNIT_LABEL[value.frequency as Exclude<RecurrenceFrequency, 'none'>] : 'day';
  const preview = generateOccurrences(value, start, { limit: 5 });
  const totalKnown = value.end.type === 'after'
    ? value.end.count
    : value.end.type === 'on'
      ? generateOccurrences(value, start, { limit: 400 }).length
      : null;

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" onClick={onClose}>
        <div className="absolute inset-0 bg-black/50" />
        <div
          className="relative bg-white dark:bg-gray-800 rounded-3xl shadow-xl w-full max-w-sm max-h-[calc(100dvh-2rem)] overflow-y-auto p-5"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <span aria-hidden>🔁</span> Repeat poll
            </h2>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
              aria-label="Close"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Frequency segmented control */}
          <div className="grid grid-cols-4 gap-1 p-1 rounded-2xl bg-gray-100 dark:bg-gray-900 mb-4">
            {FREQ_OPTIONS.map(opt => {
              const selected = opt.value === 'none' ? !active : value.frequency === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => setFrequency(opt.value)}
                  className={`py-2 rounded-xl text-sm font-medium transition-colors ${
                    selected
                      ? 'bg-blue-600 text-white shadow'
                      : 'text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          {active && (
            <>
              {/* Interval stepper */}
              <div className="flex items-center justify-between gap-3 h-12">
                <span className="text-base font-normal">Every</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => bumpInterval(-1)}
                    disabled={value.interval <= 1}
                    className="w-8 h-8 rounded-full border border-gray-300 dark:border-gray-600 flex items-center justify-center text-lg leading-none disabled:opacity-40 active:scale-95"
                    aria-label="Decrease interval"
                  >−</button>
                  <span className="w-12 text-center tabular-nums text-base font-medium">
                    {value.interval} {unit}{value.interval === 1 ? '' : 's'}
                  </span>
                  <button
                    onClick={() => bumpInterval(1)}
                    className="w-8 h-8 rounded-full border border-gray-300 dark:border-gray-600 flex items-center justify-center text-lg leading-none active:scale-95"
                    aria-label="Increase interval"
                  >+</button>
                </div>
              </div>

              {/* Weekly: day-of-week chips */}
              {value.frequency === 'weekly' && (
                <div className="py-3">
                  <div className="text-sm text-gray-500 dark:text-gray-400 mb-2">On these days</div>
                  <div className="flex justify-between gap-1">
                    {WEEKDAY_LABELS.map((label, d) => {
                      const on = value.weekdays.includes(d);
                      return (
                        <button
                          key={d}
                          onClick={() => toggleWeekday(d)}
                          className={`flex-1 h-10 rounded-full text-xs font-semibold transition-colors ${
                            on
                              ? 'bg-blue-600 text-white'
                              : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                          }`}
                          aria-pressed={on}
                        >
                          {label[0]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Monthly: day-of-month vs nth-weekday */}
              {value.frequency === 'monthly' && (
                <div className="py-3 space-y-1">
                  <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">Repeat on</div>
                  {(['dayOfMonth', 'nthWeekday'] as const).map(mode => {
                    const selected = value.monthlyMode === mode;
                    const label = mode === 'dayOfMonth'
                      ? monthlyDayOfMonthLabel(start)
                      : `The ${monthlyNthWeekdayLabel(start)}`;
                    return (
                      <button
                        key={mode}
                        onClick={() => { haptic.light(); patch({ monthlyMode: mode }); }}
                        className="flex items-center gap-3 w-full h-11 text-left"
                      >
                        <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                          selected ? 'border-blue-600' : 'border-gray-300 dark:border-gray-600'
                        }`}>
                          {selected && <span className="w-2.5 h-2.5 rounded-full bg-blue-600" />}
                        </span>
                        <span className="text-base">{label}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Ends */}
              <div className="pt-3 mt-1 border-t border-gray-200 dark:border-gray-700">
                <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">Ends</div>

                <EndRadio
                  selected={value.end.type === 'never'}
                  onSelect={() => { haptic.light(); patch({ end: { type: 'never' } }); }}
                  label="Never"
                />

                <EndRadio
                  selected={value.end.type === 'after'}
                  onSelect={() => { haptic.light(); patch({ end: { type: 'after', count: value.end.type === 'after' ? value.end.count : 5 } }); }}
                  label={
                    <span className="flex items-center gap-2">
                      After
                      <input
                        type="number"
                        min={1}
                        max={365}
                        value={value.end.type === 'after' ? value.end.count : 5}
                        onFocus={() => patch({ end: { type: 'after', count: value.end.type === 'after' ? value.end.count : 5 } })}
                        onChange={(e) => {
                          const n = Math.max(1, Math.min(365, parseInt(e.target.value, 10) || 1));
                          patch({ end: { type: 'after', count: n } });
                        }}
                        className="w-16 px-2 py-1 rounded-lg bg-gray-100 dark:bg-gray-700 text-center text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      occurrences
                    </span>
                  }
                />

                <EndRadio
                  selected={value.end.type === 'on'}
                  onSelect={() => { haptic.light(); patch({ end: { type: 'on', date: value.end.type === 'on' ? value.end.date : defaultUntil(start) } }); }}
                  label={
                    <span className="flex items-center gap-2">
                      On
                      <input
                        type="date"
                        min={start}
                        value={value.end.type === 'on' ? value.end.date : defaultUntil(start)}
                        onFocus={() => patch({ end: { type: 'on', date: value.end.type === 'on' ? value.end.date : defaultUntil(start) } })}
                        onChange={(e) => patch({ end: { type: 'on', date: e.target.value || defaultUntil(start) } })}
                        className="px-2 py-1 rounded-lg bg-gray-100 dark:bg-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </span>
                  }
                />
              </div>

              {/* Live preview */}
              <div className="mt-4 rounded-2xl bg-blue-50 dark:bg-blue-900/20 p-3">
                <div className="text-sm font-medium text-blue-700 dark:text-blue-300 mb-2">
                  {summarizeRecurrence(value, start)}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                  Next occurrences{totalKnown != null ? ` (${totalKnown} total)` : ''}
                </div>
                <ul className="space-y-0.5">
                  {preview.map((d, i) => (
                    <li key={i} className="text-sm text-gray-700 dark:text-gray-200 flex items-center gap-2">
                      <span className="text-gray-400 tabular-nums w-4">{i + 1}.</span>
                      {d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                    </li>
                  ))}
                  {value.end.type === 'never' && (
                    <li className="text-sm text-gray-400 flex items-center gap-2">
                      <span className="w-4" />…and so on
                    </li>
                  )}
                  {preview.length === 0 && (
                    <li className="text-sm text-gray-400">No occurrences in range.</li>
                  )}
                </ul>
              </div>
            </>
          )}

          {!active && (
            <p className="text-sm text-gray-500 dark:text-gray-400 py-2">
              This poll runs once. Turn on a cadence to automatically open a fresh
              copy each period — great for a weekly lunch vote or a monthly game night.
            </p>
          )}

          <button
            onClick={() => { haptic.medium(); onClose(); }}
            className="mt-5 w-full py-3 rounded-2xl bg-blue-600 text-white font-medium active:scale-[0.99]"
          >
            Done
          </button>
        </div>
      </div>
    </ModalPortal>
  );
}

function EndRadio({
  selected,
  onSelect,
  label,
}: {
  selected: boolean;
  onSelect: () => void;
  label: React.ReactNode;
}) {
  return (
    <div
      className="flex items-center gap-3 min-h-11 py-1 cursor-pointer"
      onClick={onSelect}
    >
      <span className={`w-5 h-5 shrink-0 rounded-full border-2 flex items-center justify-center ${
        selected ? 'border-blue-600' : 'border-gray-300 dark:border-gray-600'
      }`}>
        {selected && <span className="w-2.5 h-2.5 rounded-full bg-blue-600" />}
      </span>
      <span className="text-base" onClick={(e) => { if (selected) e.stopPropagation(); }}>{label}</span>
    </div>
  );
}

/** Default "until" date: ~3 months out from the start. */
function defaultUntil(start: string): string {
  const d = new Date(`${start}T12:00:00`);
  d.setMonth(d.getMonth() + 3);
  return formatLocalDateISO(d);
}
