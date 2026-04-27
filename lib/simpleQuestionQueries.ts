// Simple question queries using browser storage for access control
// No fingerprinting, no complex RLS - just localStorage question lists

import type { Poll, Question } from '@/lib/types';
import { apiGetAccessibleQuestions, apiGetQuestionById } from '@/lib/api';
import { getAccessibleQuestionIds, addAccessibleQuestionId } from '@/lib/browserQuestionAccess';
import {
  cacheAccessiblePolls,
  getCachedAccessiblePolls,
  cacheQuestion,
} from '@/lib/questionCache';

// Coalesce concurrent getAccessiblePolls calls (e.g., StrictMode double-mount)
let inFlight: Promise<Poll[]> | null = null;

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
