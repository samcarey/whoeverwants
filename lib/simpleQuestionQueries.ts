// Simple question queries using browser storage for access control
// No fingerprinting, no complex RLS - just localStorage question lists

import type { GroupSummary, Poll, Question } from '@/lib/types';
import {
  apiGetAccessibleQuestions,
  apiGetMyEmptyGroups,
  apiGetMyGroups,
  apiGetQuestionById,
} from '@/lib/api';
import {
  addAccessibleQuestionId,
  getAccessibleQuestionIds,
  getForgottenQuestionIds,
} from '@/lib/browserQuestionAccess';
import {
  cacheAccessiblePolls,
  getCachedAccessiblePolls,
  cacheQuestion,
  invalidateAccessibleQuestions,
} from '@/lib/questionCache';

/** Combined response shape from `getMyGroups()` — polls + the
 *  membership-only empty groups (groups the user joined that don't
 *  have any polls yet). The home page merges both into one home list. */
export interface MyGroupsResult {
  polls: Poll[];
  emptyGroups: GroupSummary[];
}

// Coalesce concurrent getAccessiblePolls / getMyGroups calls
// (e.g., StrictMode double-mount).
let inFlight: Promise<Poll[]> | null = null;
let myGroupsInFlight: Promise<MyGroupsResult> | null = null;
let emptyGroupsCache: GroupSummary[] | null = null;

/** Get the poll wrappers this browser has access to. Phase 5b: returns
 *  Poll[] (the wrappers covering the user's accessible questions).
 *  Wrapper-level fields live on each Poll; questions inside contain the
 *  per-question fields. */
export async function getAccessiblePolls(): Promise<Poll[]> {
  try {
    const accessibleIds = getAccessibleQuestionIds();

    if (accessibleIds.length === 0) {
      return [];
    }

    // Return cached result if fresh and every accessible question id is
    // covered by some cached poll's questions. A new id (e.g. just
    // discovered) means we need to re-fetch.
    const cached = getCachedAccessiblePolls();
    if (cached) {
      const cachedQuestionIds = new Set<string>();
      for (const mp of cached) for (const sp of mp.questions) cachedQuestionIds.add(sp.id);
      const allPresent = accessibleIds.every(id => cachedQuestionIds.has(id));
      if (allPresent) return cached;
    }

    // Coalesce concurrent calls — React StrictMode double-mounts in dev
    if (inFlight) return inFlight;

    inFlight = (async () => {
      try {
        const polls = await apiGetAccessibleQuestions(accessibleIds);
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

/** Backwards-compatible flat question list. Most callsites should switch to
 *  `getAccessiblePolls` so they can read wrapper-level fields directly,
 *  but this helper is kept for the prefetcher / other places that just need
 *  every accessible Question for a per-id loop. */
export async function getAccessibleQuestions(): Promise<Question[]> {
  const polls = await getAccessiblePolls();
  const questions: Question[] = [];
  for (const mp of polls) for (const sp of mp.questions) questions.push(sp);
  return questions;
}

/** Phase B.3: drop-in replacement for `getAccessiblePolls() +
 *  discoverRelatedQuestions()`. Returns every poll in any group that
 *  contains one of this browser's accessible questions — the server walks
 *  `polls.group_id` once instead of the FE doing follow_up_to chain
 *  expansion across two round-trips.
 *
 *  Also fetches membership-only "empty groups" (groups the user joined
 *  via the home new group button with no polls yet) in parallel via
 *  `apiGetMyEmptyGroups` so the home list reflects both populated and
 *  empty groups in one render.
 *
 *  Side-effect: any newly-discovered question_ids are added to the browser's
 *  accessible list (subject to the forgotten-list filter) so they survive a
 *  cache flush. The cache is then cleared so the next call sees the
 *  expanded set in subsequent freshness checks.
 */
export async function getMyGroups(): Promise<MyGroupsResult> {
  if (typeof window === 'undefined') return { polls: [], emptyGroups: [] };
  try {
    const accessibleIds = getAccessibleQuestionIds();
    const cached = getCachedAccessiblePolls();
    let canUseCachedPolls = false;
    if (cached) {
      const cachedQuestionIds = new Set<string>();
      for (const mp of cached) for (const sp of mp.questions) cachedQuestionIds.add(sp.id);
      canUseCachedPolls = accessibleIds.every(id => cachedQuestionIds.has(id));
    }

    if (myGroupsInFlight) return myGroupsInFlight;

    myGroupsInFlight = (async () => {
      try {
        // Fire both in parallel. Empty-groups failures degrade gracefully
        // (returns []), so the populated list is never blocked by an
        // empty-groups blip.
        const [polls, emptyGroups] = await Promise.all([
          canUseCachedPolls
            ? Promise.resolve(cached!)
            : (accessibleIds.length === 0
                ? Promise.resolve<Poll[]>([])
                : apiGetMyGroups(accessibleIds)),
          apiGetMyEmptyGroups(),
        ]);
        if (!canUseCachedPolls) {
          const forgotten = new Set(getForgottenQuestionIds());
          const knownIds = new Set(accessibleIds);
          let discovered = 0;
          for (const mp of polls) {
            for (const sp of mp.questions) {
              if (!knownIds.has(sp.id) && !forgotten.has(sp.id)) {
                addAccessibleQuestionId(sp.id);
                discovered++;
              }
            }
          }
          if (discovered > 0) {
            // The accessible list grew — invalidate so subsequent freshness
            // checks see the expanded set.
            invalidateAccessibleQuestions();
          }
          cacheAccessiblePolls(polls);
        }
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

// Get a specific question by ID and grant access if found
export async function getQuestionWithAccess(questionId: string): Promise<Question | null> {
  try {
    const data = await apiGetQuestionById(questionId);

    // Grant access to this question by adding to browser storage
    addAccessibleQuestionId(data.id);
    cacheQuestion(data);

    return data;
  } catch (error) {
    console.log('Question not found:', questionId);
    return null;
  }
}

// Record that this browser created a question (grants full access)
export async function recordQuestionCreation(questionId: string): Promise<void> {
  try {
    // Add to accessible questions list
    addAccessibleQuestionId(questionId);
    console.log('Recorded question creation for browser:', questionId.substring(0, 8) + '...');
  } catch (error) {
    console.error('Error recording question creation:', error);
  }
}

// Check if a question exists (without granting access)
export async function questionExists(questionId: string): Promise<boolean> {
  try {
    await apiGetQuestionById(questionId);
    return true;
  } catch (error) {
    return false;
  }
}
