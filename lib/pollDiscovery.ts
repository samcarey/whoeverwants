// Poll discovery utilities for follow-up functionality
import { getAccessiblePollIds, addAccessiblePollId } from '@/lib/browserPollAccess';

export interface DiscoveryResult {
  newPollIds: string[];
  totalDiscovered: number;
  originalCount: number;
}

/**
 * Discovers all related polls (follow-ups) for the current user's accessible polls
 * Returns any new poll IDs that weren't previously known
 */
export async function discoverRelatedPolls(): Promise<DiscoveryResult> {
  try {
    // Get currently accessible poll IDs from localStorage
    const currentPollIds = getAccessiblePollIds();
    
    if (currentPollIds.length === 0) {
      return {
        newPollIds: [],
        totalDiscovered: 0,
        originalCount: 0
      };
    }

    // Call the discovery API
    const response = await fetch('/api/polls/discover-related', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ pollIds: currentPollIds }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Failed to discover related polls:', errorData);
      throw new Error(`Discovery API error: ${response.status}`);
    }

    const result = await response.json();
    const { allRelatedIds, originalCount, discoveredCount } = result;

    // Find new poll IDs that weren't previously accessible
    const newPollIds = allRelatedIds.filter((id: string) => !currentPollIds.includes(id));

    // Add new poll IDs to browser storage
    newPollIds.forEach((pollId: string) => {
      addAccessiblePollId(pollId);
    });

    if (newPollIds.length > 0) {
      console.log(`🔗 Discovered ${newPollIds.length} new follow-up polls`);
    }

    return {
      newPollIds,
      totalDiscovered: discoveredCount,
      originalCount
    };

  } catch (error) {
    console.error('Error in poll discovery:', error);
    return {
      newPollIds: [],
      totalDiscovered: 0,
      originalCount: 0
    };
  }
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