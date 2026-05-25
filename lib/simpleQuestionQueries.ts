// Group/poll queries. Group visibility is driven entirely by server-side
// `group_members` (the single source of truth) — keyed on the browser_id
// the API middleware mints, expanded across every browser linked to the
// signed-in user. There is no per-browser localStorage "accessible
// question ids" list anymore.

import type { GroupSummary, Poll } from '@/lib/types';
import {
  apiGetMyEmptyGroups,
  apiGetMyGroups,
} from '@/lib/api';

/** Combined response shape from `getMyGroups()` — polls + the
 *  membership-only empty groups (groups the user joined that don't
 *  have any polls yet). The home page merges both into one home list. */
export interface MyGroupsResult {
  polls: Poll[];
  emptyGroups: GroupSummary[];
}

// Coalesce concurrent getMyGroups calls (e.g., StrictMode double-mount).
let myGroupsInFlight: Promise<MyGroupsResult> | null = null;
let emptyGroupsCache: GroupSummary[] | null = null;

/** Fetch every group the caller is a member of (populated + empty) in one
 *  server round-trip pair. Membership is the single authority — the server
 *  returns the caller's member groups based on the browser_id (and any
 *  browser linked to their signed-in user_id), so no localStorage list is
 *  consulted or sent.
 *
 *  `/mine` returns the populated groups' visible polls; `/empty` returns
 *  membership-only groups with no polls yet. Both fire in parallel;
 *  empty-groups failures degrade gracefully (returns []) so the populated
 *  list is never blocked by an empty-groups blip. */
export async function getMyGroups(): Promise<MyGroupsResult> {
  if (typeof window === 'undefined') return { polls: [], emptyGroups: [] };
  try {
    if (myGroupsInFlight) return myGroupsInFlight;

    myGroupsInFlight = (async () => {
      try {
        const [polls, emptyGroups] = await Promise.all([
          apiGetMyGroups(),
          apiGetMyEmptyGroups(),
        ]);
        emptyGroupsCache = emptyGroups;
        return { polls, emptyGroups };
      } finally {
        myGroupsInFlight = null;
      }
    })();

    return myGroupsInFlight;
  } catch (error) {
    console.error('Error in getMyGroups:', error);
    return { polls: [], emptyGroups: [] };
  }
}

/** Read the cached empty-groups list (last-fetched from `apiGetMyEmptyGroups`).
 *  Returns an empty array when no fetch has succeeded yet — callers should
 *  treat this as a best-effort optimistic view and re-fetch via
 *  `getMyGroups()` for the freshest data. */
export function getCachedEmptyGroups(): GroupSummary[] {
  return emptyGroupsCache ?? [];
}
