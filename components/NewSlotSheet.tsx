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
 *     activity. ADDING (no index) is only "which activity?" — the name +
 *     emoji field, injected at the TOP OF THE PAGE over the still-visible
 *     timeline rather than in the sheet (no dim; an outside tap closes it);
 *     you tap the activity afterward to say who it's with. EDITING (with an
 *     index) is the full sheet: that same field plus the who-with card and a
 *     red "Delete activity". The who-with card's With/Without pickers draw on
 *     `apiGetWhoWithCandidates` — the caller's groups + address book, ordered
 *     by how recently they last picked each — and store real ids, not names.
 *     In the ADD panel, picking a suggestion COMMITS it (adds the activity to
 *     the slot and dismisses the panel); in EDIT mode it just renames the
 *     draft + takes its emoji. The add panel has NO ✓ — a typed name commits
 *     on keyboard close (the iOS Done). In BOTH, focusing the name field drops down its
 *     suggestions (others planning this period / your past picks / others'
 *     past picks), grouped + narrowed by what's typed. Activities already on
 *     the slot are hidden from it (except the one being edited); only the
 *     "you've picked before" group carries an ✕, which blacklists that
 *     activity (behind a confirmation).
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
import TimeSlotBubbles, { type SlotState } from "@/components/TimeSlotBubbles";
import DayTimeWindowsList from "@/components/DayTimeWindowsList";
import EmojiPickerModal from "@/components/EmojiPickerModal";
import ConfirmationModal from "@/components/ConfirmationModal";
import CandidatePicker, { candidateKey, type Candidate } from "@/components/CandidatePicker";
import PartyCountField from "@/components/PartyCountField";
import HoursField, { HOURS_OPTIONS } from "@/components/HoursField";
import ModalPortal from "@/components/ModalPortal";
import { useBodyScrollLock } from "@/lib/useBodyScrollLock";
import { cancelPrimedFocus, consumePrimedFocus } from "@/lib/useKeyboardPrimer";
import { useSheetDismissGesture } from "@/lib/useSheetDismissGesture";
import { DEFAULT_TIME_WINDOW, formatMonthYearLabel, shiftMonth } from "@/lib/timeUtils";
import { haptic } from "@/lib/haptics";
import {
  apiCreateSlot,
  apiUpdateSlot,
  apiDeleteSlot,
  apiGetActivitySuggestions,
  apiGetSlotEvents,
  apiGetWhoWithCandidates,
  getCachedSlotEvents,
  type WhoWithCandidate,
  type ActivitySuggestion,
  type ActivitySuggestions,
  type Slot,
  type SlotActivity,
  type SlotEvent,
  type WhoWithEntry,
  type WhoWithRef,
} from "@/lib/api/slots";
import { apiAddActivityBlacklist } from "@/lib/api/users";
import {
  SLOT_SHEET_OPEN_EVENT,
  notifySlotsChanged,
  setAddPanelActive,
  scrollAddPanelToTop,
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
  groups: WhoWithRef[];
  people: WhoWithRef[];
  excludeGroups: WhoWithRef[];
  excludePeople: WhoWithRef[];
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
 *  none, picker faded), its single who-with condition, its start-time
 *  preferences (HH:MM marks — see TimePrefs), and its duration bounds in
 *  hours. The editor writes who_with exclusively — the legacy activity-level
 *  range converts into the condition's range on load. */
interface ActivityDraft {
  name: string;
  emoji: string;
  entry: EditableEntry;
  liked: string[];
  disliked: string[];
  minHours: number;
  maxHours: number;
}

/** The weakest bounds on offer — what a fresh activity (or a legacy one with
 *  none stored) reads as, so the default is as close to unconstrained as the
 *  picker allows. */
const DEFAULT_MIN_HOURS = HOURS_OPTIONS[0];
const DEFAULT_MAX_HOURS = HOURS_OPTIONS[HOURS_OPTIONS.length - 1];

