"use client";

/**
 * Slot sheet for the home Playlist tab — THREE MODES, one facet each:
 *
 *   - 'create' ("+ Slot" FAB): just the calendar + a SINGLE time slot for a
 *     SINGLE day (picking another day moves the selection; the one window has
 *     no "+" to add more). Saves a slot with NO activities — the timeline then
 *     shows an "+ Add activities" button on it.
 *   - 'time' (tap a slot's time text): the same calendar + single-slot UI,
 *     prefilled, editing JUST the date/time. "Delete slot" lives here.
 *   - 'activities' (tap a slot's activity cards / "+ Add activities"): JUST
 *     the activities editor — typed rows + the suggestion checkbox list.
 *
 * Chrome mirrors the create-poll sheet (stationary dim backdrop at z-[59],
 * bottom-anchored opaque sheet at z-[60], fixed full height with the same
 * small top gap, ✕ / title / ✓ header) so the sheets read as one family.
 *
 * Activities mode: a "+" in the header appends a typed activity and opens the
 * activity EDITOR sub-panel (the create-poll question-editor slide-in — ← back
 * + rightward-swipe-back; edits apply LIVE, the sheet's ✓/✕ saves or cancels).
 * There you set the activity's name, emoji, and an optional PARTICIPANT range
 * (min/max people via <MinMaxCounter>). Below the typed rows, a CHECKBOX list
 * of suggested activities in three labeled, priority-ordered groups (others
 * planning this period / your past picks / others' past picks); already-added
 * activities are hidden from it. Only the "you've picked before" group carries
 * an ✕ — deleting one (behind a confirmation) blacklists it. An existing
 * activity's who-with entries ride through the edit unchanged (no editor UI
 * for them yet).
 *
 * The ✓ saves the touched facet only — apiCreateSlot in create mode,
 * apiUpdateSlot (keeping the OTHER facet as-is) in the edit modes — fires
 * SLOTS_CHANGED (so the Playlist tab re-fetches), then closes.
 *
 * Mounted once at layout level (CreateGroupButtonHost) and opened via the
 * slot-sheet event channel (openSlotSheet(slot?, mode?)). Self-manages its
 * open + mode state.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DaysSelector from "@/components/DaysSelector";
import DayTimeWindowsList from "@/components/DayTimeWindowsList";
import EmojiPickerModal from "@/components/EmojiPickerModal";
import ConfirmationModal from "@/components/ConfirmationModal";
import MinMaxCounter from "@/components/MinMaxCounter";
import ModalPortal from "@/components/ModalPortal";
import WhoWithCard from "@/components/WhoWithCard";
import { useBodyScrollLock } from "@/lib/useBodyScrollLock";
import { useSheetDismissGesture } from "@/lib/useSheetDismissGesture";
import { DEFAULT_TIME_WINDOW, formatMonthYearLabel, shiftMonth } from "@/lib/timeUtils";
import { formatPeopleRange } from "@/lib/slotUtils";
import { haptic } from "@/lib/haptics";
import {
  apiCreateSlot,
  apiUpdateSlot,
  apiDeleteSlot,
  apiGetActivitySuggestions,
  type ActivitySuggestion,
  type ActivitySuggestions,
  type Slot,
  type SlotActivity,
  type WhoWithEntry,
} from "@/lib/api/slots";
import { apiAddActivityBlacklist } from "@/lib/api/users";
import {
  SLOT_SHEET_OPEN_EVENT,
  notifySlotsChanged,
  type SlotSheetMode,
  type SlotSheetOpenDetail,
} from "@/lib/slotEvents";
import type { DayTimeWindow } from "@/lib/types";

/** A user-typed activity + its chosen emoji ("" = none, picker faded) + an
 *  optional participant range (null = unset). `whoWith` is carried through
 *  from an existing activity so an activities edit doesn't drop it (there's
 *  no editor UI for the entries yet). */
interface CustomActivity {
  name: string;
  emoji: string;
  minPeople: number | null;
  maxPeople: number | null;
  whoWith: WhoWithEntry[] | null;
}

// Faded placeholder glyph on an activity row's emoji chip / in the picker
// input when no emoji is chosen (activities have no per-category default).
const EMOJI_PLACEHOLDER = "🙂";

const EMPTY_SUGGESTIONS: ActivitySuggestions = { overlapping: [], yours: [], others: [] };

const SUGGESTION_GROUPS: { key: keyof ActivitySuggestions; label: string }[] = [
  { key: "overlapping", label: "Others planning this time" },
  { key: "yours", label: "You've picked before" },
  { key: "others", label: "Others have picked" },
];

// Same top gap as the create-poll sheets (SHEET_TOP_GAP there).
const SHEET_HEIGHT = "calc(100dvh - env(safe-area-inset-top, 0px) - 1.25rem)";

