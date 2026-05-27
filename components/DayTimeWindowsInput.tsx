'use client';

import { useState } from 'react';
import TimeGridModal from './TimeGridModal';
import { windowDurationMinutes, formatDayLabel, pickNextTimeWindow, pickVoterSplitWindow, isWindowWithinQuestionWindows, windowsOverlap, periodColorClass } from '@/lib/timeUtils';

interface TimeWindow {
  min: string; // HH:MM format
  max: string; // HH:MM format
  enabled?: boolean; // For voter form: whether this window is active (default true)
}

interface DayTimeWindowsInputProps {
  day: string; // YYYY-MM-DD format
  windows: TimeWindow[];
  onChange: (windows: TimeWindow[]) => void;
  onDelete: () => void; // Delete entire day
  disabled?: boolean;
  questionWindows?: TimeWindow[]; // Creator's windows for this day (constrains voter edits)
  minDurationMinutes?: number | null; // Minimum duration in minutes for validation
  // Full day list across the form. The + button reads this to copy the
  // latest non-intersecting slot from a neighbouring day instead of
  // opening the time-grid modal. Pass `dayTimeWindows` from the parent.
  allDays?: { day: string; windows: TimeWindow[] }[];
  // When true, omit the outer bg/border/padding chrome so the row composes
  // cleanly inside a parent card's `divide-y` layout. Used by the create-poll
  // "Time Windows" card; default usage keeps the standalone-strip look.
  borderless?: boolean;
}

// Format time in 12-hour format (compact) - returns {time, period}
function formatTime12Hour(time: string): { time: string; period: string } {
  const [hours, minutes] = time.split(':').map(Number);
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  return {
    time: `${displayHours}:${minutes.toString().padStart(2, '0')}`,
    period
  };
}



function getRelativeDay(dateStr: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + 'T00:00:00');
  const diffMs = target.getTime() - today.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays < 14) return `${diffDays}d away`;
  const weeks = Math.floor(diffDays / 7);
  if (weeks < 8) return `${weeks}w away`;
  const months = Math.floor(diffDays / 30.44);
  if (months < 24) return `${months}mo away`;
  const years = Math.floor(diffDays / 365.25);
  return `${years}y away`;
}

// Pill background + text per state. The border color is computed separately
// (pillBorderClass) so the voter form can show a thin outline on neutral pills
// while the creator form keeps them borderless. Layout-stable across states
// because PILL_BASE always sets `border` (1 px reserved) and exactly one
// border-color class is appended per pill. Filled bg is one step darker than
// the surfaces this renders on (the voter availability card is bg-gray-100/900,
// the create-poll card is white/gray-800), so pills stay legible on both
// without per-day card backing.
const PILL_BASE = 'w-[154px] py-1.5 rounded-full text-sm font-medium border transition-colors text-center disabled:cursor-not-allowed';
const PILL_STATE_CLASSES = {
  disabled: 'bg-gray-200 dark:bg-gray-800 text-gray-400 dark:text-gray-600 cursor-default opacity-50',
  tooShort: 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/50',
  intersecting: 'bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600',
  normal: 'bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600',
} as const;

function pillVariant(
  isTooShort: boolean,
  flagged: boolean,
): keyof typeof PILL_STATE_CLASSES {
  if (isTooShort) return 'tooShort';
  if (flagged) return 'intersecting';
  return 'normal';
}

// tooShort/intersecting keep their warning colors regardless of form. Neutral
// pills (normal/disabled) get a thin gray outline in the voter form so the
// tappable time-slot bubbles read as distinct (replaces the removed
// "Select time slots to fine-tune" hint); the creator form stays borderless.
function pillBorderClass(
  variant: keyof typeof PILL_STATE_CLASSES,
  isVoterForm: boolean,
): string {
  if (variant === 'tooShort') return 'border-red-400 dark:border-red-500';
  if (variant === 'intersecting') return 'border-orange-400 dark:border-orange-500';
  return isVoterForm ? 'border-gray-300 dark:border-gray-600' : 'border-transparent';
}

