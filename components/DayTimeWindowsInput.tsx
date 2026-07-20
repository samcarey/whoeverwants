'use client';

import { useState, useEffect, useRef, type ReactNode } from 'react';
import type React from 'react';
import TimeGridModal from './TimeGridModal';
import { windowDurationMinutes, formatDayLabel, getRelativeDayLabel, pickNextTimeWindow, pickVoterSplitWindow, isWindowWithinQuestionWindows, windowsOverlap, periodColorClass } from '@/lib/timeUtils';

interface TimeWindow {
  min: string; // HH:MM format
  max: string; // HH:MM format
  enabled?: boolean; // For voter form: whether this window is active (default true)
}

// Cross-day selection wiring supplied by the coordinator (DayTimeWindowsList).
// Drives two long-press modes that span multiple days:
//   • 'windows' — multi-select time-slot pills, then bulk-edit them all at once.
//   • 'copy'    — pick a source day, then tap other days to paste its slots.
// Absent (or mode 'none') keeps the plain tap-to-edit behaviour.
export interface DayTimeSelection {
  mode: 'none' | 'windows' | 'copy';
  isWindowSelected: (index: number) => boolean;
  onWindowLongPress: (index: number, x: number, y: number) => void;
  onWindowTap: (index: number) => void;
  onDayLongPress?: (x: number, y: number) => void;
  isCopySource: boolean;
  isPasteTarget: boolean;
  onDayTapTarget: () => void;
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
  // When true, omit the "+" add-window button — for single-window contexts
  // (the Playlist slot sheet allows exactly one time slot per day).
  hideAdd?: boolean;
  // Cross-day long-press selection wiring (managed by DayTimeWindowsList).
  selection?: DayTimeSelection;
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



// Relative-day label ("Today" / "Tomorrow" / "Nd away") — shared with the
// Playlist slot cards via lib/timeUtils.
const getRelativeDay = getRelativeDayLabel;

// Pill background + text per state. The border color is computed separately
// (pillBorderClass) so the voter form can show a thin outline on neutral pills
// while the creator form keeps them borderless. Layout-stable across states
// because PILL_BASE always sets `border` (1 px reserved) and exactly one
// border-color class is appended per pill. Filled bg is one step darker than
// the surfaces this renders on (the voter availability card is bg-gray-100/900,
// the create-poll card is white/gray-800), so pills stay legible on both
// without per-day card backing.
const PILL_BASE = 'w-[154px] py-1.5 rounded-full text-sm font-medium border transition-colors text-center select-none [-webkit-touch-callout:none] disabled:cursor-not-allowed';
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

// ── Slot enter/leave animation (creator form only) ──────────────────────────
// Each time slot is rendered inside a grid-rows clip that animates its height
// (and opacity) open on add and closed on remove, so the rest of the UI moves
// to make room. Stable ids are assigned via reconciliation so an EDIT (which
// re-sorts the list) doesn't read as a remove+add — only genuine adds/removes
// animate.
type SlotPhase = 'enter' | 'shown' | 'leave';
interface AnimRow {
  id: number;
  window: TimeWindow;
  phase: SlotPhase;
}

// Monotonic id source for animated rows. Module-level (not a ref) so the
// useState initializer can allocate ids without reading a ref during render
// (which the react-hooks lint rule forbids). Ids only need to be unique within
// a component instance; a global counter satisfies that trivially.
let nextSlotId = 0;
const allocSlotId = (): number => nextSlotId++;

function sameAnimRows(a: AnimRow[], b: AnimRow[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].phase !== b[i].phase || a[i].window !== b[i].window) {
      return false;
    }
  }
  return true;
}

