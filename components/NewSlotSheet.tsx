"use client";

/**
 * Slot sheet for the home Playlist tab — THREE MODES, one facet each:
 *
 *   - 'create' ("+ Slot" FAB): just the calendar + a SINGLE time slot for a
 *     SINGLE day (picking another day moves the selection; the one window has
 *     no "+" to add more). Saves a slot with NO activities — the timeline then
 *     shows an empty activity cluster with just its "+" circle.
 *   - 'time' (tap a slot's time text): the same calendar + single-slot UI,
 *     prefilled, editing JUST the date/time. "Delete slot" lives here.
 *   - 'activity' (tap an activity circle, or the cluster's "+"): JUST ONE
 *     activity — its name, emoji and who-with options. Opened with the
 *     activity's index to edit it (plus a red "Delete activity"), or without
 *     one to ADD a new activity, in which case a CHECKLIST of suggested
 *     activities (others planning this period / your past picks / others' past
 *     picks) sits below the form as a name+emoji picker. Activities already on
 *     the slot are hidden from it; only the "you've picked before" group
 *     carries an ✕, which blacklists that activity (behind a confirmation).
 *
 * Chrome mirrors the create-poll sheet (stationary dim backdrop at z-[59],
 * bottom-anchored opaque sheet at z-[60], fixed full height with the same
 * small top gap, ✕ / title / ✓ header) so the sheets read as one family.
 *
 * The ✓ saves the touched facet only — apiCreateSlot in create mode,
 * apiUpdateSlot (keeping the OTHER facets as-is) in the edit modes — fires
 * SLOTS_CHANGED (so the Playlist tab re-fetches), then closes.
 *
 * Mounted once at layout level (CreateGroupButtonHost) and opened via the
 * slot-sheet event channel (openSlotSheet(slot?, mode?, activityIndex?)).
 * Self-manages its open + editing state.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DaysSelector from "@/components/DaysSelector";
import DayTimeWindowsList from "@/components/DayTimeWindowsList";
import EmojiPickerModal from "@/components/EmojiPickerModal";
import ConfirmationModal from "@/components/ConfirmationModal";
import CandidatePicker, { candidateKey, type Candidate } from "@/components/CandidatePicker";
import PartyCountField from "@/components/PartyCountField";
import ModalPortal from "@/components/ModalPortal";
import { useBodyScrollLock } from "@/lib/useBodyScrollLock";
import { useSheetDismissGesture } from "@/lib/useSheetDismissGesture";
import { DEFAULT_TIME_WINDOW, formatMonthYearLabel, shiftMonth } from "@/lib/timeUtils";
import { haptic } from "@/lib/haptics";
import {
  apiCreateSlot,
  apiListSlots,
  getCachedSlots,
  apiUpdateSlot,
  apiDeleteSlot,
  apiGetActivitySuggestions,
  apiListContacts,
  type ActivitySuggestion,
  type ActivitySuggestions,
  type Slot,
  type SlotActivity,
  type WhoWithEntry,
} from "@/lib/api/slots";
import { apiGetMyGroups, apiGetMyEmptyGroups } from "@/lib/api";
import { buildGroups } from "@/lib/groupUtils";
import { apiAddActivityBlacklist } from "@/lib/api/users";
import {
  SLOT_SHEET_OPEN_EVENT,
  notifySlotsChanged,
  type SlotSheetMode,
  type SlotSheetOpenDetail,
} from "@/lib/slotEvents";
import type { DayTimeWindow } from "@/lib/types";

/** The activity's who-with condition: a party-size range (total head counts
 *  including the owner — see PartyCountField) plus who it's with, and who it
 *  is explicitly NOT with. Empty `groups`/`people` = "Anyone". */
interface EditableEntry {
  minPeople: number;
  maxPeople: number;
  groups: string[];
  people: string[];
  excludeGroups: string[];
  excludePeople: string[];
}

/** "Me" and "+3" — what a fresh activity starts at. */
const DEFAULT_MIN_PEOPLE = 1;
const DEFAULT_MAX_PEOPLE = 4;

const EMPTY_ENTRY: EditableEntry = {
  minPeople: DEFAULT_MIN_PEOPLE,
  maxPeople: DEFAULT_MAX_PEOPLE,
  groups: [],
  people: [],
  excludeGroups: [],
  excludePeople: [],
};

