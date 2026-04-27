// Simple poll queries using browser storage for access control
// No fingerprinting, no complex RLS - just localStorage poll lists

import type { Multipoll, Poll } from '@/lib/types';
import { apiGetAccessiblePolls, apiGetPollById } from '@/lib/api';
import { getAccessiblePollIds, addAccessiblePollId } from '@/lib/browserPollAccess';
import {
  cacheAccessibleMultipolls,
  getCachedAccessibleMultipolls,
  cachePoll,
} from '@/lib/pollCache';

// Coalesce concurrent getAccessibleMultipolls calls (e.g., StrictMode double-mount)
let inFlight: Promise<Multipoll[]> | null = null;

/** Get the multipoll wrappers this browser has access to. Phase 5b: returns
 *  Multipoll[] (the wrappers covering the user's accessible sub-polls).
 *  Wrapper-level fields live on each Multipoll; sub-polls inside contain the
 *  per-sub-poll fields. */
export async function getAccessibleMultipolls(): Promise<Multipoll[]> {
  try {
    const accessibleIds = getAccessiblePollIds();

    if (accessibleIds.length === 0) {
      return [];
    }

    // Return cached result if fresh and every accessible sub-poll id is
    // covered by some cached multipoll's sub_polls. A new id (e.g. just
    // discovered) means we need to re-fetch.
    const cached = getCachedAccessibleMultipolls();
    if (cached) {
      const cachedSubPollIds = new Set<string>();
      for (const mp of cached) for (const sp of mp.sub_polls) cachedSubPollIds.add(sp.id);
      const allPresent = accessibleIds.every(id => cachedSubPollIds.has(id));
      if (allPresent) return cached;
    }

    // Coalesce concurrent calls — React StrictMode double-mounts in dev
    if (inFlight) return inFlight;

    inFlight = (async () => {
      try {
        const multipolls = await apiGetAccessiblePolls(accessibleIds);
        cacheAccessibleMultipolls(multipolls);
        return multipolls;
      } finally {
        inFlight = null;
      }
    })();

    return inFlight;
  } catch (error) {
    console.error('Error in getAccessibleMultipolls:', error);
    return [];
  }
}

/** Backwards-compatible flat poll list. Most callsites should switch to
 *  `getAccessibleMultipolls` so they can read wrapper-level fields directly,
 *  but this helper is kept for the prefetcher / other places that just need
 *  every accessible Poll for a per-id loop. */
export async function getAccessiblePolls(): Promise<Poll[]> {
  const multipolls = await getAccessibleMultipolls();
  const polls: Poll[] = [];
  for (const mp of multipolls) for (const sp of mp.sub_polls) polls.push(sp);
  return polls;
}

// Get a specific poll by ID and grant access if found
export async function getPollWithAccess(pollId: string): Promise<Poll | null> {
  try {
    const data = await apiGetPollById(pollId);

    // Grant access to this poll by adding to browser storage
    addAccessiblePollId(data.id);
    cachePoll(data);

    return data;
  } catch (error) {
    console.log('Poll not found:', pollId);
    return null;
  }
}

// Record that this browser created a poll (grants full access)
export async function recordPollCreation(pollId: string): Promise<void> {
  try {
    // Add to accessible polls list
    addAccessiblePollId(pollId);
    console.log('Recorded poll creation for browser:', pollId.substring(0, 8) + '...');
  } catch (error) {
    console.error('Error recording poll creation:', error);
  }
}

// Check if a poll exists (without granting access)
export async function pollExists(pollId: string): Promise<boolean> {
  try {
    await apiGetPollById(pollId);
    return true;
  } catch (error) {
    return false;
  }
}