// Reconcile the animated row list against the latest `windows` prop. Exact
// value matches first (unchanged slots keep their id), then positional pairing
// for in-place edits (id preserved, no animation), then leftover prop windows
// become entering rows (inserted at sorted position) and unmatched existing
// rows become leaving rows (kept in place so they collapse out where they sat).
// Returns the same array reference when nothing changed so the effect can't loop.
function reconcileRows(
  prev: AnimRow[],
  windows: TimeWindow[],
  allocId: () => number,
): AnimRow[] {
  const used = windows.map(() => false);
  const takeExact = (w: TimeWindow): number => {
    for (let i = 0; i < windows.length; i++) {
      if (!used[i] && windows[i].min === w.min && windows[i].max === w.max) {
        used[i] = true;
        return i;
      }
    }
    return -1;
  };
  const takeNext = (): number => {
    for (let i = 0; i < windows.length; i++) {
      if (!used[i]) { used[i] = true; return i; }
    }
    return -1;
  };

  const nonLeaving = prev.filter(r => r.phase !== 'leave');
  const assignment = new Map<number, number>(); // row id -> prop index (-1 => leave)
  for (const r of nonLeaving) {
    const idx = takeExact(r.window);
    if (idx >= 0) assignment.set(r.id, idx);
  }
  for (const r of nonLeaving) {
    if (!assignment.has(r.id)) assignment.set(r.id, takeNext());
  }

  const result: AnimRow[] = [];
  for (const r of prev) {
    if (r.phase === 'leave') { result.push(r); continue; }
    const idx = assignment.get(r.id);
    if (idx === undefined || idx < 0) {
      result.push({ ...r, phase: 'leave' });
    } else {
      const w = windows[idx];
      result.push(r.phase === 'shown' && r.window === w ? r : { ...r, window: w, phase: 'shown' });
    }
  }

  for (let i = 0; i < windows.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const w = windows[i];
    const row: AnimRow = { id: allocId(), window: w, phase: 'enter' };
    let insertAt = result.length;
    for (let j = 0; j < result.length; j++) {
      if (result[j].phase === 'leave') continue;
      if (result[j].window.min > w.min) { insertAt = j; break; }
    }
    result.splice(insertAt, 0, row);
  }

  return sameAnimRows(prev, result) ? prev : result;
}