export default function DayTimeWindowsInput({
  day,
  windows,
  onChange,
  onDelete,
  disabled = false,
  questionWindows,
  minDurationMinutes,
  allDays,
  borderless = false,
}: DayTimeWindowsInputProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const isVoterForm = !!questionWindows;

  const handleAddWindow = () => {
    if (isVoterForm) {
      // Voters split a window into disconnected segments. Drop the new slot in
      // the largest free gap inside the creator's allowed windows; it's
      // deletable and soft-validated against the question windows + neighbours.
      const picked = pickVoterSplitWindow(questionWindows ?? [], windows);
      onChange([...windows, picked]);
      return;
    }
    const next = pickNextTimeWindow(day, allDays ?? [{ day, windows }]);
    onChange([...windows, next]);
  };

  const handleEditWindow = (index: number) => {
    setEditingIndex(index);
    setIsModalOpen(true);
  };

  const handleEditApply = (min: string | null, max: string | null) => {
    if (!min || !max || editingIndex === null) return;
    onChange(windows.map((w, i) => i === editingIndex ? { ...w, min, max } : w));
  };

  const handleDeleteWindow = (index: number) => {
    onChange(windows.filter((_, i) => i !== index));
    // Reset editing index if we deleted the window being edited
    if (editingIndex === index) {
      setEditingIndex(null);
    } else if (editingIndex !== null && editingIndex > index) {
      // Adjust editing index if we deleted a window before the one being edited
      setEditingIndex(editingIndex - 1);
    }
  };

  // Re-add an original question window that the voter has fully removed
  // (no ballot slot currently overlaps it). Surfaced as a ghost row's checkbox.
  const handleRestoreWindow = (w: TimeWindow) => {
    onChange([...windows, { min: w.min, max: w.max }]);
  };

  const renderPillContent = (window: TimeWindow, active: boolean) => {
    const minFormatted = formatTime12Hour(window.min);
    const maxFormatted = formatTime12Hour(window.max);
    const isCrossMidnight = window.max <= window.min;
    return (
      <>
        {minFormatted.time}
        <span className={`ml-0.5 ${active ? periodColorClass(minFormatted.period as 'AM' | 'PM') : ''}`}>
          {minFormatted.period}
        </span>
        {' - '}
        {maxFormatted.time}
        <span className={`ml-0.5 ${active ? periodColorClass(maxFormatted.period as 'AM' | 'PM') : ''}`}>
          {maxFormatted.period}
        </span>
        {isCrossMidnight && active && (
          <span className="ml-0.5 text-amber-600 dark:text-amber-400 text-xs font-semibold">
            +1
          </span>
        )}
      </>
    );
  };

  const renderDeleteButton = (index: number) => (
    <button
      type="button"
      onClick={() => handleDeleteWindow(index)}
      disabled={disabled}
      className="p-1 text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 disabled:opacity-50 disabled:cursor-not-allowed"
      aria-label="Delete time window"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  );

  return (
    <div
      className={
        borderless
          ? 'flex items-center gap-3 min-h-12 py-2'
          : 'flex items-center gap-3 p-1.5 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700'
      }
    >
      {/* Fixed-width date column so the + button to its right lands at the
          same X on every row. 88 px fits the widest expected label in
          Geist Sans (date line ~81 px; abbreviated relative ~50 px). */}
      <div className="w-[88px] self-start">
        <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {formatDayLabel(day)}
        </div>
        <div className="text-xs text-blue-500 dark:text-blue-400">
          {getRelativeDay(day)}
        </div>
      </div>

      {/* Diameter matches the pill height (34 px); shrink-0 prevents
          flex pressure from squishing it; self-start centers it with the
          topmost pill regardless of slot count. Voters use it to split a
          window into disconnected segments (each added slot soft-validated
          against the creator's allowed windows). */}
      <button
        type="button"
        onClick={handleAddWindow}
        disabled={disabled}
        className="shrink-0 self-start w-[34px] h-[34px] flex items-center justify-center rounded-full bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        aria-label="Add time window"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
      </button>

      {/* Ballot slots are all deletable (like the creation form). On the voter
          form, any original question window that no current slot overlaps is
          shown as a muted "ghost" row with an empty checkbox that re-adds it.
          Real + ghost rows are merged in start-time order. Windows arrive
          pre-sorted, so a slot intersects-or-touches its predecessor iff its
          start time is <= the previous end time. Creators keep the "can't
          delete the last slot" rule (use the day picker to remove a day);
          voters may clear a day entirely and re-add via a ghost checkbox. */}
      <div className="flex-1 flex flex-col gap-2 items-end">
        {(() => {
          type Row =
            | { kind: 'window'; window: TimeWindow; index: number; isTooShort: boolean; flagged: boolean }
            | { kind: 'ghost'; window: TimeWindow };
          const realRows: Row[] = windows.map((window, index) => {
            const duration = windowDurationMinutes(window);
            const isTooShort = minDurationMinutes != null && minDurationMinutes > 0 && duration < minDurationMinutes;
            const prev = index > 0 ? windows[index - 1] : null;
            const intersectsPrev = !!prev && window.min <= prev.max;
            // Voter slots must stay inside one of the creator's allowed windows;
            // a slot that escapes them (e.g. dragged out of range) gets the same
            // orange treatment as an intersecting slot and blocks submit.
            const outsideConstraint = isVoterForm && !!questionWindows && questionWindows.length > 0
              && !isWindowWithinQuestionWindows(window, questionWindows);
            return { kind: 'window', window, index, isTooShort, flagged: intersectsPrev || outsideConstraint };
          });
          // Ghost rows: original windows the voter has fully removed (no overlap).
          // Suppressed in the read-only summary (`disabled`) — there they'd read
          // as "options you forgot" rather than a re-add affordance.
          const ghostRows: Row[] = isVoterForm && !disabled
            ? (questionWindows ?? [])
                .filter(orig => !windows.some(w => windowsOverlap(w, orig)))
                .map(orig => ({ kind: 'ghost', window: orig }))
            : [];
          const rows = [...realRows, ...ghostRows].sort((a, b) => a.window.min.localeCompare(b.window.min));

          return rows.map((row) => {
            if (row.kind === 'ghost') {
              return (
                <label
                  key={`ghost-${row.window.min}-${row.window.max}`}
                  className="flex items-center gap-[7px] cursor-pointer"
                >
                  <span className="flex items-center p-1">
                    <input
                      type="checkbox"
                      checked={false}
                      onChange={() => handleRestoreWindow(row.window)}
                      disabled={disabled}
                      className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 disabled:opacity-50 cursor-pointer"
                      aria-label="Add this time window"
                    />
                  </span>
                  <span className={`${PILL_BASE} ${PILL_STATE_CLASSES.disabled} ${pillBorderClass('disabled', isVoterForm)}`}>
                    {renderPillContent(row.window, false)}
                  </span>
                </label>
              );
            }
            const showTrash = isVoterForm || windows.length > 1;
            const variant = pillVariant(row.isTooShort, row.flagged);
            return (
              <div key={`win-${row.index}`} className="flex items-center gap-[7px]">
                {showTrash ? renderDeleteButton(row.index) : null}
                <button
                  type="button"
                  onClick={() => handleEditWindow(row.index)}
                  disabled={disabled}
                  className={`${PILL_BASE} ${PILL_STATE_CLASSES[variant]} ${pillBorderClass(variant, isVoterForm)}`}
                >
                  {renderPillContent(row.window, true)}
                </button>
              </div>
            );
          });
        })()}
      </div>

      {/* Time Grid Modal. No hard clamp on the voter form: a window can range
          anywhere and is soft-validated against the creator's allowed windows
          (orange + blocked submit if it escapes). The old per-index clamp broke
          once a voter added a split and the list re-sorted, mapping windows to
          the wrong question window. */}
      <TimeGridModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingIndex(null);
        }}
        minValue={editingIndex !== null && windows[editingIndex] ? windows[editingIndex].min : "09:00"}
        maxValue={editingIndex !== null && windows[editingIndex] ? windows[editingIndex].max : "17:00"}
        onApply={handleEditApply}
        minDurationMinutes={minDurationMinutes}
      />
    </div>
  );
}
