/**
 * Poll recurrence — a small RRULE-flavoured rule + pure helpers.
 *
 * PROTOTYPE SCOPE: this models "this poll repeats on a schedule" entirely on
 * the front end. The rule is captured on the create-poll form, previewed live
 * (next-occurrence list + human summary), persisted in the draft form state,
 * and folded into the poll's Notes on submit so the created poll visibly
 * advertises its schedule. Actually spinning up the next poll instance on a
 * timer is a server concern (a scheduler reading this rule) and is out of
 * scope here — but the rule shape is deliberately close to iCalendar RRULE
 * (FREQ / INTERVAL / BYDAY / COUNT / UNTIL) so a real backend could adopt it
 * with little translation.
 *
 * Everything here is pure + deterministic-given-`start`, so it's unit-testable
 * without a DOM (see tests/__tests__/recurrence.test.ts).
 */

export type RecurrenceFrequency = 'none' | 'daily' | 'weekly' | 'monthly';

/** How the series stops. */
export type RecurrenceEnd =
  | { type: 'never' }
  | { type: 'after'; count: number }
  | { type: 'on'; date: string }; // YYYY-MM-DD (inclusive)

/** For monthly recurrence: anchor on the day-of-month (e.g. "the 15th") or on
 *  the nth weekday (e.g. "the 2nd Tuesday"). Both are derived from the start
 *  date, so the picker just exposes the choice. */
export type MonthlyMode = 'dayOfMonth' | 'nthWeekday';

export interface RecurrenceRule {
  frequency: RecurrenceFrequency;
  /** "every N" — N days / weeks / months. >= 1. */
  interval: number;
  /** Weekly only: 0=Sun … 6=Sat. Empty falls back to the start date's weekday. */
  weekdays: number[];
  monthlyMode: MonthlyMode;
  end: RecurrenceEnd;
}

export const DEFAULT_RECURRENCE: RecurrenceRule = {
  frequency: 'none',
  interval: 1,
  weekdays: [],
  monthlyMode: 'dayOfMonth',
  end: { type: 'never' },
};

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export const WEEKDAY_LABELS_LONG = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
] as const;
const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth'];
const ORDINALS_SHORT = ['1st', '2nd', '3rd', '4th', '5th'];

/** A recurrence is "on" iff it actually repeats. */
export function recurrenceIsActive(rule: RecurrenceRule | null | undefined): boolean {
  return !!rule && rule.frequency !== 'none';
}

// ---------------------------------------------------------------------------
// Date helpers (local, noon-anchored to dodge DST hour shifts)
// ---------------------------------------------------------------------------

/** Parse a YYYY-MM-DD string (or any Date-ish) into a local noon Date. */
function toLocalNoon(input: string | Date): Date {
  if (input instanceof Date) {
    return new Date(input.getFullYear(), input.getMonth(), input.getDate(), 12, 0, 0, 0);
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(input);
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
  }
  const d = new Date(input);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
}

export function formatLocalDateISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/** Which occurrence of its weekday a date is within its month (1-based). */
function weekdayOrdinalInMonth(d: Date): number {
  return Math.floor((d.getDate() - 1) / 7) + 1;
}

/** The date of the `ordinal`-th `weekday` in a given month. When `ordinal` is
 *  5 ("last") and the month has only four of that weekday, returns the last
 *  one. Returns null only for impossible inputs. */
function nthWeekdayOfMonth(year: number, month: number, weekday: number, ordinal: number): Date | null {
  const first = new Date(year, month, 1, 12, 0, 0, 0);
  const offset = (weekday - first.getDay() + 7) % 7;
  let day = 1 + offset + (ordinal - 1) * 7;
  if (day > daysInMonth(year, month)) {
    // "5th" requested but absent → fall back to the last occurrence.
    if (ordinal >= 5) {
      day -= 7;
      if (day < 1 || day > daysInMonth(year, month)) return null;
    } else {
      return null;
    }
  }
  return new Date(year, month, day, 12, 0, 0, 0);
}

// ---------------------------------------------------------------------------
// Occurrence generation
// ---------------------------------------------------------------------------

