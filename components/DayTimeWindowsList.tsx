'use client';

import { useState, useEffect } from 'react';
import ModalPortal from './ModalPortal';
import TimeGridModal from './TimeGridModal';
import DayTimeWindowsInput from './DayTimeWindowsInput';
import { haptic } from '@/lib/haptics';
import type { DayTimeWindow, TimeWindow } from '@/lib/types';

// Coordinator for a multi-day list of DayTimeWindowsInput rows. Owns the
// cross-day long-press selection state that no single per-day row can hold:
//   • 'windows' — long-press a time-slot pill to multi-select pills (across any
//     days), then "Edit" opens one modal that sets them all to the same window.
//   • 'copy'    — long-press a day to open a context menu; "Copy" enters paste
//     mode where you tap other days (the source greys out) and "Paste" copies
//     the source day's slots onto every selected day.
// Renders the same `divide-y` row list both call sites used before (create-poll
// Time Windows card + the voter ballot's TimeQuestionFields), plus the floating
// action toolbar / context menu (portaled) and the shared bulk-edit modal.

interface DayTimeWindowsListProps {
  dayTimeWindows: DayTimeWindow[];
  // Full-list setter. Bulk ops (edit-many / paste) MUST go through one call so
  // they don't clobber each other via stale closures (the per-day onChange in
  // useDayTimeWindowsState rebuilds from `value` each call).
  onChange: (next: DayTimeWindow[]) => void;
  disabled?: boolean;
  minDurationMinutes?: number | null;
  // Presence ⇒ voter form (constrains/soft-validates each day's windows).
  questionDayTimeWindows?: DayTimeWindow[];
}

const winKey = (day: string, index: number) => `${day}#${index}`;