const EMPTY_DRAFT: ActivityDraft = {
  name: "",
  emoji: "",
  entry: EMPTY_ENTRY,
  liked: [],
  disliked: [],
  minHours: DEFAULT_MIN_HOURS,
  maxHours: DEFAULT_MAX_HOURS,
};

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
  const list = (refs: WhoWithRef[]) => {
    const kept = refs.filter((r) => r.name.trim());
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

// ---- Preferred start times (the time-poll bubble ballot, over the slot's
// own availability window at 30-minute starts). Preferences are stored as
// day-agnostic HH:MM start marks; the bubble grid works in full
// "YYYY-MM-DD HH:MM-HH:MM" slot keys, so these two map between them.

const PREF_STEP_MIN = 30;

const minsOfHHMM = (v: string | undefined): number | null => {
  if (!v || !v.includes(":")) return null;
  const [h, m] = v.split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};
const fmtMins = (m: number) => {
  const mm = ((m % 1440) + 1440) % 1440;
  return `${String(Math.floor(mm / 60)).padStart(2, "0")}:${String(mm % 60).padStart(2, "0")}`;
};
/** A bubble key's start time-of-day ("2026-08-30 18:00-18:30" → "18:00"). */
const startOfKey = (key: string) => key.split(" ")[1]?.split("-")[0] ?? "";

/** Candidate start-time bubbles across the slot's windows, as slot keys the
 *  bubble grid understands. Cross-midnight windows (max <= min, the app-wide
 *  convention) clip at midnight — starts stay within the slot's own day.
 *  `minHours` (the activity's minimum duration) trims starts the activity
 *  couldn't FIT from: a 2h-minimum activity in an 11–5 window can't start
 *  after 3, so 3:30+ aren't offered. */
function prefOptionsForSlot(slot: Slot | null, minHours: number): string[] {
  if (!slot) return [];
  const minMins = Math.max(0, Math.round(minHours * 60));
  const out: string[] = [];
  for (const dtw of slot.day_time_windows ?? []) {
    if (!dtw.day) continue;
    for (const w of dtw.windows ?? []) {
      const mn = minsOfHHMM(w.min);
      const mxRaw = minsOfHHMM(w.max);
      if (mn == null || mxRaw == null) continue;
      const mx = mxRaw > mn ? mxRaw : 1440;
      const latest = mx - minMins;
      for (let s = mn; s < mx && s <= latest; s += PREF_STEP_MIN) {
        out.push(`${dtw.day} ${fmtMins(s)}-${fmtMins(s + PREF_STEP_MIN)}`);
      }
    }
  }
  // Zero-padded keys sort chronologically as strings.
  return [...new Set(out)].sort();
}

/** The "Without" field writes the same candidate kinds into the exclude_*
 *  lists, so its picks map onto the entry's other pair of name arrays. */
const excludeField = (kind: Candidate["kind"]) =>
  kind === "groups" ? ("excludeGroups" as const) : ("excludePeople" as const);

/** An entry's ref arrays → pills (groups first, then people). Refs seeded but
 *  no longer in the candidate list still show, and stay removable. */
function toCandidates(groups: WhoWithRef[], people: WhoWithRef[]): Candidate[] {
  return [
    ...groups.map((r) => ({ kind: "groups" as const, id: r.id, name: r.name })),
    ...people.map((r) => ({ kind: "people" as const, id: r.id, name: r.name })),
  ];
}

// Faded placeholder glyph on the emoji chip / in the picker input when no
// emoji is chosen (activities have no per-category default).
const EMOJI_PLACEHOLDER = "🙂";

const EMPTY_SUGGESTIONS: ActivitySuggestions = { overlapping: [], yours: [], others: [] };

const SUGGESTION_GROUPS: { key: keyof ActivitySuggestions; label: string }[] = [
  { key: "overlapping", label: "Others Have Picked for this Time" },
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
  // The activity-name field's suggestion dropdown. Opens with the add panel
  // (it's the point of that panel) and on a tap in the field; collapses once a
  // suggestion is picked, or on blur.
  const [suggestOpen, setSuggestOpen] = useState(false);
  // Viewport y the ADD panel hangs from: the bottom of the "+" that opened it,
  // already scrolled to the top of the screen (see scrollAnchorToTop). Null =
  // pin to the top of the viewport.
  const [anchorBottom, setAnchorBottom] = useState<number | null>(null);
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

  // Adding an activity is a light top-of-page panel, NOT a sheet: it doesn't
  // dim or lock the page, and it can't lock scroll — the tap that opens it
  // starts a smooth scroll that a `position: fixed` body lock would freeze
  // mid-animation.
  const isAddActivity = isOpen && mode === "activity" && activityIndex === null;
  useBodyScrollLock(isOpen && !isAddActivity);

  // Tell the timeline to hide its column headers while the panel is up.
  useEffect(() => {
    setAddPanelActive(isAddActivity);
    return () => setAddPanelActive(false);
  }, [isAddActivity]);

  // Then slide the page up until the panel (pinned in the document under the
  // tapped "+") is at the top of the screen. Two rAFs: the timeline's
  // header-collapse + extra bottom padding — what makes the target reachable —
  // land on the render triggered by the effect above.
  useEffect(() => {
    if (!isAddActivity || anchorBottom == null) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => scrollAddPanelToTop(anchorBottom));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [isAddActivity, anchorBottom]);

  // Set just before an explicit cancel so the blur it causes doesn't read as
  // the keyboard's Done (see the name field's onBlur).
  const cancelledRef = useRef(false);

  const close = useCallback(() => {
    cancelPrimedFocus();
    setIsOpen(false);
  }, []);

  // Open driven by the slot-sheet event channel. Time mode prefills the window
  // and centers the calendar on the slot's day; activity mode seeds the draft
  // from the named activity (or blank for a new one). A new slot starts blank
  // on today's month.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<SlotSheetOpenDetail>).detail;
      const slot = detail?.slot ?? null;
      const index = detail?.activityIndex ?? null;
      setAnchorBottom(detail?.anchorBottom ?? null);
      const existing = index !== null ? slot?.activities[index] : undefined;
      setMode(detail?.mode ?? (slot ? "time" : "create"));
      setEditingSlot(slot);
      setDayTimeWindows(slot ? slot.day_time_windows : []);
      setActivityIndex(existing ? index : null);
      setDraft(
        existing
          ? {
              name: existing.name,
              emoji: existing.emoji ?? "",
              entry: entryFromActivity(existing),
              liked: existing.time_prefs?.liked ?? [],
              disliked: existing.time_prefs?.disliked ?? [],
              minHours: existing.min_hours ?? DEFAULT_MIN_HOURS,
              maxHours: existing.max_hours ?? DEFAULT_MAX_HOURS,
            }
          : EMPTY_DRAFT,
      );
      setEmojiOpen(false);
      setSuggestOpen(detail?.mode === "activity" && (detail?.activityIndex ?? null) === null);
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

  // Fetch ranked activity suggestions (the name field's dropdown, in BOTH
  // add + edit modes), debounced on the selected period — group 1 depends on
  // which windows overlap other users' slots. A request token guards against
  // a stale response landing after a newer one.
  const dtwKey = JSON.stringify(dayTimeWindows);
  const reqTokenRef = useRef(0);
  useEffect(() => {
    if (!isOpen || !showActivity) return;
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
  }, [isOpen, showActivity, dtwKey]);

  // Who-with picker source: one server call giving every group the caller is
  // in plus their address book, already ordered by how recently they last
  // referenced each — the SAME population the server validates a save against,
  // so nothing offered here can be dropped on the way in. Fetched per
  // activity-mode open; null = loading.
  const [candidates, setCandidates] = useState<WhoWithCandidate[]>([]);
  useEffect(() => {
    if (!isOpen || !showActivity) return;
    let cancelled = false;
    apiGetWhoWithCandidates()
      .then((c) => {
        if (!cancelled) setCandidates(c);
      })
      .catch(() => {
        if (!cancelled) setCandidates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, showActivity]);

  // NEAR-MISS: how many more people this activity still needs before it can
  // actually happen. The engine derives it per (day, activity) alongside the
  // real events; it isn't a timeline card (there's nothing to act on yet), so
  // it surfaces here as a bubble under the activity's name. Seeded from the
  // events cache the timeline keeps warm, then refreshed on open.
  const [slotEvents, setSlotEvents] = useState<SlotEvent[]>(() => getCachedSlotEvents() ?? []);
  useEffect(() => {
    if (!isOpen || !showActivity) return;
    let cancelled = false;
    apiGetSlotEvents()
      .then((e) => {
        if (!cancelled) setSlotEvents(e);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isOpen, showActivity]);

  // Matched on the SAVED name (the draft's changes as you type) + any day the
  // slot covers. Only meaningful for an activity that already exists.
  const savedActivityName =
    activityIndex !== null ? editingSlot?.activities[activityIndex]?.name ?? null : null;
  const neededMore = useMemo(() => {
    if (!savedActivityName || !editingSlot) return 0;
    const key = nameKey(savedActivityName);
    const days = new Set(editingSlot.day_time_windows.map((d) => d.day));
    const ev = slotEvents.find((e) => nameKey(e.activity) === key && days.has(e.day));
    return ev?.needed ?? 0;
  }, [slotEvents, savedActivityName, editingSlot]);

  // CandidatePicker takes its options LEAST relevant first, so the server's
  // most-relevant-first ranking is reversed once here.
  const candidateOptions = useMemo<Candidate[]>(
    () => [...candidates].reverse(),
    [candidates],
  );

  const withSelected = useMemo(
    () => toCandidates(draft.entry.groups, draft.entry.people),
    [draft.entry.groups, draft.entry.people],
  );
  const withoutSelected = useMemo(
    () => toCandidates(draft.entry.excludeGroups, draft.entry.excludePeople),
    [draft.entry.excludeGroups, draft.entry.excludePeople],
  );

  // While a who-with picker is expanded, the scroller grows a tall spacer so
  // scrollIntoView can bring ANY row to the top — without it the "Without"
  // row (the last field, nothing below it) can't scroll up and its search box
  // lands under the iOS keyboard. A COUNT, not a boolean: tapping one picker
  // while the other is open interleaves collapse/expand notifications.
  const [pickersOpen, setPickersOpen] = useState(0);
  const handlePickerOpenChange = useCallback((open: boolean) => {
    setPickersOpen((c) => Math.max(0, c + (open ? 1 : -1)));
  }, []);

  // ---- Draft helpers --------------------------------------------------------

  const setName = useCallback((name: string) => {
    setDraft((prev) => ({ ...prev, name }));
  }, []);
  const setEmoji = useCallback((emoji: string) => {
    setDraft((prev) => ({ ...prev, emoji }));
  }, []);
  // Commit ONE activity (append, or replace at activityIndex) onto the slot's
  // list and close. Takes the draft EXPLICITLY so a suggestion tap can save
  // its pick without waiting for the setDraft round-trip (handleSave's state
  // read would be stale there). The legacy activity-level range is always
  // written null — who_with is the source of truth now (an edit converts a
  // legacy range into an entry via entriesFromActivity).
  const saveActivityDraft = useCallback(
    (d: ActivityDraft) => {
      if (saving || deleting || !editingSlot) return;
      const name = d.name.trim();
      if (!name) return;
      const key = nameKey(name);
      const wire: SlotActivity = {
        name,
        emoji: d.emoji.trim() || null,
        min_people: null,
        max_people: null,
        who_with: entryToWire(d.entry),
        time_prefs:
          d.liked.length > 0 || d.disliked.length > 0
            ? { liked: d.liked, disliked: d.disliked }
            : null,
        min_hours: d.minHours,
        max_hours: d.maxHours,
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
      setSaving(true);
      haptic.success();
      apiUpdateSlot(editingSlot.id, editingSlot.day_time_windows, activities)
        .then(() => {
          notifySlotsChanged();
          close();
        })
        .catch(() => setSaving(false));
    },
    [saving, deleting, editingSlot, activityIndex, close],
  );
  // Tapping a suggestion: in the ADD panel the pick IS the whole act — commit
  // it onto the slot and dismiss (no keyboard-close step, no lingering text
  // box). In EDIT mode it just renames the draft (the sheet has a ✓ and other
  // fields still worth touching), collapsing the list.
  const pickSuggestion = useCallback(
    (s: ActivitySuggestion) => {
      setDraft((prev) => ({ ...prev, name: s.name, emoji: s.emoji ?? prev.emoji }));
      setSuggestOpen(false);
      if (isAddActivity) {
        saveActivityDraft({ ...draft, name: s.name, emoji: s.emoji ?? draft.emoji });
      }
    },
    [isAddActivity, draft, saveActivityDraft],
  );

  // The preferred-start-times ballot: 30-min start bubbles over the slot's
  // own window, cycling neutral → prefer (green) → avoid (red) → neutral —
  // the time-poll ballot reused. Marks store as day-agnostic HH:MM starts.
  const prefOptions = useMemo(
    () => prefOptionsForSlot(editingSlot, draft.minHours),
    [editingSlot, draft.minHours],
  );
  const likedPrefKeys = useMemo(
    () => prefOptions.filter((k) => draft.liked.includes(startOfKey(k))),
    [prefOptions, draft.liked],
  );
  const dislikedPrefKeys = useMemo(
    () => prefOptions.filter((k) => draft.disliked.includes(startOfKey(k))),
    [prefOptions, draft.disliked],
  );
  // FUNCTIONAL update is load-bearing: the bubble grid's bulk-apply toolbar
  // fires this once per selected key in a synchronous loop (the documented
  // stale-state trap on ShowtimeBallotSection.toggle).
  const togglePref = useCallback((slotKey: string, next: SlotState) => {
    const t = startOfKey(slotKey);
    if (!t) return;
    setDraft((prev) => ({
      ...prev,
      liked: next === "liked" ? [...prev.liked.filter((x) => x !== t), t] : prev.liked.filter((x) => x !== t),
      disliked:
        next === "disliked"
          ? [...prev.disliked.filter((x) => x !== t), t]
          : prev.disliked.filter((x) => x !== t),
    }));
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
  // Duration bounds stay ordered INSTANTLY, mirroring the people pair:
  // raising the minimum pushes the maximum up, lowering the maximum pulls
  // the minimum down (the Max field also only offers options >= min).
  const setMinHours = useCallback((h: number) => {
    setDraft((prev) => ({ ...prev, minHours: h, maxHours: Math.max(prev.maxHours, h) }));
  }, []);
  const setMaxHours = useCallback((h: number) => {
    setDraft((prev) => ({ ...prev, maxHours: h, minHours: Math.min(prev.minHours, h) }));
  }, []);

  // Toggling is keyed on the candidate KEY (identity, else name) so two
  // same-named contacts stay distinct and a rename can't orphan a pick.
  const toggleEntryRef = useCallback(
    (field: "groups" | "people" | "excludeGroups" | "excludePeople", c: Candidate) => {
      setDraft((prev) => {
        const list = prev.entry[field];
        const key = candidateKey(c);
        const has = list.some((r) => candidateKey({ kind: c.kind, ...r }) === key);
        const next = has
          ? list.filter((r) => candidateKey({ kind: c.kind, ...r }) !== key)
          : [...list, { id: c.id, name: c.name }];
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
    if (mode === "activity") {
      saveActivityDraft(draft);
      return;
    }
    let req: Promise<unknown>;
    if (mode === "create") {
      if (dayTimeWindows.length === 0) return;
      req = apiCreateSlot(dayTimeWindows, []);
    } else {
      if (!editingSlot || dayTimeWindows.length === 0) return;
      req = apiUpdateSlot(editingSlot.id, dayTimeWindows, editingSlot.activities);
    }
    setSaving(true);
    haptic.success();
    req
      .then(() => {
        notifySlotsChanged();
        close();
      })
      .catch(() => setSaving(false));
  }, [saving, deleting, mode, dayTimeWindows, draft, editingSlot, close, saveActivityDraft]);

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
  // the one being renamed into, which is the draft's own current pick. The
  // list also narrows as the name is typed (it's the field's own dropdown).
  const filteredSuggestions = useMemo<ActivitySuggestions>(() => {
    const taken = new Set(
      (editingSlot?.activities ?? [])
        .filter((_, i) => i !== activityIndex)
        .map((a) => nameKey(a.name)),
    );
    const q = nameKey(draft.name);
    const drop = (list: ActivitySuggestion[]) =>
      list.filter((a) => !taken.has(nameKey(a.name)) && (!q || nameKey(a.name).includes(q)));
    return {
      overlapping: drop(suggestions.overlapping),
      yours: drop(suggestions.yours),
      others: drop(suggestions.others),
    };
  }, [suggestions, editingSlot, activityIndex, draft.name]);

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
      cancelledRef.current = true;
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

  // The activity's name + emoji field with its suggestion dropdown. Shared
  // by BOTH containers: the top-of-page add panel and the edit sheet.
  const activityField = (
    <section className="rounded-3xl bg-white dark:bg-gray-800 px-4 py-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setEmojiOpen(true)}
          aria-label="Choose an emoji"
          className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center bg-gray-200 dark:bg-gray-700 text-xl leading-none active:scale-95"
        >
          <span className={draft.emoji.trim() ? "" : "opacity-40"}>
            {draft.emoji.trim() || EMOJI_PLACEHOLDER}
          </span>
        </button>
        <input
          // Takes the keyboard primed by the "+" tap (add panel only; a no-op
          // otherwise) and selects, so the field opens ready to type.
          ref={consumePrimedFocus}
          value={draft.name}
          onChange={(e) => setName(e.target.value)}
          onFocus={(e) => {
            setSuggestOpen(true);
            // Pre-filled (edit mode): select all so the first keystroke
            // replaces the name — and the dropdown, which narrows on
            // what's typed, opens back up to the full list.
            e.currentTarget.select();
          }}
          onBlur={(e) => {
            setName(e.target.value.trim());
            setSuggestOpen(false);
            // The add panel has no ✓: closing the keyboard IS the accept.
            // Skipped while a stacked modal has taken focus (the emoji picker
            // steals it, which would otherwise read as a Done) and when the
            // close was an explicit cancel.
            if (!isAddActivity || emojiOpen || pendingBlacklist !== null) return;
            if (cancelledRef.current) {
              cancelledRef.current = false;
              return;
            }
            if (e.target.value.trim()) handleSave();
            else close();
          }}
          // Re-tapping an already-focused field fires no focus event, so this
          // is the only way back to the list after a pick collapsed it.
          onClick={() => setSuggestOpen(true)}
          placeholder="Activity"
          aria-label="Activity name"
          className="flex-1 min-w-0 bg-transparent text-base outline-none placeholder:text-gray-400 dark:placeholder:text-gray-500"
        />
      </div>
      {/* The field's own dropdown: suggested activities grouped +
          labeled by priority, narrowed by what's typed. Tapping one commits
          it outright in the add panel (see pickSuggestion); in edit mode it
          names the draft (and takes its emoji) and collapses the list.
          Only the "you've picked before" group carries an ✕ to delete
          (behind a confirmation → blacklist); the others (things other
          people are doing) can't be deleted. */}
      {suggestOpen && hasSuggestions && (
        <div className="mt-3 max-h-64 overflow-y-auto overscroll-contain divide-y divide-gray-200 dark:divide-gray-700">
          {SUGGESTION_GROUPS.map((group) => {
            const items = filteredSuggestions[group.key];
            if (items.length === 0) return null;
            const canDelete = group.key === "yours";
            return (
              <div key={group.key} className="px-3 py-2">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1">
                  {group.label}
                </p>
                <ul>
                  {items.map((activity) => {
                    return (
                      <li
                        key={activity.name}
                        className="flex items-center gap-3 h-11"
                        // Commit before the input blurs (blur collapses the
                        // dropdown).
                        onMouseDown={(e) => e.preventDefault()}
                      >
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
        </div>
      )}
    </section>
  );

  return (
    <ModalPortal>
      {isAddActivity ? (
        /* ADDING: not a sheet — the field is injected at the top of the page,
           over the still-visible timeline. A transparent full-screen catcher
           (no dim) closes it on an outside tap. */
        <>
          <div className="fixed inset-0 z-[59]" onClick={close} aria-hidden="true" />
          <div
            // ABSOLUTE, not fixed: the panel is pinned in the DOCUMENT under
            // the tapped "+" so it rides the smooth scroll up to the top of
            // the screen with the rest of the page.
            className={`left-0 right-0 z-[60] px-3 pointer-events-none ${
              anchorBottom != null ? "absolute" : "fixed"
            }`}
            style={
              anchorBottom != null
                ? { top: `${anchorBottom}px` }
                : { top: 0, paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.5rem)" }
            }
          >
            <div
              className="pointer-events-auto mx-auto w-full sm:max-w-md rounded-3xl bg-gray-100 dark:bg-gray-900 p-2 shadow-2xl animate-fade-in"
              role="dialog"
              aria-modal="true"
              aria-label={title}
            >
              <div className="min-w-0 flex-1">{activityField}</div>
            </div>
          </div>
        </>
      ) : (
        <>
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
          {/* How far this activity is from actually happening ("Needs N
              more"), right under the sheet title. The slot is ALWAYS
              reserved while editing an activity — same height whether the
              bubble is there or not — so the cards below never shift as the
              count loads, appears, or clears. */}
          {showActivity && !isNewActivity && (
            // -mt-2 tucks the bubble up against the title (the header's
            // min-height leaves centering slack below it).
            <div aria-live="polite" className="shrink-0 h-8 -mt-2 flex items-start justify-center">
              {neededMore > 0 && (
                <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                  Needs {neededMore} more {neededMore === 1 ? "person" : "people"}
                </span>
              )}
            </div>
          )}
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
            {activityField}

            {/* The activity's who-with condition, EDIT MODE ONLY — adding is
                just "which activity?", and you tap the activity afterward to
                say who it's with. One card in the settings-card format
                (label/value rows over hairlines): who it's with, the
                party-size range, and who it's explicitly NOT with.
                "With"/"Without" expand in place into a search box +
                suggestions, and keep their picks as pills under the row. */}
            {!isNewActivity && (
            <section className="rounded-3xl bg-white dark:bg-gray-800 px-4 divide-y divide-gray-200 dark:divide-gray-700">
              <CandidatePicker
                label="With"
                emptyValue="Anyone"
                selected={withSelected}
                options={candidateOptions}
                onAdd={(c) => toggleEntryRef(c.kind, c)}
                onRemove={(c) => toggleEntryRef(c.kind, c)}
                onOpenChange={handlePickerOpenChange}
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
                emptyValue="—"
                selected={withoutSelected}
                options={candidateOptions}
                onAdd={(c) => toggleEntryRef(excludeField(c.kind), c)}
                onRemove={(c) => toggleEntryRef(excludeField(c.kind), c)}
                onOpenChange={handlePickerOpenChange}
              />
            </section>
            )}

            {/* How long the activity should run. The pair is enforced ordered
                on every change; the bounds feed the events engine (a set is
                only viable when everyone's bounds are mutually satisfiable,
                and an event can't start where the binding minimum wouldn't
                fit the shared window) AND the ballot below (starts too close
                to the window's end to fit the minimum aren't offered). */}
            {!isNewActivity && (
              <section className="rounded-3xl bg-white dark:bg-gray-800 px-4 divide-y divide-gray-200 dark:divide-gray-700">
                <HoursField label="Minimum Duration" value={draft.minHours} setValue={setMinHours} />
                <HoursField
                  label="Maximum Duration"
                  value={draft.maxHours}
                  setValue={setMaxHours}
                  min={draft.minHours}
                />
              </section>
            )}

            {/* Preferred start times, EDIT MODE ONLY (like who-with): the
                time-poll bubble ballot over the slot's own window at 30-min
                starts. Green = prefer, red = avoid; proposed events land on
                the group's most-preferred viable start instead of always the
                earliest. The drag-select toolbar rides above the z-60 sheet.
                Bubbles are limited to starts the MINIMUM duration still fits
                before the window closes. */}
            {!isNewActivity && prefOptions.length > 0 && (
              <div>
                <label className="block text-[17.5px] font-medium text-gray-500 dark:text-gray-400 mb-1 px-1">
                  Preferred Start Times
                </label>
                <section className="rounded-3xl bg-white dark:bg-gray-800 px-4 py-3">
                  <TimeSlotBubbles
                    options={prefOptions}
                    likedSlots={likedPrefKeys}
                    dislikedSlots={dislikedPrefKeys}
                    onToggle={togglePref}
                    toolbarZClassName="z-[70]"
                  />
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

            {/* Scroll room for an expanded who-with picker (see pickersOpen
                above): tall enough that even the last field's row can reach
                the scroller top, clear of the soft keyboard. Sits under the
                keyboard / off-screen, so it never reads as blank space. */}
            {pickersOpen > 0 && <div aria-hidden className="h-[70vh] shrink-0" />}
          </div>
        </div>
      </div>

        </>
      )}

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