// Activity-editor sub-panel slide + swipe-back (ported from the create-poll
// question editor). Edits apply LIVE to customActivities, so ← / ✓ / swipe all
// just close — there's nothing to commit or revert.
const SUB_SLIDE_MS = 300;
const SUB_SLIDE_TRANSITION = `transform ${SUB_SLIDE_MS}ms ease`;
const SUB_SWIPE_RECOGNIZE_PX = 10;
const SUB_SWIPE_COMMIT_RATIO = 0.3;
const SUB_SWIPE_COMMIT_VELOCITY = 0.5; // px/ms
const SUB_SWIPE_SNAP_BACK_MS = 220;
const SUB_SWIPE_EASING = "cubic-bezier(0.32, 0.72, 0, 1)";
// UI cap on the participants counter; the server clamps to the same bound in
// services/slots.py (_clean_people). Keep in lockstep.
const MAX_PEOPLE = 999;

const monthOfToday = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
};

/** The calendar month to show when opening: the slot's earliest day (edit) or
 *  the current month (new). */
function monthForSlot(slot: Slot | null): Date {
  const days = (slot?.day_time_windows ?? [])
    .map((dtw) => dtw.day)
    .filter(Boolean)
    .sort();
  if (days.length > 0) {
    const d = new Date(days[0] + "T00:00:00");
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }
  return monthOfToday();
}

/** Whether every day the slot picks already falls inside the compact grid's
 *  rolling 21-day window (the Sunday of this week + 3 weeks — mirrors the
 *  compact branch of DaysSelector's calendarDays). When true, editing can
 *  open collapsed because the picked days are already visible; otherwise the
 *  calendar must expand to the slot's month to show them. A slot with no days
 *  (or none — new) counts as visible. */
function slotDaysVisibleInCompact(slot: Slot | null): boolean {
  const days = (slot?.day_time_windows ?? []).map((dtw) => dtw.day).filter(Boolean);
  if (days.length === 0) return true;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay());
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 20);
  return days.every((day) => {
    const d = new Date(day + "T00:00:00");
    return d >= start && d <= end;
  });
}

/**
 * Layout-level create/edit slot sheet. Opened via the slot-sheet event channel
 * (openSlotSheet()) — the "+ Slot" FAB dispatches a new slot, a Playlist card
 * tap dispatches the slot to edit. Self-manages its open + editing state.
 */
