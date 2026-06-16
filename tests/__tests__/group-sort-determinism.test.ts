/**
 * Pins the invariant that `buildGroups` → `sortGroups` produces an order
 * that is a pure function of the group SET — independent of the input
 * `polls` array order.
 *
 * Why this matters (see CLAUDE.md → group ordering / swipe-back backdrop):
 * the home page renders the `/mine` server-ordered poll list directly,
 * while the swipe-back backdrop + the home page's synchronous init build
 * from `accessiblePollsCache`, whose array order is reshuffled by the
 * single-group 5s refresh (`hydrateAndCache` appends the current group's
 * polls to the end). If the sort were merely stable, tied groups (e.g.
 * every group with no deadline) would leak that array-order difference into
 * the displayed order, and home's mount fetch would visibly re-sort the
 * list a beat after every back transition. A totally-deterministic
 * comparator removes the dependency on array order.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { buildGroups } from '@/lib/groupUtils';
import type { Poll } from '@/lib/types';

function buildPoll(groupNum: number, createdAtIso: string): Poll {
  const id = `p${groupNum}`;
  return {
    id,
    short_id: `s${groupNum}`,
    group_id: `g${groupNum}`,
    group_short_id: `~${groupNum}`,
    is_closed: false,
    response_deadline: null,
    prephase_deadline: null,
    title: `poll-${groupNum}`,
    creator_name: `Creator${groupNum}`,
    created_at: createdAtIso,
    updated_at: createdAtIso,
    questions: [
      {
        id: `q${groupNum}`,
        title: `q-${groupNum}`,
        question_type: 'yes_no',
        is_closed: false,
        created_at: createdAtIso,
        updated_at: createdAtIso,
        poll_id: id,
        question_index: 0,
      },
    ],
    voter_names: [],
    anonymous_count: 0,
  } as unknown as Poll;
}

const voted = new Set<string>();
const abstained = new Set<string>();

function orderOf(polls: Poll[]): string[] {
  return buildGroups(polls, voted, abstained).map((g) => g.groupId ?? '');
}

describe('sortGroups determinism (order independent of input array order)', () => {
  beforeEach(() => {
    // Ensure no saved user name filters out participant names in a way that
    // would change group identity resolution.
    if (typeof window !== 'undefined') localStorage.clear();
  });

  it('distinct activity timestamps: same order regardless of array order', () => {
    // Three groups, no deadlines (all tie on the primary keys) but with
    // distinct created_at. Order must be by latestActivityMs desc and be
    // identical whether the polls arrive in forward or reverse order.
    const a = buildPoll(1, '2026-01-01T00:00:01Z');
    const b = buildPoll(2, '2026-01-01T00:00:02Z');
    const c = buildPoll(3, '2026-01-01T00:00:03Z');

    const forward = orderOf([a, b, c]);
    const reverse = orderOf([c, b, a]);
    const shuffled = orderOf([b, a, c]);

    // Newest activity first → g3, g2, g1.
    expect(forward).toEqual(['g3', 'g2', 'g1']);
    expect(reverse).toEqual(forward);
    expect(shuffled).toEqual(forward);
  });

  it('identical activity timestamps: stable group-identity tiebreak, order-independent', () => {
    // All three share the SAME created_at, so they tie on every key except
    // the final group-identity tiebreak. The result must still be identical
    // regardless of input order (no dependence on array order).
    const ts = '2026-01-01T00:00:00Z';
    const a = buildPoll(1, ts);
    const b = buildPoll(2, ts);
    const c = buildPoll(3, ts);

    const forward = orderOf([a, b, c]);
    const reverse = orderOf([c, b, a]);

    expect(reverse).toEqual(forward);
    // Tiebreak is a localeCompare on the stable identity (rootPollId = p1/p2/p3).
    expect(forward).toEqual(['g1', 'g2', 'g3']);
  });
});
