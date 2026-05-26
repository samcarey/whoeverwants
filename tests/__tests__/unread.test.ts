/**
 * Pins the client-side unread predicate (`lib/unread.ts: isPollUnread`),
 * which must mirror the server's `compute_badge_count` two-mode logic so the
 * gold "unread" bar on group cards + the home-list emphasis agree with the
 * app-icon badge. See CLAUDE.md → "App-Icon Badge Model".
 */

import { describe, expect, it } from 'vitest';
import { isPollUnread } from '@/lib/unread';
import type { BadgeSettings } from '@/lib/badgeSettings';
import type { Poll } from '@/lib/types';

const NOW = Date.parse('2026-05-26T12:00:00Z');
const HOUR = 3600_000;

const VIEW_MODE: BadgeSettings = { todoMode: false, onVotingOpen: true, onResults: true };
const RESPOND_MODE: BadgeSettings = { todoMode: true, onVotingOpen: true, onResults: true };

function poll(overrides: Partial<Poll>): Poll {
  return {
    id: 'p1',
    is_closed: false,
    title: 'poll',
    created_at: new Date(NOW - 10 * HOUR).toISOString(),
    updated_at: new Date(NOW - 10 * HOUR).toISOString(),
    questions: [],
    voter_names: [],
    anonymous_count: 0,
    ...overrides,
  } as Poll;
}

const unread = (p: Poll, opts: { settings: BadgeSettings; lastViewedMs: number; hasResponded: boolean }) =>
  isPollUnread(p, { ...opts, nowMs: NOW });

describe('isPollUnread — opening-marks-read (default)', () => {
  it('is unread when never viewed since creation', () => {
    expect(unread(poll({}), { settings: VIEW_MODE, lastViewedMs: 0, hasResponded: false })).toBe(true);
  });

  it('clears once viewed after creation', () => {
    expect(
      unread(poll({}), { settings: VIEW_MODE, lastViewedMs: NOW - HOUR, hasResponded: false }),
    ).toBe(false);
  });

  it('re-lights when voting opens after the last view (onVotingOpen)', () => {
    const p = poll({ prephase_deadline: new Date(NOW - HOUR).toISOString() });
    // viewed before the prephase deadline passed → unread again
    expect(unread(p, { settings: VIEW_MODE, lastViewedMs: NOW - 2 * HOUR, hasResponded: false })).toBe(true);
    // viewed after it passed → read
    expect(unread(p, { settings: VIEW_MODE, lastViewedMs: NOW - 0.5 * HOUR, hasResponded: false })).toBe(false);
  });

  it('does NOT re-light on voting-open when onVotingOpen is off', () => {
    const p = poll({ prephase_deadline: new Date(NOW - HOUR).toISOString() });
    const settings = { ...VIEW_MODE, onVotingOpen: false };
    expect(unread(p, { settings, lastViewedMs: NOW - 2 * HOUR, hasResponded: false })).toBe(false);
  });

  it('re-lights when results arrive after the last view (onResults)', () => {
    const p = poll({ is_closed: true, updated_at: new Date(NOW - HOUR).toISOString() });
    expect(unread(p, { settings: VIEW_MODE, lastViewedMs: NOW - 2 * HOUR, hasResponded: false })).toBe(true);
    expect(unread(p, { settings: VIEW_MODE, lastViewedMs: NOW - 0.5 * HOUR, hasResponded: false })).toBe(false);
  });

  it('a future prephase (suggestion phase) does not re-light yet', () => {
    const p = poll({ prephase_deadline: new Date(NOW + HOUR).toISOString() });
    expect(unread(p, { settings: VIEW_MODE, lastViewedMs: NOW - HOUR, hasResponded: false })).toBe(false);
  });
});

describe('isPollUnread — stay-unread-until-I-respond (to-do)', () => {
  it('is unread while open + votable + not responded, regardless of views', () => {
    expect(
      unread(poll({}), { settings: RESPOND_MODE, lastViewedMs: NOW, hasResponded: false }),
    ).toBe(true);
  });

  it('clears only on a response, not a view', () => {
    expect(unread(poll({}), { settings: RESPOND_MODE, lastViewedMs: NOW, hasResponded: true })).toBe(false);
  });

  it('is read when closed', () => {
    const p = poll({ is_closed: true });
    expect(unread(p, { settings: RESPOND_MODE, lastViewedMs: 0, hasResponded: false })).toBe(false);
  });

  it('is read when the response deadline has passed', () => {
    const p = poll({ response_deadline: new Date(NOW - HOUR).toISOString() });
    expect(unread(p, { settings: RESPOND_MODE, lastViewedMs: 0, hasResponded: false })).toBe(false);
  });

  it('is read while still in suggestion phase (prephase not passed)', () => {
    const p = poll({ prephase_deadline: new Date(NOW + HOUR).toISOString() });
    expect(unread(p, { settings: RESPOND_MODE, lastViewedMs: 0, hasResponded: false })).toBe(false);
  });
});