export default function DayTimeWindowsList({
  dayTimeWindows,
  onChange,
  disabled = false,
  minDurationMinutes,
  questionDayTimeWindows,
}: DayTimeWindowsListProps) {
  const [mode, setMode] = useState<'none' | 'windows' | 'copy'>('none');
  const [selectedWindows, setSelectedWindows] = useState<Set<string>>(() => new Set());
  const [copySource, setCopySource] = useState<string | null>(null);
  const [targetDays, setTargetDays] = useState<Set<string>>(() => new Set());
  const [menu, setMenu] = useState<{ day: string; x: number; y: number } | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  // Signature of the day set so we can drop any in-flight selection if the days
  // change underneath us (e.g. the calendar adds/removes a day mid-gesture) —
  // stale keys/indices would otherwise apply to the wrong windows.
  const dayKeySig = dayTimeWindows.map((d) => d.day).join('|');
  useEffect(() => {
    setMode('none');
    setSelectedWindows(new Set());
    setCopySource(null);
    setTargetDays(new Set());
    setMenu(null);
    setEditOpen(false);
  }, [disabled, dayKeySig]);

  // Close the context menu on any outside pointerdown.
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t?.closest?.('[data-day-menu="true"]')) setMenu(null);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [menu]);

  // Per-day single-window edit (mirrors useDayTimeWindowsState.onWindowsChange:
  // always re-sort by start time so the "intersects previous" validation holds).
  const setDayWindows = (day: string, windows: TimeWindow[]) => {
    const sorted = [...windows].sort((a, b) => a.min.localeCompare(b.min));
    onChange(dayTimeWindows.map((d) => (d.day === day ? { ...d, windows: sorted } : d)));
  };

  const exitSelection = () => {
    setMode('none');
    setSelectedWindows(new Set());
    setCopySource(null);
    setTargetDays(new Set());
  };

  // ── windows mode ──────────────────────────────────────────────────────────
  const enterWindows = (day: string, index: number) => {
    haptic.medium();
    setMode('windows');
    setSelectedWindows(new Set([winKey(day, index)]));
  };
  const toggleWindow = (day: string, index: number) => {
    setSelectedWindows((prev) => {
      const next = new Set(prev);
      const k = winKey(day, index);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };
  const seedWindow = (): TimeWindow | null => {
    for (const d of dayTimeWindows) {
      for (let i = 0; i < d.windows.length; i++) {
        if (selectedWindows.has(winKey(d.day, i))) return d.windows[i];
      }
    }
    return null;
  };
  const applyBulkEdit = (min: string | null, max: string | null) => {
    if (!min || !max) return;
    const next = dayTimeWindows.map((d) => {
      const edited = d.windows.map((w, i) =>
        selectedWindows.has(winKey(d.day, i)) ? { ...w, min, max } : w,
      );
      // Collapsing multiple slots in one day to identical times shouldn't leave
      // exact duplicates; dedupe by min-max, then re-sort by start.
      const seen = new Set<string>();
      const deduped = edited.filter((w) => {
        const k = `${w.min}-${w.max}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      return { ...d, windows: [...deduped].sort((a, b) => a.min.localeCompare(b.min)) };
    });
    haptic.medium();
    onChange(next);
    setEditOpen(false);
    exitSelection();
  };

  // ── copy mode ─────────────────────────────────────────────────────────────
  const openMenu = (day: string, x: number, y: number) => {
    haptic.medium();
    setMenu({ day, x, y });
  };
  const startCopy = (day: string) => {
    setMode('copy');
    setCopySource(day);
    setTargetDays(new Set());
    setMenu(null);
  };
  const toggleTarget = (day: string) => {
    setTargetDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day); else next.add(day);
      return next;
    });
  };
  const applyPaste = () => {
    if (!copySource || targetDays.size === 0) return;
    const src = dayTimeWindows.find((d) => d.day === copySource);
    if (!src) { exitSelection(); return; }
    haptic.medium();
    onChange(
      dayTimeWindows.map((d) =>
        targetDays.has(d.day) && d.day !== copySource
          ? { ...d, windows: src.windows.map((w) => ({ ...w })) }
          : d,
      ),
    );
    exitSelection();
  };

  const selectionEnabled = !disabled && dayTimeWindows.length > 0;
  const canCopy = dayTimeWindows.length >= 2;
  const seed = editOpen ? seedWindow() : null;
  const showToolbar = selectionEnabled && mode !== 'none' && !editOpen;

  return (
    <>
      <div className="divide-y divide-gray-200 dark:divide-gray-700">
        {dayTimeWindows.map((dtw) => (
          <DayTimeWindowsInput
            key={dtw.day}
            day={dtw.day}
            windows={dtw.windows}
            onChange={(w) => setDayWindows(dtw.day, w)}
            onDelete={() => {}}
            disabled={disabled}
            questionWindows={questionDayTimeWindows?.find((p) => p.day === dtw.day)?.windows}
            minDurationMinutes={minDurationMinutes}
            allDays={dayTimeWindows}
            borderless
            selection={selectionEnabled ? {
              mode,
              isWindowSelected: (i) => selectedWindows.has(winKey(dtw.day, i)),
              onWindowLongPress: (i) => enterWindows(dtw.day, i),
              onWindowTap: (i) => toggleWindow(dtw.day, i),
              onDayLongPress: canCopy ? (x, y) => openMenu(dtw.day, x, y) : undefined,
              isCopySource: copySource === dtw.day,
              isPasteTarget: targetDays.has(dtw.day),
              onDayTapTarget: () => toggleTarget(dtw.day),
            } : undefined}
          />
        ))}
      </div>

      {/* Copy context menu — fixed near the long-pressed day, portaled out so it
          isn't clipped by the scrollable card and clears the create-poll sheet. */}
      {menu && (
        <ModalPortal>
          <div
            data-day-menu="true"
            className="fixed z-[66] rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl py-1"
            style={{
              top: Math.min(menu.y, (typeof window !== 'undefined' ? window.innerHeight : 0) - 60),
              left: Math.min(menu.x, (typeof window !== 'undefined' ? window.innerWidth : 0) - 180),
            }}
          >
            <button
              type="button"
              onClick={() => startCopy(menu.day)}
              className="flex items-center gap-2 w-full px-4 py-2 text-sm font-medium text-gray-800 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Copy times to other days
            </button>
          </div>
        </ModalPortal>
      )}

      {/* Floating action toolbar (Edit-many / Paste + Cancel). z-[65] clears the
          create-poll bottom sheet (z-60); hidden while the bulk-edit modal is up. */}
      {showToolbar && (
        <ModalPortal>
          <div
            data-time-selection-toolbar="true"
            className="fixed left-1/2 -translate-x-1/2 z-[65] animate-slide-up"
            style={{ bottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
          >
            <div className="flex items-center gap-2 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 shadow-xl">
              {mode === 'windows' ? (
                <button
                  type="button"
                  onClick={() => setEditOpen(true)}
                  disabled={selectedWindows.size === 0}
                  className="h-10 px-4 rounded-full text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-transform active:scale-95 disabled:opacity-50"
                >
                  {`Edit ${selectedWindows.size || ''}`.trim()}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={applyPaste}
                  disabled={targetDays.size === 0}
                  className="h-10 px-4 rounded-full text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-transform active:scale-95 disabled:opacity-50"
                >
                  {`Paste ${targetDays.size || ''}`.trim()}
                </button>
              )}
              <button
                type="button"
                onClick={exitSelection}
                aria-label="Cancel selection"
                className="h-10 w-10 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </ModalPortal>
      )}

      {/* Bulk-edit modal: one window value applied to every selected pill. */}
      <TimeGridModal
        isOpen={editOpen}
        onClose={() => setEditOpen(false)}
        minValue={seed?.min ?? '09:00'}
        maxValue={seed?.max ?? '17:00'}
        onApply={applyBulkEdit}
        minDurationMinutes={minDurationMinutes}
      />
    </>
  );
}
