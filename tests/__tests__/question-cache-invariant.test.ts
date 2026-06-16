/**
 * Pins the field-level vs shape-level cache invalidation invariant in
 * `lib/questionCache.ts`. See CLAUDE.md → "In-memory data cache for
 * navigation" for the back-nav scroll regression this prevents.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cacheAccessiblePolls,
  cachePoll,
  getCachedAccessiblePolls,
  getCachedPollById,
  invalidateAccessibleQuestions,
  invalidatePoll,
  invalidateQuestion,
  peekAccessiblePolls,
} from '@/lib/questionCache';
import type { Poll } from '@/lib/types';

function buildPoll(id: string, questionIds: string[]): Poll {
  return {
    id,
    short_id: `s-${id}`,
    is_closed: false,
    title: `poll-${id}`,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    questions: questionIds.map((qid) => ({
      id: qid,
      title: `q-${qid}`,
      question_type: 'yes_no',
      is_closed: false,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      poll_id: id,
      question_index: 0,
    } as unknown as Poll['questions'][number])),
    voter_names: [],
    anonymous_count: 0,
  };
}

describe('questionCache field-level vs shape-level invariant', () => {
  beforeEach(() => {
    // Reset the cache to a known starting state. We can't import the
    // private cache map directly, but `invalidateAccessibleQuestions`
    // clears the accessible-polls list — that's the only state these
    // tests assert against.
    invalidateAccessibleQuestions();
  });

  it('invalidateQuestion does NOT clear accessiblePollsCache', () => {
    const poll = buildPoll('p1', ['q1', 'q2']);
    cacheAccessiblePolls([poll]);
    expect(getCachedAccessiblePolls()).toHaveLength(1);

    invalidateQuestion('q1');

    // Accessible list survives — only the per-question caches are
    // dropped. Stale per-question fields embedded in the cached Poll
    // are corrected by the 5s group-page refresh + per-question
    // results/votes refetch, bounded by the cache TTL.
    expect(getCachedAccessiblePolls()).toHaveLength(1);
    expect(getCachedAccessiblePolls()?.[0].id).toBe('p1');
  });

  it('invalidatePoll does NOT clear accessiblePollsCache', () => {
    const poll = buildPoll('p1', ['q1']);
    cachePoll(poll);
    cacheAccessiblePolls([poll]);
    expect(getCachedAccessiblePolls()).toHaveLength(1);

    invalidatePoll('p1');

    // Per-poll cache entry IS dropped (so freshly-mutated fields don't
    // get served from the per-poll cache on the next read)…
    expect(getCachedPollById('p1')).toBeNull();
    // …but the accessible-polls list keeps the entry. Field-level
    // mutations (vote / close / reopen / cutoff / edit / title-update)
    // don't change which polls exist in which group — `buildGroupSyncFromCache`
    // still needs to find the poll to mount all its cards for an
    // accurate `scrollHeight` on back-nav restoration.
    expect(getCachedAccessiblePolls()).toHaveLength(1);
    expect(getCachedAccessiblePolls()?.[0].id).toBe('p1');
  });

  it('invalidateAccessibleQuestions clears the accessible-polls list', () => {
    cacheAccessiblePolls([buildPoll('p1', ['q1'])]);
    expect(getCachedAccessiblePolls()).toHaveLength(1);

    invalidateAccessibleQuestions();

    expect(getCachedAccessiblePolls()).toBeNull();
  });

  it('forget-shaped flow: invalidateQuestion + invalidateAccessibleQuestions drops the list', () => {
    // Mirrors `lib/forgetQuestion.ts`'s shape-changing call pattern:
    // forget the question's field-level caches, then explicitly drop
    // the accessible-polls list so the next read re-fetches without
    // the forgotten entry.
    cacheAccessiblePolls([buildPoll('p1', ['q1'])]);

    invalidateQuestion('q1');
    invalidateAccessibleQuestions();

    expect(getCachedAccessiblePolls()).toBeNull();
  });
});

describe('peekAccessiblePolls (TTL-ignoring read for hydrateAndCache merge)', () => {
  beforeEach(() => {
    invalidateAccessibleQuestions();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the cached value even after the TTL has lapsed', () => {
    vi.useFakeTimers();
    cacheAccessiblePolls([buildPoll('p1', ['q1'])]);

    // Advance past the 60s accessible-polls TTL.
    vi.advanceTimersByTime(61_000);

    // The TTL-gated getter treats the entry as gone…
    expect(getCachedAccessiblePolls()).toBeNull();
    // …but the raw peek still returns it, so a single-group refresh that
    // lands after the TTL lapse (the group page's recurring 5s
    // apiGetGroupByRouteId) can preserve OTHER groups instead of evicting
    // them — the home-backdrop "only one group" regression this fixes.
    expect(peekAccessiblePolls()).toHaveLength(1);
    expect(peekAccessiblePolls()?.[0].id).toBe('p1');
  });

  it('returns null after an explicit clear (forget/leave respected)', () => {
    cacheAccessiblePolls([buildPoll('p1', ['q1'])]);
    expect(peekAccessiblePolls()).toHaveLength(1);

    invalidateAccessibleQuestions();

    // Explicit clear nulls the reference (not merely expires it), so the
    // peek drops everything — a single-group refresh after forget/leave
    // correctly rebuilds the cache with only the current group.
    expect(peekAccessiblePolls()).toBeNull();
  });
});
