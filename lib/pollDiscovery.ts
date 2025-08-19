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

    console.log(`🔍 Starting poll discovery for ${currentPollIds.length} accessible polls`);

    // Call the discovery API
    const response = await fetch('/api/polls/discover-related', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ pollIds: currentPollIds }),
    });

    if (!response.ok) {
      let errorData;
      try {
        errorData = await response.json();
      } catch (parseError) {
        errorData = { error: 'Failed to parse error response' };
      }
      
      console.warn('Poll discovery API failed:', {
        status: response.status,
        statusText: response.statusText,
        error: errorData
      });
      
      // Don't throw - just return empty results to gracefully degrade
      return {
        newPollIds: [],
        totalDiscovered: currentPollIds.length, // At least count the polls we already have
        originalCount: currentPollIds.length
      };
    }

    const result = await response.json();
    const { allRelatedIds, originalCount, discoveredCount } = result;

    if (!Array.isArray(allRelatedIds)) {
      console.warn('Poll discovery returned invalid data:', result);
      return {
        newPollIds: [],
        totalDiscovered: currentPollIds.length,
        originalCount: currentPollIds.length
      };
    }

    // Find new poll IDs that weren't previously accessible
    const newPollIds = allRelatedIds.filter((id: string) => !currentPollIds.includes(id));

    // Add new poll IDs to browser storage
    newPollIds.forEach((pollId: string) => {
      addAccessiblePollId(pollId);
    });

    if (newPollIds.length > 0) {
      console.log(`🔗 Discovered ${newPollIds.length} new related polls`);
    } else {
      console.log('📋 No new related polls found');
    }

    return {
      newPollIds,
      totalDiscovered: discoveredCount || allRelatedIds.length,
      originalCount: originalCount || currentPollIds.length
    };

  } catch (error) {
    console.warn('Poll discovery encountered an error but continuing gracefully:', error);
    
    // Always return a valid result even if discovery fails
    const currentPollIds = getAccessiblePollIds();
    return {
      newPollIds: [],
      totalDiscovered: currentPollIds.length,
      originalCount: currentPollIds.length
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