export default function NewSlotSheet() {
  const [isOpen, setIsOpen] = useState(false);
  // Which facet the sheet edits: 'create' (new slot, schedule only), 'time'
  // (existing slot's date/time), 'activities' (existing slot's activities).
  const [mode, setMode] = useState<SlotSheetMode>("create");
  // The slot being edited (null = creating a new one).
  const [editingSlot, setEditingSlot] = useState<Slot | null>(null);
  const [dayTimeWindows, setDayTimeWindows] = useState<DayTimeWindow[]>([]);
  // User-typed activities (added via the "+" next to the Activities header),
  // each with an optional chosen emoji + participant range.
  const [customActivities, setCustomActivities] = useState<CustomActivity[]>([]);
  // Which custom row's emoji picker is open (null = closed).
  const [emojiEditIndex, setEmojiEditIndex] = useState<number | null>(null);
  // Which custom row's editor sub-panel is open (null = none).
  const [activityEditIndex, setActivityEditIndex] = useState<number | null>(null);
  const [subSlideIn, setSubSlideIn] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState<Date>(monthOfToday);
  const [calendarExpanded, setCalendarExpanded] = useState(false);
  const [suggestions, setSuggestions] = useState<ActivitySuggestions>(EMPTY_SUGGESTIONS);
  // Checked suggestion NAMES. Lowercase-compared on toggle so a suggestion +
  // a typed custom with the same text don't double-save.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Activity name awaiting delete confirmation (null = no confirm open). Only
  // "you've picked before" suggestions can be deleted (→ blacklisted).
  const [pendingBlacklist, setPendingBlacklist] = useState<string | null>(null);
  const isEditing = editingSlot !== null;
  const showSchedule = mode !== "activities";
  const showActivities = mode === "activities";

  // Day selection is derived from the windows list. SINGLE-day model: picking
  // another day MOVES the selection there (keeping the current time window);
  // tapping the selected day clears it. DaysSelector reports the full new
  // selection array, so the entry not matching the current day is the pick.
  const selectedDays = dayTimeWindows.map((dtw) => dtw.day);
  const handleDaysSelected = useCallback((days: string[]) => {
    setDayTimeWindows((prev) => {
      const current = prev[0];
      const newDay = days.find((d) => d !== current?.day);
      if (newDay) {
        return [{ day: newDay, windows: [current?.windows[0] ?? { ...DEFAULT_TIME_WINDOW }] }];
      }
      return days.length === 0 ? [] : prev;
    });
  }, []);

  useBodyScrollLock(isOpen);

  const close = useCallback(() => setIsOpen(false), []);

  // Open driven by the slot-sheet event channel. Time mode prefills the
  // window and centers the calendar on the slot's day; activities mode loads
  // the slot's existing activities as editable typed rows (with their emoji +
  // participant range + carried-through who-with). A new slot starts blank on
  // today's month.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<SlotSheetOpenDetail>).detail;
      const slot = detail?.slot ?? null;
      setMode(detail?.mode ?? (slot ? "time" : "create"));
      setEditingSlot(slot);
      setDayTimeWindows(slot ? slot.day_time_windows : []);
      setCustomActivities(
        slot
          ? slot.activities.map((a) => ({
              name: a.name,
              emoji: a.emoji ?? "",
              minPeople: a.min_people ?? null,
              maxPeople: a.max_people ?? null,
              whoWith: a.who_with ?? null,
            }))
          : [],
      );
      setEmojiEditIndex(null);
      setActivityEditIndex(null);
      setSubSlideIn(false);
      setCalendarMonth(monthForSlot(slot));
      // Editing time: expand to the slot's real month ONLY when its picked
      // days fall outside the compact grid's rolling 3 weeks from today; if
      // they're already visible there, open collapsed. New: compact,
      // today-anchored.
      setCalendarExpanded(slot !== null && !slotDaysVisibleInCompact(slot));
      setSuggestions(EMPTY_SUGGESTIONS);
      setSelected(new Set());
      setSaving(false);
      setDeleting(false);
      setPendingBlacklist(null);
      setIsOpen(true);
    };
    window.addEventListener(SLOT_SHEET_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(SLOT_SHEET_OPEN_EVENT, onOpen);
  }, []);

  // Fetch ranked activity suggestions, debounced on the selected period
  // (group 1 depends on which windows overlap other users' slots). A
  // request token guards against a stale response landing after a newer one.
  const dtwKey = JSON.stringify(dayTimeWindows);
  const reqTokenRef = useRef(0);
  useEffect(() => {
    if (!isOpen || !showActivities) return;
    const token = ++reqTokenRef.current;
    const t = setTimeout(() => {
      apiGetActivitySuggestions(dayTimeWindows)
        .then((res) => {
          if (reqTokenRef.current === token) setSuggestions(res);
        })
        .catch(() => {
          if (reqTokenRef.current === token) setSuggestions(EMPTY_SUGGESTIONS);
        });
    }, 350);
    return () => clearTimeout(t);
    // dtwKey is the stable content signature of dayTimeWindows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, showActivities, dtwKey]);

  const toggleSelected = useCallback((activity: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(activity)) next.delete(activity);
      else next.add(activity);
      return next;
    });
  }, []);

  // ---- Custom activity rows + editor sub-panel ------------------------------

  const updateCustom = useCallback((i: number, name: string) => {
    setCustomActivities((prev) => prev.map((a, j) => (j === i ? { ...a, name } : a)));
  }, []);
  const setCustomEmoji = useCallback((i: number, emoji: string) => {
    setCustomActivities((prev) => prev.map((a, j) => (j === i ? { ...a, emoji } : a)));
  }, []);
  const setMinPeople = useCallback((i: number, v: number | null) => {
    setCustomActivities((prev) => prev.map((a, j) => (j === i ? { ...a, minPeople: v } : a)));
  }, []);
  const setMaxPeople = useCallback((i: number, v: number | null) => {
    setCustomActivities((prev) => prev.map((a, j) => (j === i ? { ...a, maxPeople: v } : a)));
  }, []);
  const removeCustom = useCallback((i: number) => {
    setCustomActivities((prev) => prev.filter((_, j) => j !== i));
  }, []);

  // Slide the editor sub-panel in: mount it off-screen (subSlideIn=false) then,
  // after the mount paints, flip to true so the transform transition runs.
  const slideInSub = useCallback(() => {
    setSubSlideIn(false);
    requestAnimationFrame(() => requestAnimationFrame(() => setSubSlideIn(true)));
  }, []);

  const activityEditIndexRef = useRef<number | null>(null);
  useEffect(() => {
    activityEditIndexRef.current = activityEditIndex;
  }, [activityEditIndex]);

  // Auto-focus the name field only for a freshly-added ("+") activity, not when
  // opening an existing row (avoids popping the keyboard on every edit).
  const focusNameOnOpenRef = useRef(false);
  const setNameInputRef = useCallback((el: HTMLInputElement | null) => {
    if (el && focusNameOnOpenRef.current) {
      focusNameOnOpenRef.current = false;
      el.focus();
    }
  }, []);

  // Tap a typed activity row → slide in its editor.
  const openActivityEdit = useCallback((index: number) => {
    setActivityEditIndex(index);
    slideInSub();
  }, [slideInSub]);

  // "+" → append a blank activity and open its editor with the name focused
  // (read customActivities.length directly, so NOT memoized).
  const addActivity = () => {
    const idx = customActivities.length;
    focusNameOnOpenRef.current = true;
    setCustomActivities((prev) => [...prev, { name: "", emoji: "", minPeople: null, maxPeople: null }]);
    setActivityEditIndex(idx);
    slideInSub();
  };

  // Close the editor and slide it back; a left-blank activity is dropped so an
  // abandoned "+" doesn't leave an empty row.
  const closeActivityEdit = useCallback(() => {
    const idx = activityEditIndexRef.current;
    setSubSlideIn(false);
    window.setTimeout(() => {
      if (idx !== null) {
        setCustomActivities((prev) => {
          const row = prev[idx];
          return row && !row.name.trim() ? prev.filter((_, j) => j !== idx) : prev;
        });
      }
      setActivityEditIndex(null);
    }, SUB_SLIDE_MS);
  }, []);

  // Swipe-to-go-back on the editor sub-panel (mirrors the create-poll question
  // editor). The resting transform is React-state-driven (subSlideIn); during a
  // drag we imperatively override transform/transition, then commit (close) or
  // snap back. closeActivityEdit is `[]`-stable (reads state via refs), so the
  // touch handlers can depend on it directly and still never rebind.
  const subPanelRef = useRef<HTMLDivElement | null>(null);
  const subSwipeRef = useRef<{
    startX: number;
    startY: number;
    startTime: number;
    swiping: boolean;
    ignored: boolean;
  } | null>(null);

  const handleSubPanelTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length !== 1) {
      subSwipeRef.current = null;
      return;
    }
    subSwipeRef.current = {
      startX: e.touches[0].clientX,
      startY: e.touches[0].clientY,
      startTime: Date.now(),
      swiping: false,
      ignored: false,
    };
  }, []);

  const handleSubPanelTouchMove = useCallback((e: React.TouchEvent) => {
    const st = subSwipeRef.current;
    if (!st || st.ignored) return;
    if (e.touches.length !== 1) {
      st.ignored = true;
      return;
    }
    const dx = e.touches[0].clientX - st.startX;
    const dy = e.touches[0].clientY - st.startY;
    if (!st.swiping) {
      if (Math.abs(dx) < SUB_SWIPE_RECOGNIZE_PX && Math.abs(dy) < SUB_SWIPE_RECOGNIZE_PX) return;
      if (Math.abs(dy) >= Math.abs(dx) || dx <= 0) {
        st.ignored = true;
        return;
      }
      st.swiping = true;
    }
    const el = subPanelRef.current;
    if (el) {
      el.style.transition = "none";
      el.style.transform = `translateX(${Math.max(0, dx)}px)`;
    }
  }, []);

  const handleSubPanelTouchEnd = useCallback((e: React.TouchEvent) => {
    const st = subSwipeRef.current;
    subSwipeRef.current = null;
    if (!st || !st.swiping || st.ignored) return;
    const endX = e.changedTouches[0]?.clientX ?? st.startX;
    const dx = Math.max(0, endX - st.startX);
    const dt = Date.now() - st.startTime;
    const velocity = (endX - st.startX) / Math.max(1, dt);
    const el = subPanelRef.current;
    const width = el?.offsetWidth ?? window.innerWidth;
    const shouldCommit = dx >= width * SUB_SWIPE_COMMIT_RATIO || velocity >= SUB_SWIPE_COMMIT_VELOCITY;
    if (shouldCommit) {
      // Restore the resting transition imperatively first: React won't re-apply
      // it on the close re-render (the `transition` prop string is unchanged
      // from the drag's `none` override), and only `transform` changes to
      // translateX(100%) — so without this the slide-off would snap.
      if (el) el.style.transition = SUB_SLIDE_TRANSITION;
      closeActivityEdit();
    } else if (el) {
      el.style.transition = `transform ${SUB_SWIPE_SNAP_BACK_MS}ms ${SUB_SWIPE_EASING}`;
      el.style.transform = "translateX(0)";
      window.setTimeout(() => {
        if (subPanelRef.current === el) {
          el.style.transition = SUB_SLIDE_TRANSITION;
          el.style.transform = "translateX(0)";
        }
      }, SUB_SWIPE_SNAP_BACK_MS + 20);
    }
  }, [closeActivityEdit]);

  // Confirmed ✕ on a "you've picked before" suggestion: remove it from every
  // group + selection immediately and add it to the account's blacklist so
  // it's never suggested again.
  const blacklistActivity = useCallback((activity: string) => {
    haptic.medium();
    setSuggestions((prev) => {
      const drop = (list: ActivitySuggestion[]) =>
        list.filter((a) => a.name.toLowerCase() !== activity.toLowerCase());
      return {
        overlapping: drop(prev.overlapping),
        yours: drop(prev.yours),
        others: drop(prev.others),
      };
    });
    setSelected((prev) => {
      if (!prev.has(activity)) return prev;
      const next = new Set(prev);
      next.delete(activity);
      return next;
    });
    void apiAddActivityBlacklist(activity).catch(() => {});
  }, []);

  // ✓ saves the mode's facet only: create → new slot (no activities); time →
  // just the schedule (activities as-is); activities → just the activities
  // (schedule as-is).
  const handleSave = useCallback(() => {
    if (saving || deleting) return;
    if (mode !== "activities" && dayTimeWindows.length === 0) return;
    let req: Promise<unknown>;
    if (mode === "create") {
      req = apiCreateSlot(dayTimeWindows, []);
    } else if (mode === "time") {
      if (!editingSlot) return;
      req = apiUpdateSlot(editingSlot.id, dayTimeWindows, editingSlot.activities);
    } else {
      if (!editingSlot) return;
      // A checked suggestion carries the emoji from its suggestion row.
      const suggEmoji = new Map<string, string | null>();
      for (const g of SUGGESTION_GROUPS) {
        for (const s of suggestions[g.key]) suggEmoji.set(s.name.toLowerCase(), s.emoji);
      }
      // Merge checked suggestions + typed customs (selected first, so a shared
      // name keeps the suggestion's emoji), deduped case-insensitively. Only
      // the typed customs carry a participant range / who-with entries.
      const seen = new Set<string>();
      const activities: SlotActivity[] = [];
      const push = (
        name: string,
        emoji?: string | null,
        minPeople?: number | null,
        maxPeople?: number | null,
        whoWith?: WhoWithEntry[] | null,
      ) => {
        const t = name.trim();
        if (!t) return;
        const key = t.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        activities.push({
          name: t,
          emoji: emoji || null,
          min_people: minPeople ?? null,
          max_people: maxPeople ?? null,
          who_with: whoWith ?? null,
        });
      };
      for (const name of selected) push(name, suggEmoji.get(name.toLowerCase()));
      for (const c of customActivities) push(c.name, c.emoji, c.minPeople, c.maxPeople, c.whoWith);
      req = apiUpdateSlot(editingSlot.id, editingSlot.day_time_windows, activities);
    }
    setSaving(true);
    haptic.success();
    req
      .then(() => {
        notifySlotsChanged();
        close();
      })
      .catch(() => setSaving(false));
  }, [saving, deleting, mode, dayTimeWindows, selected, customActivities, suggestions, editingSlot, close]);

  // Delete the slot being edited (edit mode only).
  const handleDelete = useCallback(() => {
    if (!editingSlot || saving || deleting) return;
    setDeleting(true);
    haptic.medium();
    apiDeleteSlot(editingSlot.id)
      .then(() => {
        notifySlotsChanged();
        close();
      })
      .catch(() => setDeleting(false));
  }, [editingSlot, saving, deleting, close]);

  // Activities already on the slot (typed custom rows) shouldn't ALSO appear
  // as suggestions below — hide any suggestion whose name matches a typed row
  // (case-insensitive). Chiefly visible when editing, where the slot's
  // existing activities are pre-loaded as custom rows.
  const addedKeys = useMemo(
    () =>
      new Set(
        customActivities
          .map((c) => c.name.trim().toLowerCase())
          .filter(Boolean),
      ),
    [customActivities],
  );
  const filteredSuggestions = useMemo<ActivitySuggestions>(() => {
    const drop = (list: ActivitySuggestion[]) =>
      list.filter((a) => !addedKeys.has(a.name.trim().toLowerCase()));
    return {
      overlapping: drop(suggestions.overlapping),
      yours: drop(suggestions.yours),
      others: drop(suggestions.others),
    };
  }, [suggestions, addedKeys]);

  // Any suggestion group has (visible) items?
  const hasSuggestions = useMemo(
    () => SUGGESTION_GROUPS.some((g) => filteredSuggestions[g.key].length > 0),
    [filteredSuggestions],
  );

  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // A stacked modal (emoji picker or delete confirm) consumes Escape.
      if (emojiEditIndex !== null || pendingBlacklist !== null) return;
      // Else the activity editor closes before the whole sheet.
      if (activityEditIndex !== null) {
        closeActivityEdit();
        return;
      }
      close();
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [isOpen, close, emojiEditIndex, pendingBlacklist, activityEditIndex, closeActivityEdit]);

  // Collapsing snaps the month back to today's (the compact grid is
  // today-anchored, so a navigated-away month would disagree with it) —
  // same rule as the create-poll Days card.
  useEffect(() => {
    if (calendarExpanded) return;
    setCalendarMonth((prev) => {
      const next = monthOfToday();
      return prev.getFullYear() === next.getFullYear() && prev.getMonth() === next.getMonth()
        ? prev
        : next;
    });
  }, [calendarExpanded]);

  // Swipe-down-to-dismiss (native iOS sheet behavior), shared with the
  // create-poll sheet. Yields while the activity editor is open so its
  // rightward-swipe-back doesn't fight the sheet's downward dismiss.
  const sheetScrollerNodeRef = useRef<HTMLDivElement | null>(null);
  const { sheetRef, backdropRef, touchHandlers } = useSheetDismissGesture({
    scrollerRef: sheetScrollerNodeRef,
    onDismiss: close,
    canStart: () => activityEditIndexRef.current === null,
  });

  // The custom row whose emoji picker is open (undefined = closed).
  const editingCustom = emojiEditIndex !== null ? customActivities[emojiEditIndex] : undefined;
  // The custom row whose editor sub-panel is open (undefined = closed).
  const editingActivity =
    activityEditIndex !== null ? customActivities[activityEditIndex] : undefined;

  if (!isOpen) return null;

  return (
    <ModalPortal>
      <div
        ref={backdropRef}
        className="fixed inset-0 z-[59] bg-black/40 dark:bg-black/60 animate-fade-in"
        onClick={close}
        aria-hidden="true"
      />
      <div className="fixed inset-0 z-[60] flex items-end justify-center pointer-events-none">
        <div
          ref={sheetRef}
          {...touchHandlers}
          className="relative w-full sm:max-w-md bg-gray-100 dark:bg-gray-900 rounded-t-3xl shadow-2xl flex flex-col overflow-hidden animate-slide-up pointer-events-auto"
          style={{ height: SHEET_HEIGHT }}
          role="dialog"
          aria-modal="true"
          aria-label={mode === "create" ? "New slot" : mode === "time" ? "Edit slot time" : "Edit slot activities"}
        >
          <div className="shrink-0 relative flex items-center justify-center px-4 py-2 min-h-[3.75rem]">
            <button
              type="button"
              onClick={close}
              aria-label="Close slot form"
              className="absolute left-2 top-2 w-11 h-11 flex items-center justify-center rounded-full bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 cursor-pointer"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <span className="text-lg font-semibold select-none">
              {mode === "create" ? "New Slot" : mode === "time" ? "Edit Time" : "Edit Activities"}
            </span>
            <button
              type="button"
              onClick={handleSave}
              disabled={(showSchedule && selectedDays.length === 0) || saving || deleting}
              aria-label="Confirm slot"
              className="absolute right-2 top-2 w-11 h-11 flex items-center justify-center rounded-full bg-blue-500 text-white cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? (
                <svg className="animate-spin h-6 w-6 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              ) : (
                <svg className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          </div>
          <div
            ref={sheetScrollerNodeRef}
            className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-none px-3 pb-6 space-y-[14.4px]"
          >
            {showSchedule && (<>
            <div>
              <div className="relative flex items-center justify-center mb-1 px-1 h-8">
                {calendarExpanded && (
                  <button
                    type="button"
                    onClick={() => setCalendarMonth((prev) => shiftMonth(prev, -1))}
                    aria-label="Previous month"
                    className="absolute left-1 p-1 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700"
                  >
                    <svg className="w-5 h-5 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                )}
                {/* Month label stays centered; the +/− toggle anchors to its
                    right edge so it doesn't shift across expand/collapse. */}
                <div className="relative">
                  <span className="text-[17.5px] font-medium text-gray-500 dark:text-gray-400 tabular-nums">
                    {formatMonthYearLabel(calendarMonth)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setCalendarExpanded((e) => !e)}
                    aria-label={calendarExpanded ? "Show fewer weeks" : "Show full month"}
                    aria-expanded={calendarExpanded}
                    className="group absolute left-full top-1/2 -translate-y-1/2 ml-2 w-6 h-6 flex items-center justify-center"
                  >
                    <span className="w-[19.2px] h-[19.2px] flex items-center justify-center rounded-full border border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 group-hover:bg-gray-200 dark:group-hover:bg-gray-700">
                      <svg className="w-[12.8px] h-[12.8px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        {calendarExpanded ? (
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                        ) : (
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        )}
                      </svg>
                    </span>
                  </button>
                </div>
                {calendarExpanded && (
                  <button
                    type="button"
                    onClick={() => setCalendarMonth((prev) => shiftMonth(prev, 1))}
                    aria-label="Next month"
                    className="absolute right-1 p-1 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700"
                  >
                    <svg className="w-5 h-5 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                )}
              </div>
              <section className="rounded-3xl bg-white dark:bg-gray-800 px-4 py-3">
                <DaysSelector
                  selectedDays={selectedDays}
                  onChange={handleDaysSelected}
                  inline
                  currentMonth={calendarMonth}
                  compact={!calendarExpanded}
                />
              </section>
            </div>
            {dayTimeWindows.length > 0 && (
              <div>
                <label className="block text-[17.5px] font-medium text-gray-500 dark:text-gray-400 mb-1 px-1">
                  Time Slot
                </label>
                <section className="rounded-3xl bg-white dark:bg-gray-800 pl-4 pr-3">
                  <DayTimeWindowsList
                    dayTimeWindows={dayTimeWindows}
                    onChange={setDayTimeWindows}
                    hideAdd
                  />
                </section>
              </div>
            )}
            </>)}
            {showActivities && (<>
            {/* Who the caller is willing to do the slot's activities with. */}
            <WhoWithCard />
            <div>
              {/* Header + "+" (aligned right) to insert a new activity row. */}
              <div className="flex items-center justify-between mb-1 px-1">
                <label className="block text-[17.5px] font-medium text-gray-500 dark:text-gray-400">
                  Activities
                </label>
                <button
                  type="button"
                  onClick={addActivity}
                  aria-label="Add an activity"
                  className="w-7 h-7 shrink-0 flex items-center justify-center rounded-full bg-blue-500 text-white hover:bg-blue-600 active:scale-95 transition"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                </button>
              </div>
              {(customActivities.length > 0 || hasSuggestions) && (
                <section className="rounded-3xl bg-white dark:bg-gray-800 px-4 py-2 divide-y divide-gray-200 dark:divide-gray-700">
                  {/* User-typed activity rows (always saved). Tapping a row opens
                      the editor (name / emoji / participant range); the faded
                      range previews next to the name. */}
                  {customActivities.length > 0 && (
                    <ul className="py-1">
                      {customActivities.map((row, i) => {
                        const range = formatPeopleRange(row.minPeople, row.maxPeople);
                        return (
                          <li key={i} className="flex items-center gap-3 h-11">
                            <button
                              type="button"
                              onClick={() => openActivityEdit(i)}
                              aria-label={`Edit ${row.name || "activity"}`}
                              className="flex-1 min-w-0 flex items-center gap-3 text-left active:opacity-70"
                            >
                              <span
                                className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-gray-200 dark:bg-gray-700 text-lg leading-none ${
                                  row.emoji.trim() ? "" : "opacity-40"
                                }`}
                              >
                                {row.emoji.trim() || EMOJI_PLACEHOLDER}
                              </span>
                              <span className="flex-1 min-w-0 flex items-baseline gap-2">
                                <span className={`truncate text-base ${row.name ? "" : "text-gray-400 dark:text-gray-500"}`}>
                                  {row.name || "Activity"}
                                </span>
                                {range && (
                                  <span className="shrink-0 text-sm text-gray-400 dark:text-gray-500 tabular-nums">
                                    {range}
                                  </span>
                                )}
                              </span>
                              <svg className="shrink-0 w-4 h-4 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              onClick={() => removeCustom(i)}
                              aria-label="Remove activity"
                              className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {/* Suggested activities, grouped + labeled by priority. Each
                      row: round checkbox (select → saved) + text. Only the
                      "you've picked before" group carries an ✕ to delete
                      (behind a confirmation → blacklist); the others (things
                      other people are doing) can't be deleted. */}
                  {SUGGESTION_GROUPS.map((group) => {
                    const items = filteredSuggestions[group.key];
                    if (items.length === 0) return null;
                    const canDelete = group.key === "yours";
                    return (
                      <div key={group.key} className="py-2">
                        <p className="text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1">
                          {group.label}
                        </p>
                        <ul>
                          {items.map((activity) => {
                            const checked = selected.has(activity.name);
                            return (
                              <li key={activity.name} className="flex items-center gap-3 h-11">
                                <button
                                  type="button"
                                  role="checkbox"
                                  aria-checked={checked}
                                  onClick={() => toggleSelected(activity.name)}
                                  className={`flex-shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                                    checked
                                      ? "bg-blue-500 border-blue-500 dark:bg-blue-500 dark:border-blue-500"
                                      : "border-gray-400 dark:border-gray-500 bg-white dark:bg-gray-900"
                                  }`}
                                >
                                  {checked && (
                                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                    </svg>
                                  )}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => toggleSelected(activity.name)}
                                  className="flex-1 min-w-0 truncate text-left text-base"
                                >
                                  {activity.emoji ? `${activity.emoji} ` : ""}
                                  {activity.name}
                                </button>
                                {canDelete && (
                                  <button
                                    type="button"
                                    onClick={() => setPendingBlacklist(activity.name)}
                                    aria-label={`Delete "${activity.name}"`}
                                    className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                                  >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden="true">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                  </button>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    );
                  })}
                </section>
              )}
            </div>
            </>)}
            {isEditing && mode === "time" && (
              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={saving || deleting}
                  className="w-full h-11 rounded-2xl bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 font-medium hover:bg-red-100 dark:hover:bg-red-900/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {deleting ? "Deleting…" : "Delete slot"}
                </button>
              </div>
            )}
          </div>

          {/* Activity editor sub-panel — slides in over the sheet (same pattern
              as the create-poll question editor). Edits apply LIVE, so there's
              no accept button: the ← and rightward-swipe just slide it back.
              Accept/cancel of the whole slot happens at the sheet's top-level
              ✓/✕. */}
          {activityEditIndex !== null && (
            <div
              ref={subPanelRef}
              className="absolute inset-0 z-20 bg-gray-100 dark:bg-gray-900 rounded-t-3xl shadow-2xl flex flex-col touch-pan-y"
              style={{
                transform: subSlideIn ? "translateX(0)" : "translateX(100%)",
                transition: SUB_SLIDE_TRANSITION,
              }}
              role="dialog"
              aria-modal="true"
              aria-label="Edit activity"
              onTouchStart={handleSubPanelTouchStart}
              onTouchMove={handleSubPanelTouchMove}
              onTouchEnd={handleSubPanelTouchEnd}
              onTouchCancel={handleSubPanelTouchEnd}
            >
              <div className="shrink-0 relative flex items-center justify-center px-4 py-2 min-h-[3.75rem]">
                <button
                  type="button"
                  onClick={closeActivityEdit}
                  aria-label="Back"
                  className="absolute left-2 top-2 w-11 h-11 flex items-center justify-center rounded-full bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 cursor-pointer"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <span className="text-lg font-semibold select-none">Edit Activity</span>
                {/* No accept button — edits apply live; the ← (and swipe-back)
                    just return to the sheet, where the top-level ✓/✕ saves or
                    cancels the whole slot. */}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 pb-6 space-y-[14.4px]">
                {editingActivity && (
                  <>
                    {/* Emoji + name */}
                    <section className="rounded-3xl bg-white dark:bg-gray-800 px-4 py-3 flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setEmojiEditIndex(activityEditIndex)}
                        aria-label="Choose an emoji"
                        className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center bg-gray-200 dark:bg-gray-700 text-xl leading-none active:scale-95"
                      >
                        <span className={editingActivity.emoji.trim() ? "" : "opacity-40"}>
                          {editingActivity.emoji.trim() || EMOJI_PLACEHOLDER}
                        </span>
                      </button>
                      <input
                        ref={setNameInputRef}
                        value={editingActivity.name}
                        onChange={(e) => updateCustom(activityEditIndex, e.target.value)}
                        onBlur={(e) => updateCustom(activityEditIndex, e.target.value.trim())}
                        placeholder="Activity"
                        aria-label="Activity name"
                        className="flex-1 min-w-0 bg-transparent text-base outline-none placeholder:text-gray-400 dark:placeholder:text-gray-500"
                      />
                    </section>
                    {/* Participants */}
                    <div>
                      <label className="block text-[17.5px] font-medium text-gray-500 dark:text-gray-400 mb-1 px-1">
                        Participants
                      </label>
                      <section className="rounded-3xl bg-white dark:bg-gray-800 px-4 py-4">
                        <MinMaxCounter
                          minValue={editingActivity.minPeople}
                          maxValue={editingActivity.maxPeople}
                          maxEnabled={editingActivity.maxPeople !== null}
                          minCheckboxEnabled={editingActivity.minPeople !== null}
                          // Checkbox only fires ON when the bound was off, and
                          // off ⇔ null — so the "current value" operands are
                          // dead; default min→1, max→min (else 1).
                          onMinCheckboxChange={(on) => setMinPeople(activityEditIndex, on ? 1 : null)}
                          onMinChange={(v) => setMinPeople(activityEditIndex, v)}
                          onMaxChange={(v) => setMaxPeople(activityEditIndex, v)}
                          onMaxEnabledChange={(on) =>
                            setMaxPeople(activityEditIndex, on ? editingActivity.minPeople ?? 1 : null)
                          }
                          minLimit={1}
                          maxLimit={MAX_PEOPLE}
                          increment={1}
                        />
                      </section>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Per-activity emoji picker for typed rows (reuses the poll picker).
          Renders its own z-[80] portal above the sheet; relevance-sorted by
          the row's typed name. */}
      <EmojiPickerModal
        open={emojiEditIndex !== null}
        value={editingCustom?.emoji ?? ""}
        onChange={(emoji) => {
          if (emojiEditIndex !== null) setCustomEmoji(emojiEditIndex, emoji);
        }}
        onClose={() => setEmojiEditIndex(null)}
        categoryWord={editingCustom?.name ?? ""}
        placeholder={EMOJI_PLACEHOLDER}
      />

      {/* Confirm before deleting one of your own past activities (blacklist).
          Renders its own z-[70] portal above the sheet. */}
      <ConfirmationModal
        isOpen={pendingBlacklist !== null}
        message={
          pendingBlacklist
            ? `Delete "${pendingBlacklist}" from your activities? It won't be suggested to you again.`
            : ""
        }
        confirmText="Delete"
        confirmButtonClass="bg-red-600 hover:bg-red-700 text-white"
        onConfirm={() => {
          if (pendingBlacklist) blacklistActivity(pendingBlacklist);
          setPendingBlacklist(null);
        }}
        onCancel={() => setPendingBlacklist(null)}
      />
    </ModalPortal>
  );
}