/** The ONE activity the sheet is editing: its name, its chosen emoji ("" =
 *  none, picker faded) and its single who-with condition. The editor writes
 *  who_with exclusively — the legacy activity-level range converts into the
 *  condition's range on load. */
interface ActivityDraft {
  name: string;
  emoji: string;
  entry: EditableEntry;
}

const EMPTY_DRAFT: ActivityDraft = { name: "", emoji: "", entry: EMPTY_ENTRY };

/** Seed the who-with condition from a loaded activity: its FIRST who_with
 *  entry (the editor is single-condition now — a legacy activity with several
 *  keeps only the first), else its legacy activity-level range, else the
 *  defaults. */
function entryFromActivity(a: SlotActivity): EditableEntry {
  const w = a.who_with?.[0];
  if (w) {
    return {
      minPeople: w.min_people ?? DEFAULT_MIN_PEOPLE,
      maxPeople: w.max_people ?? DEFAULT_MAX_PEOPLE,
      groups: w.groups ?? [],
      people: w.people ?? [],
      excludeGroups: w.exclude_groups ?? [],
      excludePeople: w.exclude_people ?? [],
    };
  }
  return {
    ...EMPTY_ENTRY,
    minPeople: a.min_people ?? DEFAULT_MIN_PEOPLE,
    maxPeople: a.max_people ?? DEFAULT_MAX_PEOPLE,
  };
}

/** The condition → the wire shape (always one entry: the range is always set). */
function entryToWire(e: EditableEntry): WhoWithEntry[] {
  const list = (names: string[]) => {
    const kept = names.filter(Boolean);
    return kept.length > 0 ? kept : null;
  };
  return [
    {
      min_people: e.minPeople,
      max_people: e.maxPeople,
      groups: list(e.groups),
      people: list(e.people),
      exclude_groups: list(e.excludeGroups),
      exclude_people: list(e.excludePeople),
    },
  ];
}

const nameKey = (s: string) => s.trim().toLowerCase();

/** The "Without" field writes the same candidate kinds into the exclude_*
 *  lists, so its picks map onto the entry's other pair of name arrays. */
const excludeField = (kind: Candidate["kind"]) =>
  kind === "groups" ? ("excludeGroups" as const) : ("excludePeople" as const);

/** An entry's name arrays → pills (groups first, then people). Names seeded
 *  but no longer in the source lists still show, and stay removable. */
function toCandidates(groups: string[], people: string[]): Candidate[] {
  return [
    ...groups.map((name) => ({ kind: "groups" as const, name })),
    ...people.map((name) => ({ kind: "people" as const, name })),
  ];
}

/** "Last time the caller referenced this candidate in a who-with" → ms, keyed
 *  by candidateKey. Derived from the caller's OWN saved slots (so it follows
 *  the account across devices without a new endpoint); a candidate they've
 *  never picked is simply absent. Slot created_at is the timestamp — the
 *  closest thing we store to "when this pick was made". */
function whoWithRecencyFromSlots(slots: Slot[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const slot of slots) {
    const ts = slot.created_at ? Date.parse(slot.created_at) : NaN;
    if (Number.isNaN(ts)) continue;
    for (const activity of slot.activities ?? []) {
      for (const entry of activity.who_with ?? []) {
        const bump = (kind: Candidate["kind"], names: string[] | null | undefined) => {
          for (const name of names ?? []) {
            const key = candidateKey({ kind, name });
            if ((out.get(key) ?? -Infinity) < ts) out.set(key, ts);
          }
        };
        bump("groups", entry.groups);
        bump("people", entry.people);
      }
    }
  }
  return out;
}

// Faded placeholder glyph on the emoji chip / in the picker input when no
// emoji is chosen (activities have no per-category default).
const EMOJI_PLACEHOLDER = "🙂";

const EMPTY_SUGGESTIONS: ActivitySuggestions = { overlapping: [], yours: [], others: [] };

const SUGGESTION_GROUPS: { key: keyof ActivitySuggestions; label: string }[] = [
  { key: "overlapping", label: "Others planning this time" },
  { key: "yours", label: "You've picked before" },
  { key: "others", label: "Others have picked" },
];

// Same top gap as the create-poll sheets (SHEET_TOP_GAP there).
const SHEET_HEIGHT = "calc(100dvh - env(safe-area-inset-top, 0px) - 1.25rem)";

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
 * (openSlotSheet()) — the "+ Slot" FAB dispatches a new slot, a Playlist row's
 * time / activity circle / "+" dispatches the facet to edit. Self-manages its
 * open + editing state.
 */
