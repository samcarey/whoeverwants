// Enhanced poll access management with database-level security
// Replaces and extends lib/pollCreator.ts functionality

const POLL_ACCESS_STORAGE_KEY = 'poll_access_data';
const LEGACY_CREATOR_STORAGE_KEY = 'poll_creator_data';
const CLEANUP_INTERVAL_DAYS = 30;

interface PollAccessData {
  pollId: string;
  accessType: 'creator' | 'viewer';
  creatorSecret?: string; // Only for creator type
  createdAt: string;
  lastAccessed: string;
}

interface LegacyPollCreatorData {
  pollId: string;
  creatorSecret: string;
  createdAt: string;
}

// Add poll access for current user
export function addPollAccess(
  pollId: string, 
  accessType: 'creator' | 'viewer', 
  creatorSecret?: string
): void {
  if (typeof window === 'undefined') return; // SSR safety

  const existingData = getStoredPollAccessData();
  
  // Check if access already exists
  const existingIndex = existingData.findIndex(data => data.pollId === pollId);
  
  if (existingIndex >= 0) {
    // Update existing record
    existingData[existingIndex] = {
      ...existingData[existingIndex],
      lastAccessed: new Date().toISOString(),
      // Upgrade viewer to creator if applicable
      accessType: existingData[existingIndex].accessType === 'creator' ? 'creator' : accessType,
      creatorSecret: creatorSecret || existingData[existingIndex].creatorSecret
    };
  } else {
    // Add new record
    const newData: PollAccessData = {
      pollId,
      accessType,
      creatorSecret,
      createdAt: new Date().toISOString(),
      lastAccessed: new Date().toISOString()
    };
    existingData.push(newData);
  }

  localStorage.setItem(POLL_ACCESS_STORAGE_KEY, JSON.stringify(existingData));
}

// Get list of all accessible poll IDs
export function getPollAccessList(): string[] {
  const pollData = getStoredPollAccessData();
  return pollData.map(data => data.pollId);
}

// Check if user has access to specific poll
export function hasPollAccess(pollId: string): boolean {
  const pollData = getStoredPollAccessData();
  return pollData.some(data => data.pollId === pollId);
}

// Backward compatibility: Check if poll was created by this device
export function isCreatedByThisDevice(pollId: string): boolean {
  const pollData = getStoredPollAccessData();
  return pollData.some(data => data.pollId === pollId && data.accessType === 'creator');
}

// Backward compatibility: Get creator secret for poll
export function getPollCreatorSecret(pollId: string): string | null {
  const pollData = getStoredPollAccessData();
  const found = pollData.find(data => data.pollId === pollId && data.accessType === 'creator');
  return found?.creatorSecret || null;
}

// Get stored poll access data with automatic migration
function getStoredPollAccessData(): PollAccessData[] {
  if (typeof window === 'undefined') return []; // SSR safety

  try {
    // Try to get new format data
    const stored = localStorage.getItem(POLL_ACCESS_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }

    // If new format doesn't exist, try to migrate from legacy format
    return migrateLegacyCreatorData();
  } catch (error) {
    console.error('Error parsing stored poll access data:', error);
    return [];
  }
}

// Migrate from legacy poll_creator_data format
export function migrateLegacyCreatorData(): PollAccessData[] {
  if (typeof window === 'undefined') return []; // SSR safety

  try {
    const legacyData = localStorage.getItem(LEGACY_CREATOR_STORAGE_KEY);
    if (!legacyData) {
      return [];
    }

    const legacyRecords: LegacyPollCreatorData[] = JSON.parse(legacyData);
    const migratedData: PollAccessData[] = legacyRecords.map(legacy => ({
      pollId: legacy.pollId,
      accessType: 'creator' as const,
      creatorSecret: legacy.creatorSecret,
      createdAt: legacy.createdAt,
      lastAccessed: legacy.createdAt
    }));

    // Save migrated data in new format
    localStorage.setItem(POLL_ACCESS_STORAGE_KEY, JSON.stringify(migratedData));

    console.log(`Migrated ${legacyRecords.length} legacy poll creator records`);
    return migratedData;
  } catch (error) {
    console.error('Error migrating legacy poll creator data:', error);
    return [];
  }
}

// Clean up old poll access data to prevent localStorage from growing indefinitely
export function cleanupOldPollAccess(): void {
  if (typeof window === 'undefined') return; // SSR safety

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - CLEANUP_INTERVAL_DAYS);

  const pollData = getStoredPollAccessData();
  const filteredData = pollData.filter(data => {
    const lastAccessDate = new Date(data.lastAccessed);
    return lastAccessDate >= cutoffDate;
  });

  // Only update localStorage if we actually removed something
  if (filteredData.length !== pollData.length) {
    localStorage.setItem(POLL_ACCESS_STORAGE_KEY, JSON.stringify(filteredData));
    console.log(`Cleaned up ${pollData.length - filteredData.length} old poll access records`);
  }
}

// Get access statistics for monitoring
export function getPollAccessStats(): {
  totalPolls: number;
  createdPolls: number;
  viewedPolls: number;
  oldestAccess: string | null;
  newestAccess: string | null;
} {
  const pollData = getStoredPollAccessData();
  
  const createdPolls = pollData.filter(data => data.accessType === 'creator').length;
  const viewedPolls = pollData.filter(data => data.accessType === 'viewer').length;
  
  const sortedByAccess = pollData.sort((a, b) => 
    new Date(a.lastAccessed).getTime() - new Date(b.lastAccessed).getTime()
  );

  return {
    totalPolls: pollData.length,
    createdPolls,
    viewedPolls,
    oldestAccess: sortedByAccess[0]?.lastAccessed || null,
    newestAccess: sortedByAccess[sortedByAccess.length - 1]?.lastAccessed || null
  };
}

// Initialize migration and cleanup on module load (browser only)
if (typeof window !== 'undefined') {
  // Run migration immediately
  migrateLegacyCreatorData();
  
  // Run cleanup immediately
  cleanupOldPollAccess();
  
  // Set up periodic cleanup (run once per day when the module is loaded)
  const lastCleanup = localStorage.getItem('last_poll_access_cleanup');
  const today = new Date().toDateString();
  
  if (lastCleanup !== today) {
    cleanupOldPollAccess();
    localStorage.setItem('last_poll_access_cleanup', today);
  }
}