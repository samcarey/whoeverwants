import { describe, it, expect } from 'vitest';
import {
  DEFAULT_RECURRENCE,
  RecurrenceRule,
  recurrenceIsActive,
  generateOccurrences,
  summarizeRecurrence,
  shortRecurrenceLabel,
  recurrenceNote,
  monthlyNthWeekdayLabel,
  formatLocalDateISO,
} from '@/lib/recurrence';

const iso = (d: Date) => formatLocalDateISO(d);
function rule(p: Partial<RecurrenceRule>): RecurrenceRule {
  return { ...DEFAULT_RECURRENCE, ...p };
}

describe('recurrenceIsActive', () => {
  it('false for none, true otherwise', () => {
    expect(recurrenceIsActive(DEFAULT_RECURRENCE)).toBe(false);
    expect(recurrenceIsActive(rule({ frequency: 'weekly' }))).toBe(true);
    expect(recurrenceIsActive(null)).toBe(false);
  });
});

describe('daily', () => {
  it('every day from start', () => {
    const occ = generateOccurrences(rule({ frequency: 'daily', interval: 1 }), '2026-01-01', { limit: 3 });
    expect(occ.map(iso)).toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);
  });
  it('every 3 days', () => {
    const occ = generateOccurrences(rule({ frequency: 'daily', interval: 3 }), '2026-01-01', { limit: 3 });
    expect(occ.map(iso)).toEqual(['2026-01-01', '2026-01-04', '2026-01-07']);
  });
  it('honours after-N count', () => {
    const occ = generateOccurrences(rule({ frequency: 'daily', end: { type: 'after', count: 2 } }), '2026-01-01', { limit: 10 });
    expect(occ.map(iso)).toEqual(['2026-01-01', '2026-01-02']);
  });
  it('honours until date (inclusive)', () => {
    const occ = generateOccurrences(rule({ frequency: 'daily', end: { type: 'on', date: '2026-01-03' } }), '2026-01-01', { limit: 10 });
    expect(occ.map(iso)).toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);
  });
});

describe('weekly', () => {
  it('picks only selected weekdays, every week', () => {
    // 2026-01-01 is a Thursday. Pick Mon(1) + Wed(3).
    const occ = generateOccurrences(rule({ frequency: 'weekly', interval: 1, weekdays: [1, 3] }), '2026-01-01', { limit: 4 });
    expect(occ.map(iso)).toEqual(['2026-01-05', '2026-01-07', '2026-01-12', '2026-01-14']);
  });
  it('respects bi-weekly interval', () => {
    // Thursdays, every 2 weeks, from Thu 2026-01-01.
    const occ = generateOccurrences(rule({ frequency: 'weekly', interval: 2, weekdays: [4] }), '2026-01-01', { limit: 3 });
    expect(occ.map(iso)).toEqual(['2026-01-01', '2026-01-15', '2026-01-29']);
  });
  it('falls back to start weekday when none selected', () => {
    const occ = generateOccurrences(rule({ frequency: 'weekly', weekdays: [] }), '2026-01-01', { limit: 2 });
    expect(occ.map(iso)).toEqual(['2026-01-01', '2026-01-08']);
  });
});

describe('monthly day-of-month', () => {
  it('same day each month', () => {
    const occ = generateOccurrences(rule({ frequency: 'monthly', monthlyMode: 'dayOfMonth' }), '2026-01-15', { limit: 3 });
    expect(occ.map(iso)).toEqual(['2026-01-15', '2026-02-15', '2026-03-15']);
  });
  it('clamps the 31st to short months', () => {
    const occ = generateOccurrences(rule({ frequency: 'monthly', monthlyMode: 'dayOfMonth' }), '2026-01-31', { limit: 3 });
    expect(occ.map(iso)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
  });
  it('every 3 months', () => {
    const occ = generateOccurrences(rule({ frequency: 'monthly', interval: 3, monthlyMode: 'dayOfMonth' }), '2026-01-10', { limit: 3 });
    expect(occ.map(iso)).toEqual(['2026-01-10', '2026-04-10', '2026-07-10']);
  });
});

describe('monthly nth-weekday', () => {
  it('the nth weekday each month', () => {
    // 2026-01-13 is the 2nd Tuesday of January.
    const occ = generateOccurrences(rule({ frequency: 'monthly', monthlyMode: 'nthWeekday' }), '2026-01-13', { limit: 3 });
    // 2nd Tuesday: Jan 13, Feb 10, Mar 10.
    expect(occ.map(iso)).toEqual(['2026-01-13', '2026-02-10', '2026-03-10']);
  });
  it('falls back to last when a 5th does not exist', () => {
    // 2026-01-29 is the 5th Thursday of January. Feb 2026 has only 4 Thursdays.
    const occ = generateOccurrences(rule({ frequency: 'monthly', monthlyMode: 'nthWeekday' }), '2026-01-29', { limit: 2 });
    expect(iso(occ[0])).toBe('2026-01-29');
    // Last Thursday of Feb 2026 = Feb 26.
    expect(iso(occ[1])).toBe('2026-02-26');
  });
  it('labels the start date correctly', () => {
    expect(monthlyNthWeekdayLabel('2026-01-13')).toBe('2nd Tue');
  });
});

describe('summaries', () => {
  it('does not repeat when off', () => {
    expect(summarizeRecurrence(DEFAULT_RECURRENCE)).toBe('Does not repeat');
    expect(shortRecurrenceLabel(DEFAULT_RECURRENCE)).toBe('Off');
  });
  it('weekly with named days + count', () => {
    const r = rule({ frequency: 'weekly', interval: 2, weekdays: [1, 3], end: { type: 'after', count: 5 } });
    expect(summarizeRecurrence(r, '2026-01-01')).toBe('Every 2 weeks on Mon, Wed · 5 times');
  });
  it('collapses weekdays shorthand', () => {
    const r = rule({ frequency: 'weekly', weekdays: [1, 2, 3, 4, 5] });
    expect(summarizeRecurrence(r, '2026-01-01')).toBe('Weekly on weekdays');
  });
  it('collapses weekend shorthand', () => {
    const r = rule({ frequency: 'weekly', weekdays: [0, 6] });
    expect(summarizeRecurrence(r, '2026-01-01')).toBe('Weekly on weekends');
  });
  it('monthly nth-weekday with until', () => {
    const r = rule({ frequency: 'monthly', monthlyMode: 'nthWeekday', end: { type: 'on', date: '2026-12-31' } });
    const s = summarizeRecurrence(r, '2026-01-13');
    expect(s).toContain('Monthly on the second Tuesday');
    expect(s).toContain('until');
  });
  it('builds a notes line', () => {
    const r = rule({ frequency: 'daily' });
    expect(recurrenceNote(r, '2026-01-01')).toBe('🔁 Repeats: Daily');
  });
});

describe('preview safety', () => {
  it('bounds an unbounded series at limit', () => {
    const occ = generateOccurrences(rule({ frequency: 'daily' }), '2026-01-01', { limit: 5 });
    expect(occ).toHaveLength(5);
  });
  it('after-count smaller than limit wins', () => {
    const occ = generateOccurrences(rule({ frequency: 'daily', end: { type: 'after', count: 2 } }), '2026-01-01', { limit: 5 });
    expect(occ).toHaveLength(2);
  });
});