export default function NewSlotSheet() {
  const [isOpen, setIsOpen] = useState(false);
  // Which facet the sheet edits: 'create' (new slot, schedule only), 'time'
  // (existing slot's date/time), 'activity' (ONE of its activities).
  const [mode, setMode] = useState<SlotSheetMode>("create");
  // The slot being edited (null = creating a new one).
  const [editingSlot, setEditingSlot] = useState<Slot | null>(null);
  const [dayTimeWindows, setDayTimeWindows] = useState<DayTimeWindow[]>([]);
  // 'activity' mode: which of the slot's activities is being edited (null =
  // adding a new one) and the working copy of it.
  const [activityIndex, setActivityIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<ActivityDraft>(EMPTY_DRAFT);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState<Date>(monthOfToday);
  const [calendarExpanded, setCalendarExpanded] = useState(false);
  const [suggestions, setSuggestions] = useState<ActivitySuggestions>(EMPTY_SUGGESTIONS);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Activity name awaiting delete confirmation (null = no confirm open). Only
  // "you've picked before" suggestions can be deleted (→ blacklisted).
  const [pendingBlacklist, setPendingBlacklist] = useState<string | null>(null);
  const isEditing = editingSlot !== null;
  const showSchedule = mode !== "activity";
  const showActivity = mode === "activity";
  // Adding a new activity (vs editing one the slot already has).
  const isNewActivity = activityIndex === null;

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

  // Open driven by the slot-sheet event channel. Time mode prefills the window
  // and centers the calendar on the slot's day; activity mode seeds the draft
  // from the named activity (or blank for a new one). A new slot starts blank
  // on today's month.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<SlotSheetOpenDetail>).detail;
      const slot = detail?.slot ?? null;
      const index = detail?.activityIndex ?? null;
      const existing = index !== null ? slot?.activities[index] : undefined;
      setMode(detail?.mode ?? (slot ? "time" : "create"));
      setEditingSlot(slot);
      setDayTimeWindows(slot ? slot.day_time_windows : []);
      setActivityIndex(existing ? index : null);
      setDraft(
        existing
          ? { name: existing.name, emoji: existing.emoji ?? "", entry: entryFromActivity(existing) }
          : EMPTY_DRAFT,
      );
      setEmojiOpen(false);
      setCalendarMonth(monthForSlot(slot));
      // Editing time: expand to the slot's real month ONLY when its picked
      // days fall outside the compact grid's rolling 3 weeks from today; if
      // they're already visible there, open collapsed. New: compact,
      // today-anchored.
      setCalendarExpanded(slot !== null && !slotDaysVisibleInCompact(slot));
      setSuggestions(EMPTY_SUGGESTIONS);
      setSaving(false);
      setDeleting(false);
      setPendingBlacklist(null);
      setIsOpen(true);
    };
    window.addEventListener(SLOT_SHEET_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(SLOT_SHEET_OPEN_EVENT, onOpen);
  }, []);

  // Fetch ranked activity suggestions (the name picker shown while ADDING),
  // debounced on the selected period — group 1 depends on which windows
  // overlap other users' slots. A request token guards against a stale
  // response landing after a newer one.
  const dtwKey = JSON.stringify(dayTimeWindows);
  const reqTokenRef = useRef(0);
  useEffect(() => {
    if (!isOpen || !showActivity || !isNewActivity) return;
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
  }, [isOpen, showActivity, isNewActivity, dtwKey]);

  // Who-with picker sources: the caller's group names + contact names,
  // fetched once per activity-mode open (null = loading). Names already on an
  // entry but absent from these lists still render (checked) so seeded /
  // stale selections stay toggleable.
  const [availGroups, setAvailGroups] = useState<string[] | null>(null);
  const [availPeople, setAvailPeople] = useState<string[] | null>(null);
  useEffect(() => {
    if (!isOpen || !showActivity) return;
    let cancelled = false;
    Promise.all([apiGetMyGroups().catch(() => []), apiGetMyEmptyGroups().catch(() => [])])
      .then(([polls, empty]) => {
        if (cancelled) return;
        const gs = buildGroups(polls, new Set(), new Set(), empty).filter((g) => g.groupId);
        setAvailGroups([...new Set(gs.map((g) => g.title).filter((t): t is string => !!t))]);
      })
      .catch(() => {
        if (!cancelled) setAvailGroups([]);
      });
    apiListContacts()
      .then((cs) => {
        if (cancelled) return;
        setAvailPeople([...new Set(cs.map((c) => c.name).filter((n): n is string => !!n))]);
      })
      .catch(() => {
        if (!cancelled) setAvailPeople([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, showActivity]);

  // How recently the caller last picked each candidate in a who-with. Seeded
  // synchronously from the slot list the Playlist tab already loaded, then
  // refreshed on open.
  const [whoWithRecency, setWhoWithRecency] = useState<Map<string, number>>(() =>
    whoWithRecencyFromSlots(getCachedSlots() ?? []),
  );
  useEffect(() => {
    if (!isOpen || !showActivity) return;
    let cancelled = false;
    apiListSlots()
      .then((slots) => {
        if (!cancelled) setWhoWithRecency(whoWithRecencyFromSlots(slots));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isOpen, showActivity]);

  // Every pickable candidate, ordered LEAST relevant first so the picker's
  // bottom row (nearest its box) is the most-recently-referenced one. Names
  // never picked before tie at the bottom of the ranking and fall back to
  // their source order, reversed for the same reason.
  const candidateOptions = useMemo<Candidate[]>(() => {
    const all: Candidate[] = [
      ...(availGroups ?? []).map((name) => ({ kind: "groups" as const, name })),
      ...(availPeople ?? []).map((name) => ({ kind: "people" as const, name })),
    ];
    return all
      .map((c, i) => ({ c, i, r: whoWithRecency.get(candidateKey(c)) ?? 0 }))
      .sort((a, b) => a.r - b.r || b.i - a.i)
      .map((x) => x.c);
  }, [availGroups, availPeople, whoWithRecency]);

  const withSelected = useMemo(
    () => toCandidates(draft.entry.groups, draft.entry.people),
    [draft.entry.groups, draft.entry.people],
  );
  const withoutSelected = useMemo(
    () => toCandidates(draft.entry.excludeGroups, draft.entry.excludePeople),
    [draft.entry.excludeGroups, draft.entry.excludePeople],
  );

  // ---- Draft helpers --------------------------------------------------------

  const setName = useCallback((name: string) => {
    setDraft((prev) => ({ ...prev, name }));
  }, []);
  const setEmoji = useCallback((emoji: string) => {
    setDraft((prev) => ({ ...prev, emoji }));
  }, []);
  // Tapping a suggestion names the activity (and takes its emoji); tapping the
  // one already chosen clears the name again.
  const pickSuggestion = useCallback((s: ActivitySuggestion) => {
    setDraft((prev) =>
      nameKey(prev.name) === nameKey(s.name)
        ? { ...prev, name: "" }
        : { ...prev, name: s.name, emoji: s.emoji ?? prev.emoji },
    );
  }, []);

  const patchEntry = useCallback((patch: Partial<EditableEntry>) => {
    setDraft((prev) => ({ ...prev, entry: { ...prev.entry, ...patch } }));
  }, []);
  // The two bounds stay ordered: raising the minimum pushes the maximum up,
  // lowering the maximum pulls the minimum down.
  const setMinPeople = useCallback((n: number) => {
    setDraft((prev) => ({
      ...prev,
      entry: { ...prev.entry, minPeople: n, maxPeople: Math.max(prev.entry.maxPeople, n) },
    }));
  }, []);
  const setMaxPeople = useCallback((n: number) => {
    setDraft((prev) => ({
      ...prev,
      entry: { ...prev.entry, maxPeople: n, minPeople: Math.min(prev.entry.minPeople, n) },
    }));
  }, []);
  const toggleEntryName = useCallback(
    (field: "groups" | "people" | "excludeGroups" | "excludePeople", name: string) => {
      setDraft((prev) => {
        const list = prev.entry[field];
        const next = list.includes(name) ? list.filter((n) => n !== name) : [...list, name];
        return { ...prev, entry: { ...prev.entry, [field]: next } };
      });
    },
    [],
  );

  // Confirmed ✕ on a "you've picked before" suggestion: drop it from every
  // group immediately and add it to the account's blacklist so it's never
  // suggested again.
  const blacklistActivity = useCallback((activity: string) => {
    haptic.medium();
    setSuggestions((prev) => {
      const drop = (list: ActivitySuggestion[]) =>
        list.filter((a) => nameKey(a.name) !== nameKey(activity));
      return {
        overlapping: drop(prev.overlapping),
        yours: drop(prev.yours),
        others: drop(prev.others),
      };
    });
    void apiAddActivityBlacklist(activity).catch(() => {});
  }, []);

  // ✓ saves the mode's facet only: create → new slot (no activities); time →
  // just the schedule (activities as-is); activity → the slot's activity list
  // with this one activity replaced or appended (schedule as-is).
  const handleSave = useCallback(() => {
    if (saving || deleting) return;
    let req: Promise<unknown>;
    if (mode === "create") {
      if (dayTimeWindows.length === 0) return;
      req = apiCreateSlot(dayTimeWindows, []);
    } else if (mode === "time") {
      if (!editingSlot || dayTimeWindows.length === 0) return;
      req = apiUpdateSlot(editingSlot.id, dayTimeWindows, editingSlot.activities);
    } else {
      if (!editingSlot) return;
      const name = draft.name.trim();
      if (!name) return;
      const key = nameKey(name);
      // The legacy activity-level range is always written null — who_with is
      // the source of truth now (an edit converts a legacy range into an
      // entry via entriesFromActivity).
      const wire: SlotActivity = {
        name,
        emoji: draft.emoji.trim() || null,
        min_people: null,
        max_people: null,
        who_with: entryToWire(draft.entry),
      };
      let base: SlotActivity[];
      if (activityIndex !== null) {
        base = editingSlot.activities.map((a, i) => (i === activityIndex ? wire : a));
      } else {
        // Adding: if the name collides with an existing activity, edit that
        // one in place rather than creating a duplicate the server would
        // silently dedupe away.
        const collision = editingSlot.activities.findIndex((a) => nameKey(a.name) === key);
        base =
          collision >= 0
            ? editingSlot.activities.map((a, i) => (i === collision ? wire : a))
            : [...editingSlot.activities, wire];
      }
      // A rename can still collide with a DIFFERENT activity; the draft wins.
      const activities = base.filter((a) => a === wire || nameKey(a.name) !== key);
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
  }, [saving, deleting, mode, dayTimeWindows, draft, activityIndex, editingSlot, close]);

  // Delete the slot being edited (time mode).
  const handleDeleteSlot = useCallback(() => {
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

  // Remove just this activity from the slot (activity mode, existing only).
  const handleDeleteActivity = useCallback(() => {
    if (!editingSlot || activityIndex === null || saving || deleting) return;
    setDeleting(true);
    haptic.medium();
    apiUpdateSlot(
      editingSlot.id,
      editingSlot.day_time_windows,
      editingSlot.activities.filter((_, i) => i !== activityIndex),
    )
      .then(() => {
        notifySlotsChanged();
        close();
      })
      .catch(() => setDeleting(false));
  }, [editingSlot, activityIndex, saving, deleting, close]);

  // Activities already on the slot shouldn't appear as suggestions — except
  // the one being renamed into, which is the draft's own current pick.
  const filteredSuggestions = useMemo<ActivitySuggestions>(() => {
    const taken = new Set((editingSlot?.activities ?? []).map((a) => nameKey(a.name)));
    const drop = (list: ActivitySuggestion[]) => list.filter((a) => !taken.has(nameKey(a.name)));
    return {
      overlapping: drop(suggestions.overlapping),
      yours: drop(suggestions.yours),
      others: drop(suggestions.others),
    };
  }, [suggestions, editingSlot]);

  const hasSuggestions = useMemo(
    () => SUGGESTION_GROUPS.some((g) => filteredSuggestions[g.key].length > 0),
    [filteredSuggestions],
  );

  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // A stacked modal (emoji picker or delete confirm) consumes Escape.
      if (emojiOpen || pendingBlacklist !== null) return;
      close();
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [isOpen, close, emojiOpen, pendingBlacklist]);

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
  // create-poll sheet.
  const sheetScrollerNodeRef = useRef<HTMLDivElement | null>(null);
  const { sheetRef, backdropRef, touchHandlers } = useSheetDismissGesture({
    scrollerRef: sheetScrollerNodeRef,
    onDismiss: close,
  });

  if (!isOpen) return null;

  const title =
    mode === "create"
      ? "New Slot"
      : mode === "time"
        ? "Edit Time"
        : isNewActivity
          ? "Add Activity"
          : "Edit Activity";
  const saveDisabled =
    saving ||
    deleting ||
    (showSchedule && selectedDays.length === 0) ||
    (showActivity && !draft.name.trim());

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
          aria-label={title}
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
            <span className="text-lg font-semibold select-none">{title}</span>
            <button
              type="button"
              onClick={handleSave}
              disabled={saveDisabled}
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

            {showActivity && (<>
            {/* Emoji + name — the activity itself. */}
            <section className="rounded-3xl bg-white dark:bg-gray-800 px-4 py-3 flex items-center gap-3">
              <button
                type="button"
                onClick={() => setEmojiOpen(true)}
                aria-label="Choose an emoji"
                className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center bg-gray-200 dark:bg-gray-700 text-xl leading-none active:scale-95"
              >
                <span className={draft.emoji.trim() ? "" : "opacity-40"}>
                  {draft.emoji.trim() || EMOJI_PLACEHOLDER}
                </span>
              </button>
              <input
                value={draft.name}
                onChange={(e) => setName(e.target.value)}
                onBlur={(e) => setName(e.target.value.trim())}
                placeholder="Activity"
                aria-label="Activity name"
                className="flex-1 min-w-0 bg-transparent text-base outline-none placeholder:text-gray-400 dark:placeholder:text-gray-500"
              />
            </section>

            {/* The activity's who-with condition — ONE always-present card in
                the settings-card format (label/value rows over hairlines):
                who it's with, the party-size range, and who it's explicitly
                NOT with. "With"/"Without" expand in place into a search box +
                suggestions, and keep their picks as pills under the row. */}
            <section className="rounded-3xl bg-white dark:bg-gray-800 px-4 divide-y divide-gray-200 dark:divide-gray-700">
              <CandidatePicker
                label="With"
                emptyValue="Anyone"
                selected={withSelected}
                options={candidateOptions}
                onAdd={(c) => toggleEntryName(c.kind, c.name)}
                onRemove={(c) => toggleEntryName(c.kind, c.name)}
              />
              <PartyCountField label="At Least" value={draft.entry.minPeople} setValue={setMinPeople} />
              <PartyCountField
                label="No More Than"
                value={draft.entry.maxPeople}
                setValue={setMaxPeople}
                min={draft.entry.minPeople}
              />
              <CandidatePicker
                label="Without"
                emptyValue="No one"
                selected={withoutSelected}
                options={candidateOptions}
                onAdd={(c) => toggleEntryName(excludeField(c.kind), c.name)}
                onRemove={(c) => toggleEntryName(excludeField(c.kind), c.name)}
              />
            </section>

            {/* Name picker while ADDING: suggested activities grouped +
                labeled by priority. Tapping one names the draft (and takes
                its emoji); tapping the chosen one clears it. Only the "you've
                picked before" group carries an ✕ to delete (behind a
                confirmation → blacklist); the others (things other people are
                doing) can't be deleted. */}
            {isNewActivity && hasSuggestions && (
              <div>
                <label className="block text-[17.5px] font-medium text-gray-500 dark:text-gray-400 mb-1 px-1">
                  Suggestions
                </label>
                <section className="rounded-3xl bg-white dark:bg-gray-800 px-4 py-2 divide-y divide-gray-200 dark:divide-gray-700">
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
                            const checked = nameKey(draft.name) === nameKey(activity.name);
                            return (
                              <li key={activity.name} className="flex items-center gap-3 h-11">
                                <button
                                  type="button"
                                  role="checkbox"
                                  aria-checked={checked}
                                  onClick={() => pickSuggestion(activity)}
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
                                  onClick={() => pickSuggestion(activity)}
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
              </div>
            )}
            </>)}

            {isEditing && (mode === "time" || (showActivity && !isNewActivity)) && (
              <div className="pt-2">
                <button
                  type="button"
                  onClick={mode === "time" ? handleDeleteSlot : handleDeleteActivity}
                  disabled={saving || deleting}
                  aria-label={mode === "time" ? "Delete slot" : "Delete activity"}
                  className="w-full h-11 rounded-2xl bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 font-medium flex items-center justify-center gap-2 hover:bg-red-100 dark:hover:bg-red-900/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  {deleting
                    ? "Deleting…"
                    : mode === "time"
                      ? "Delete slot"
                      : "Delete activity"}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Emoji picker for the activity (reuses the poll picker). Renders its
          own z-[80] portal above the sheet; relevance-sorted by the typed
          name. */}
      <EmojiPickerModal
        open={emojiOpen}
        value={draft.emoji}
        onChange={setEmoji}
        onClose={() => setEmojiOpen(false)}
        categoryWord={draft.name}
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
