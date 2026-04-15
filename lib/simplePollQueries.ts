// Simple poll queries using browser storage for access control
// No fingerprinting, no complex RLS - just localStorage poll lists

import { Poll } from '@/lib/types';
import { apiGetAccessiblePolls, apiGetPollById } from '@/lib/api';
import { getAccessiblePollIds, addAccessiblePollId } from '@/lib/browserPollAccess';
import { cacheAccessiblePolls, getCachedAccessiblePolls, cachePoll } from '@/lib/pollCache';

// Coalesce concurrent getAccessiblePolls calls (e.g., StrictMode double-mount)
let inFlight: Promise<Poll[]> | null = null;

// Get polls this browser has access to
export async function getAccessiblePolls(): Promise<Poll[]> {
  try {
    const accessibleIds = getAccessiblePollIds();

    if (accessibleIds.length === 0) {
      return [];
    }

    // Return cached result if fresh and the ID list hasn't changed.
    // (A changed ID list means new polls were discovered and we need to re-fetch.)
    const cached = getCachedAccessiblePolls();
    if (cached) {
      const cachedIds = new Set(cached.map(p => p.id));
      const allPresent = accessibleIds.every(id => cachedIds.has(id));
      if (allPresent) return cached;
    }

    // Coalesce concurrent calls — React StrictMode double-mounts in dev
    if (inFlight) return inFlight;

    inFlight = (async () => {
      try {
        const polls = await apiGetAccessiblePolls(accessibleIds);
        cacheAccessiblePolls(polls);
        return polls;
      } finally {
        inFlight = null;
      }
    })();

    return inFlight;
  } catch (error) {
    console.error('Error in getAccessiblePolls:', error);
    return [];
  }
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
