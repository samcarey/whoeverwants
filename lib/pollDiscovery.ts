// Question discovery utilities for follow-up functionality
import { getAccessibleQuestionIds, addAccessibleQuestionId, getForgottenQuestionIds } from '@/lib/browserQuestionAccess';
import { apiGetRelatedQuestions } from '@/lib/api';
import { invalidateAccessibleQuestions } from '@/lib/questionCache';

export interface DiscoveryResult {
  newQuestionIds: string[];
  totalDiscovered: number;
  originalCount: number;
}

// Avoid redundant discovery calls across page navigations within the session.
// Discovery is only useful when new questions might exist; running it once per
// minute is plenty. Keyed by the sorted ID list so a changed list triggers
// a fresh discovery.
const DISCOVERY_TTL_MS = 60_000;
let lastDiscovery: { idsKey: string; at: number; result: DiscoveryResult } | null = null;
let inFlight: Promise<DiscoveryResult> | null = null;

/**
 * Discovers all related questions (follow-ups) for the current user's accessible questions
 * Returns any new question IDs that weren't previously known
 */
export async function discoverRelatedQuestions(): Promise<DiscoveryResult> {
  const currentQuestionIds = getAccessibleQuestionIds();

  if (currentQuestionIds.length === 0) {
    return {
      newQuestionIds: [],
      totalDiscovered: 0,
      originalCount: 0
    };
  }

  const idsKey = [...currentQuestionIds].sort().join(',');

  // Return cached result if fresh and the ID list hasn't changed
  if (lastDiscovery && lastDiscovery.idsKey === idsKey && Date.now() - lastDiscovery.at < DISCOVERY_TTL_MS) {
    return lastDiscovery.result;
  }

  // Coalesce concurrent calls (e.g., StrictMode double-mount) into one API call
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      console.log(`🔍 Starting question discovery for ${currentQuestionIds.length} accessible questions`);

      const result = await apiGetRelatedQuestions(currentQuestionIds);
      const { allRelatedIds, originalCount, discoveredCount } = result;

      if (!Array.isArray(allRelatedIds)) {
        console.warn('Question discovery returned invalid data:', result);
        return {
          newQuestionIds: [],
          totalDiscovered: currentQuestionIds.length,
          originalCount: currentQuestionIds.length
        };
      }

      // Skip anything the user has explicitly forgotten — otherwise the
      // server's follow_up walk would un-forget questions on the next navigation.
      const forgottenIds = new Set(getForgottenQuestionIds());
      const newQuestionIds = allRelatedIds.filter(
        (id: string) => !currentQuestionIds.includes(id) && !forgottenIds.has(id)
      );

      newQuestionIds.forEach((questionId: string) => {
        addAccessibleQuestionId(questionId);
      });

      if (newQuestionIds.length > 0) {
        invalidateAccessibleQuestions();
        console.log(`🔗 Discovered ${newQuestionIds.length} new related questions`);
      } else {
        console.log('📋 No new related questions found');
      }

      const discoveryResult: DiscoveryResult = {
        newQuestionIds,
        totalDiscovered: discoveredCount || allRelatedIds.length,
        originalCount: originalCount || currentQuestionIds.length
      };

      lastDiscovery = { idsKey, at: Date.now(), result: discoveryResult };
      return discoveryResult;
    } catch (error) {
      console.warn('Question discovery encountered an error but continuing gracefully:', error);
      return {
        newQuestionIds: [],
        totalDiscovered: currentQuestionIds.length,
        originalCount: currentQuestionIds.length
      };
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/**
 * Check if question discovery should be triggered
 * This helps avoid unnecessary API calls
 */
export function shouldTriggerDiscovery(): boolean {
  // Only trigger discovery if we have accessible questions
  const currentQuestionIds = getAccessibleQuestionIds();
  return currentQuestionIds.length > 0;
}

/**
 * Trigger question discovery and return whether new questions were found
 * This is a convenience function for components that need to refresh after discovery
 */
export async function triggerDiscoveryIfNeeded(): Promise<boolean> {
  if (!shouldTriggerDiscovery()) {
    return false;
  }

  const result = await discoverRelatedQuestions();
  return result.newQuestionIds.length > 0;
}