export interface GenerateOpts {
  /** Hard cap on how many dates to return (a preview wants ~5). */
  limit?: number;
  /** Treat the start date as occurrence #1 (default true). */
  includeStart?: boolean;
}

/**
 * Generate the series of occurrence dates for a rule, starting from `start`.
 * Honours the end condition (never / after N / until date) AND the `limit`,
 * whichever comes first. Returns `[]` for a non-recurring rule.
 */
export function generateOccurrences(
  rule: RecurrenceRule,
  start: string | Date,
  opts: GenerateOpts = {},
): Date[] {
  if (!recurrenceIsActive(rule)) return [];
  const limit = Math.max(0, opts.limit ?? 5);
  const includeStart = opts.includeStart ?? true;
  const startDate = toLocalNoon(start);
  const interval = Math.max(1, Math.round(rule.interval) || 1);

  const maxCount = rule.end.type === 'after' ? Math.max(1, Math.round(rule.end.count)) : Infinity;
  const until = rule.end.type === 'on' ? toLocalNoon(rule.end.date) : null;
  // Generous walk bound so an "every 3 months for 2 years" series can't loop
  // forever even if limit/count/until somehow never trip.
  const HARD_WALK_CAP = 1000;

  const out: Date[] = [];
  const push = (d: Date): boolean => {
    if (until && d.getTime() > until.getTime()) return false;
    out.push(d);
    return out.length < maxCount && out.length < (limit || Infinity);
  };

  if (rule.frequency === 'daily') {
    for (let k = includeStart ? 0 : 1, steps = 0; steps < HARD_WALK_CAP; k++, steps++) {
      if (!push(addDays(startDate, k * interval))) break;
    }
    return out;
  }

  if (rule.frequency === 'weekly') {
    const days = rule.weekdays.length ? [...rule.weekdays].sort((a, b) => a - b) : [startDate.getDay()];
    const daySet = new Set(days);
    // Anchor weeks to the Sunday of the start week so interval gaps are
    // measured in whole weeks (RRULE WKST-agnostic — Sunday-start here).
    const weekAnchor = addDays(startDate, -startDate.getDay());
    for (let cursor = new Date(startDate), steps = 0; steps < HARD_WALK_CAP; cursor = addDays(cursor, 1), steps++) {
      if (cursor.getTime() < startDate.getTime()) continue;
      if (!includeStart && cursor.getTime() === startDate.getTime()) continue;
      if (!daySet.has(cursor.getDay())) continue;
      const weekIndex = Math.floor((addDays(cursor, -cursor.getDay()).getTime() - weekAnchor.getTime()) / (7 * 86400000));
      if (weekIndex % interval !== 0) continue;
      if (!push(new Date(cursor))) break;
    }
    return out;
  }

  // monthly
  const anchorOrdinal = weekdayOrdinalInMonth(startDate);
  const anchorWeekday = startDate.getDay();
  const anchorDom = startDate.getDate();
  for (let k = includeStart ? 0 : 1, steps = 0; steps < HARD_WALK_CAP; k++, steps++) {
    const base = new Date(startDate.getFullYear(), startDate.getMonth() + k * interval, 1, 12, 0, 0, 0);
    const year = base.getFullYear();
    const month = base.getMonth();
    let occ: Date | null;
    if (rule.monthlyMode === 'nthWeekday') {
      occ = nthWeekdayOfMonth(year, month, anchorWeekday, anchorOrdinal);
    } else {
      // Clamp the day-of-month to the month's length (e.g. the 31st → 30th/28th).
      const day = Math.min(anchorDom, daysInMonth(year, month));
      occ = new Date(year, month, day, 12, 0, 0, 0);
    }
    if (!occ) continue;
    if (occ.getTime() < startDate.getTime()) continue;
    if (!push(occ)) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Human-readable summary
// ---------------------------------------------------------------------------

function joinWeekdays(weekdays: number[]): string {
  const sorted = [...weekdays].sort((a, b) => a - b);
  // Common shorthands.
  if (sorted.length === 7) return 'every day';
  const isWeekdays = sorted.length === 5 && sorted.every(d => d >= 1 && d <= 5);
  if (isWeekdays) return 'weekdays';
  const isWeekend = sorted.length === 2 && sorted.includes(0) && sorted.includes(6);
  if (isWeekend) return 'weekends';
  return sorted.map(d => WEEKDAY_LABELS[d]).join(', ');
}

function formatEndClause(end: RecurrenceEnd): string {
  if (end.type === 'after') return ` · ${end.count} time${end.count === 1 ? '' : 's'}`;
  if (end.type === 'on') {
    const d = toLocalNoon(end.date);
    return ` · until ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }
  return '';
}

/**
 * One-line human summary, e.g.:
 *   "Every 2 weeks on Mon, Wed · 5 times"
 *   "Monthly on the 2nd Tuesday · until Dec 31, 2026"
 *   "Daily"
 * `start` lets weekly/monthly summaries name the implicit day when the rule
 * carries none (weekly with no BYDAY, monthly anchors).
 */
export function summarizeRecurrence(rule: RecurrenceRule, start?: string | Date): string {
  if (!recurrenceIsActive(rule)) return 'Does not repeat';
  const n = Math.max(1, Math.round(rule.interval) || 1);
  const startDate = start ? toLocalNoon(start) : null;
  let core: string;

  if (rule.frequency === 'daily') {
    core = n === 1 ? 'Daily' : `Every ${n} days`;
  } else if (rule.frequency === 'weekly') {
    const days = rule.weekdays.length
      ? rule.weekdays
      : startDate
        ? [startDate.getDay()]
        : [];
    const onClause = days.length ? ` on ${joinWeekdays(days)}` : '';
    core = (n === 1 ? 'Weekly' : `Every ${n} weeks`) + onClause;
  } else {
    const cadence = n === 1 ? 'Monthly' : `Every ${n} months`;
    if (startDate && rule.monthlyMode === 'nthWeekday') {
      const ord = weekdayOrdinalInMonth(startDate);
      const ordWord = ORDINALS[Math.min(ord, 5) - 1] ?? `${ord}th`;
      core = `${cadence} on the ${ordWord} ${WEEKDAY_LABELS_LONG[startDate.getDay()]}`;
    } else if (startDate) {
      const dom = startDate.getDate();
      core = `${cadence} on day ${dom}`;
    } else {
      core = cadence;
    }
  }
  return core + formatEndClause(rule.end);
}

/** Short label for the collapsed settings row (no end clause). */
export function shortRecurrenceLabel(rule: RecurrenceRule): string {
  if (!recurrenceIsActive(rule)) return 'Off';
  const n = Math.max(1, Math.round(rule.interval) || 1);
  if (rule.frequency === 'daily') return n === 1 ? 'Daily' : `Every ${n} days`;
  if (rule.frequency === 'weekly') return n === 1 ? 'Weekly' : `Every ${n} weeks`;
  return n === 1 ? 'Monthly' : `Every ${n} months`;
}

/**
 * The compact note folded into the poll's Notes on submit, so a created poll
 * visibly advertises its schedule (prototype: stands in for a real scheduler).
 */
export function recurrenceNote(rule: RecurrenceRule, start?: string | Date): string {
  return `🔁 Repeats: ${summarizeRecurrence(rule, start)}`;
}

/** True when the nth-weekday monthly mode is even expressible — i.e. the start
 *  date isn't in the trailing days where an ordinal can't be derived. Always
 *  true in practice (every date is the nth of its weekday), exposed for the UI
 *  to label the option ("2nd Tuesday") from the start date. */
export function monthlyNthWeekdayLabel(start: string | Date): string {
  const d = toLocalNoon(start);
  const ord = weekdayOrdinalInMonth(d);
  const ordWord = ORDINALS_SHORT[Math.min(ord, 5) - 1] ?? `${ord}th`;
  return `${ordWord} ${WEEKDAY_LABELS[d.getDay()]}`;
}

export function monthlyDayOfMonthLabel(start: string | Date): string {
  const d = toLocalNoon(start);
  return `Day ${d.getDate()}`;
}