// Grid-rows clip that animates a slot's height + opacity. New rows ('enter')
// mount collapsed and open on the next frame; removed rows ('leave') collapse
// and fire onLeaveDone once the height transition completes so the parent can
// drop them. Existing rows ('shown') render open with no animation.
function AnimatedSlotRow({
  phase,
  onLeaveDone,
  children,
}: {
  phase: SlotPhase;
  onLeaveDone: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(phase !== 'enter');
  // Clip content only WHILE animating. At rest (settled open) we switch to
  // overflow-visible so a selection ring (`ring-2`, drawn 2px OUTSIDE the pill)
  // isn't clipped at top/bottom by the height-collapse clip.
  const [clip, setClip] = useState(phase !== 'shown');
  useEffect(() => {
    if (phase === 'enter') {
      setClip(true);
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setOpen(true));
      });
      return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
    }
    if (phase === 'leave') {
      setClip(true);
      const raf = requestAnimationFrame(() => setOpen(false));
      return () => cancelAnimationFrame(raf);
    }
    setOpen(true);
    setClip(false);
  }, [phase]);

  return (
    <div
      className="grid"
      style={{
        gridTemplateRows: open ? '1fr' : '0fr',
        opacity: open ? 1 : 0,
        overflow: clip ? 'hidden' : 'visible',
        transition: 'grid-template-rows 300ms ease-in-out, opacity 300ms ease-in-out',
      }}
      onTransitionEnd={(e) => {
        if (e.propertyName !== 'grid-template-rows') return;
        if (phase === 'leave' && !open) onLeaveDone();
        // Settled open: stop clipping so the selection ring can paint past the
        // pill's edges.
        else if (open) setClip(false);
      }}
    >
      <div className="min-h-0" style={{ overflow: clip ? 'hidden' : 'visible' }}>{children}</div>
    </div>
  );
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
  hideAdd = false,
  selection,
}: DayTimeWindowsInputProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const isVoterForm = !!questionWindows;

  const sel = selection;
  const selectionActive = !!sel && sel.mode !== 'none';
  const inWindowsMode = sel?.mode === 'windows';
  const inCopyMode = sel?.mode === 'copy';

  // Long-press detection shared by the time-slot pills (enter 'windows' mode)
  // and the day label (open the copy context menu). One press happens at a time,
  // so a single shared ref is enough. `fired` is consulted by the pill onClick
  // to swallow the synthesized click that follows a long-press, then reset on
  // the next pointerdown.
  const lpRef = useRef<{ timer: number | null; sx: number; sy: number; fired: boolean }>({
    timer: null, sx: 0, sy: 0, fired: false,
  });
  const clearLp = () => {
    if (lpRef.current.timer !== null) {
      clearTimeout(lpRef.current.timer);
      lpRef.current.timer = null;
    }
  };
  useEffect(() => () => clearLp(), []);
  const longPressHandlers = (fire: (x: number, y: number) => void) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const x = e.clientX, y = e.clientY;
      clearLp();
      lpRef.current = {
        timer: window.setTimeout(() => {
          lpRef.current.fired = true;
          lpRef.current.timer = null;
          fire(x, y);
        }, 500),
        sx: x, sy: y, fired: false,
      };
    },
    onPointerMove: (e: React.PointerEvent) => {
      const s = lpRef.current;
      if (s.timer !== null && Math.hypot(e.clientX - s.sx, e.clientY - s.sy) > 10) clearLp();
    },
    onPointerUp: clearLp,
    onPointerLeave: clearLp,
    onPointerCancel: clearLp,
  });

  // Creator-form slot enter/leave animation. The voter form keeps its existing
  // ghost-row render path and is not animated.
  const [animRows, setAnimRows] = useState<AnimRow[]>(() =>
    windows.map(w => ({ id: allocSlotId(), window: w, phase: 'shown' as SlotPhase }))
  );
  useEffect(() => {
    if (isVoterForm) return;
    setAnimRows(prev => reconcileRows(prev, windows, allocSlotId));
  }, [windows, isVoterForm]);
  const handleAnimLeaveDone = (id: number) => {
    setAnimRows(prev => prev.filter(r => r.id !== id));
  };

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

  // Renders one time-slot pill, handling the three selection modes:
  //   • 'none'    — tap edits the window; long-press enters 'windows' mode.
  //   • 'windows' — tap toggles selection (blue ring); editing is suppressed.
  //   • 'copy'    — static display only, so taps fall through to the row's
  //                 day-target toggle.
  const renderWindowButton = (
    index: number,
    window: TimeWindow,
    variant: keyof typeof PILL_STATE_CLASSES,
  ) => {
    const cls = `${PILL_BASE} ${PILL_STATE_CLASSES[variant]} ${pillBorderClass(variant, isVoterForm)}`;
    if (inCopyMode) {
      return (
        <span className={`${cls} pointer-events-none`}>
          {renderPillContent(window, true)}
        </span>
      );
    }
    const selected = !!inWindowsMode && !!sel?.isWindowSelected(index);
    const lp = (!selectionActive && sel)
      ? longPressHandlers((x, y) => sel.onWindowLongPress(index, x, y))
      : {};
    return (
      <button
        type="button"
        {...lp}
        onClick={() => {
          if (lpRef.current.fired) { lpRef.current.fired = false; return; }
          if (inWindowsMode) { sel?.onWindowTap(index); return; }
          handleEditWindow(index);
        }}
        disabled={disabled}
        className={`${cls}${selected ? ' ring-2 ring-blue-500' : ''}`}
      >
        {renderPillContent(window, true)}
      </button>
    );
  };

  // Copy-mode chrome for the day row: a leading checkbox/marker + a row click
  // that toggles this day as a paste target (the source day is inert + dimmed).
  const dayLongPress = !selectionActive ? sel?.onDayLongPress : undefined;
  const dayLongPressHandlers = dayLongPress ? longPressHandlers(dayLongPress) : {};
  const copyTarget = inCopyMode && !sel?.isCopySource;
  const outerCopyClass = inCopyMode
    ? (sel?.isCopySource
        ? ' opacity-50'
        : (sel?.isPasteTarget ? ' bg-blue-50 dark:bg-blue-900/30 rounded-lg cursor-pointer' : ' cursor-pointer'))
    : '';

  return (
    <div
      className={
        (borderless
          ? 'flex items-center gap-3 min-h-12 py-2'
          : 'flex items-center gap-3 p-1.5 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700')
        + outerCopyClass
      }
      onClick={copyTarget ? () => sel?.onDayTapTarget() : undefined}
    >
      {/* Copy-mode marker: solid grey = source (inert), empty circle = an
          unselected paste target, blue check = a selected paste target. */}
      {inCopyMode && (
        <span
          className={`shrink-0 self-start mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center ${
            sel?.isCopySource
              ? 'bg-gray-300 dark:bg-gray-600 border-gray-300 dark:border-gray-600'
              : sel?.isPasteTarget
                ? 'bg-blue-600 border-blue-600'
                : 'border-gray-300 dark:border-gray-600'
          }`}
        >
          {sel?.isPasteTarget && (
            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          )}
        </span>
      )}

      {/* Fixed-width date column so the + button to its right lands at the
          same X on every row. 88 px fits the widest expected label in
          Geist Sans (date line ~81 px; abbreviated relative ~50 px).
          Long-press (in 'none' mode) opens the copy context menu. */}
      <div
        className={`w-[88px] self-start${dayLongPress ? ' select-none [-webkit-touch-callout:none]' : ''}`}
        {...dayLongPressHandlers}
      >
        <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {formatDayLabel(day)}
        </div>
        <div className="text-xs text-blue-500 dark:text-blue-400">
          {sel?.isCopySource ? 'Copying…' : getRelativeDay(day)}
        </div>
      </div>

      {/* Diameter matches the pill height (34 px); shrink-0 prevents
          flex pressure from squishing it; self-start centers it with the
          topmost pill regardless of slot count. Voters use it to split a
          window into disconnected segments (each added slot soft-validated
          against the creator's allowed windows). Hidden during selection
          modes to keep the row focused on the active gesture. */}
      {!selectionActive && !hideAdd && (
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
      )}

      {/* Ballot slots are all deletable (like the creation form). On the voter
          form, any original question window that no current slot overlaps is
          shown as a muted "ghost" row with an empty checkbox that re-adds it.
          Real + ghost rows are merged in start-time order. Windows arrive
          pre-sorted, so a slot intersects-or-touches its predecessor iff its
          start time is <= the previous end time. Creators keep the "can't
          delete the last slot" rule (use the day picker to remove a day);
          voters may clear a day entirely and re-add via a ghost checkbox. */}
      {isVoterForm ? (
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
            // Suppressed in the read-only summary (`disabled`) and during a
            // selection gesture — there they'd read as "options you forgot"
            // rather than a re-add affordance / aren't real selectable windows.
            const ghostRows: Row[] = isVoterForm && !disabled && !selectionActive
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
              const showTrash = (isVoterForm || windows.length > 1) && !selectionActive;
              const variant = pillVariant(row.isTooShort, row.flagged);
              return (
                <div key={`win-${row.index}`} className="flex items-center gap-[7px]">
                  {showTrash ? renderDeleteButton(row.index) : null}
                  {renderWindowButton(row.index, row.window, variant)}
                </div>
              );
            });
          })()}
        </div>
      ) : (
        // Creator form: each slot animates its height (and the rest of the UI
        // moving to make room) on add/remove. The inter-row spacing is `pb-2`
        // INSIDE each animated clip so it collapses with the row rather than
        // leaving an 8px gap snap. Rows not present in `windows` (mid-leave, or
        // the one-frame window before the reconcile effect runs) render as a
        // neutral non-interactive pill.
        <div className="flex-1 flex flex-col items-stretch">
          {animRows.map((row, idx) => {
            const index = windows.indexOf(row.window);
            const isPresent = index >= 0;
            const duration = isPresent ? windowDurationMinutes(row.window) : 0;
            const isTooShort = isPresent && minDurationMinutes != null && minDurationMinutes > 0
              && duration < minDurationMinutes;
            const prevWin = isPresent && index > 0 ? windows[index - 1] : null;
            const intersectsPrev = !!prevWin && row.window.min <= prevWin.max;
            const variant = isPresent ? pillVariant(isTooShort, intersectsPrev) : 'normal';
            const showTrash = isPresent && windows.length > 1 && !selectionActive;
            return (
              <AnimatedSlotRow
                key={row.id}
                phase={row.phase}
                onLeaveDone={() => handleAnimLeaveDone(row.id)}
              >
                {/* Inter-row gap lives in `pt-2` INSIDE the clip (so it
                    collapses with enter/leave) but is skipped on the first row
                    so there's no static trailing/leading space against the
                    day's hairline dividers. */}
                <div className={`${idx > 0 ? 'pt-2' : ''} flex justify-end`}>
                  <div className="flex items-center gap-[7px]">
                    {showTrash ? renderDeleteButton(index) : null}
                    {isPresent ? (
                      renderWindowButton(index, row.window, variant)
                    ) : (
                      <span
                        className={`${PILL_BASE} ${PILL_STATE_CLASSES.normal} ${pillBorderClass('normal', isVoterForm)}`}
                        aria-hidden="true"
                      >
                        {renderPillContent(row.window, true)}
                      </span>
                    )}
                  </div>
                </div>
              </AnimatedSlotRow>
            );
          })}
        </div>
      )}

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
