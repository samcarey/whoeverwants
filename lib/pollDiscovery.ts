// Poll discovery utilities for follow-up functionality
import { getAccessiblePollIds, addAccessiblePollId, getForgottenPollIds } from '@/lib/browserPollAccess';
import { apiGetRelatedPolls } from '@/lib/api';
import { invalidateAccessiblePolls } from '@/lib/pollCache';

export interface DiscoveryResult {
  newPollIds: string[];
  totalDiscovered: number;
  originalCount: number;
}

// Avoid redundant discovery calls across page navigations within the session.
// Discovery is only useful when new polls might exist; running it once per
// minute is plenty. Keyed by the sorted ID list so a changed list triggers
// a fresh discovery.
const DISCOVERY_TTL_MS = 60_000;
let lastDiscovery: { idsKey: string; at: number; result: DiscoveryResult } | null = null;
let inFlight: Promise<DiscoveryResult> | null = null;

/**
 * Discovers all related polls (follow-ups) for the current user's accessible polls
 * Returns any new poll IDs that weren't previously known
 */
export async function discoverRelatedPolls(): Promise<DiscoveryResult> {
  const currentPollIds = getAccessiblePollIds();

  if (currentPollIds.length === 0) {
    return {
      newPollIds: [],
      totalDiscovered: 0,
      originalCount: 0
    };
  }

  const idsKey = [...currentPollIds].sort().join(',');

  // Return cached result if fresh and the ID list hasn't changed
  if (lastDiscovery && lastDiscovery.idsKey === idsKey && Date.now() - lastDiscovery.at < DISCOVERY_TTL_MS) {
    return lastDiscovery.result;
  }

  // Coalesce concurrent calls (e.g., StrictMode double-mount) into one API call
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      console.log(`🔍 Starting poll discovery for ${currentPollIds.length} accessible polls`);

      const result = await apiGetRelatedPolls(currentPollIds);
      const { allRelatedIds, originalCount, discoveredCount } = result;

      if (!Array.isArray(allRelatedIds)) {
        console.warn('Poll discovery returned invalid data:', result);
        return {
          newPollIds: [],
          totalDiscovered: currentPollIds.length,
          originalCount: currentPollIds.length
        };
      }

      // Skip anything the user has explicitly forgotten — otherwise the
      // server's follow_up walk would un-forget polls on the next navigation.
      const forgottenIds = new Set(getForgottenPollIds());
      const newPollIds = allRelatedIds.filter(
        (id: string) => !currentPollIds.includes(id) && !forgottenIds.has(id)
      );

      newPollIds.forEach((pollId: string) => {
        addAccessiblePollId(pollId);
      });

      if (newPollIds.length > 0) {
        invalidateAccessiblePolls();
        console.log(`🔗 Discovered ${newPollIds.length} new related polls`);
      } else {
        console.log('📋 No new related polls found');
      }

      const discoveryResult: DiscoveryResult = {
        newPollIds,
        totalDiscovered: discoveredCount || allRelatedIds.length,
        originalCount: originalCount || currentPollIds.length
      };

      lastDiscovery = { idsKey, at: Date.now(), result: discoveryResult };
      return discoveryResult;
    } catch (error) {
      console.warn('Poll discovery encountered an error but continuing gracefully:', error);
      return {
        newPollIds: [],
        totalDiscovered: currentPollIds.length,
        originalCount: currentPollIds.length
      };
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/**
 * Check if poll discovery should be triggered
 * This helps avoid unnecessary API calls
 */
export function shouldTriggerDiscovery(): boolean {
  // Only trigger discovery if we have accessible polls
  const currentPollIds = getAccessiblePollIds();
  return currentPollIds.length > 0;
}

/**
 * Trigger poll discovery and return whether new polls were found
 * This is a convenience function for components that need to refresh after discovery
 */
export async function triggerDiscoveryIfNeeded(): Promise<boolean> {
  if (!shouldTriggerDiscovery()) {
    return false;
  }

  const result = await discoverRelatedPolls();
  return result.newPollIds.length > 0;
}
