// Utility functions for managing poll creator information in localStorage

const POLL_CREATOR_STORAGE_KEY = 'poll_creator_data';
const CLEANUP_INTERVAL_DAYS = 30; // Clean up polls older than 30 days

interface PollCreatorData {
  pollId: string;
  creatorSecret: string;
  createdAt: string;
}

// Generate a random creator secret
export function generateCreatorSecret(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// Store poll creation data in localStorage
export function storePollCreation(pollId: string, creatorSecret: string): void {
  if (typeof window === 'undefined') return; // SSR safety

  const existingData = getStoredPollData();
  const newData: PollCreatorData = {
    pollId,
    creatorSecret,
    createdAt: new Date().toISOString()
  };

  const updatedData = [...existingData, newData];
  localStorage.setItem(POLL_CREATOR_STORAGE_KEY, JSON.stringify(updatedData));
}

// Get stored poll data from localStorage
function getStoredPollData(): PollCreatorData[] {
  if (typeof window === 'undefined') return []; // SSR safety

  try {
    const stored = localStorage.getItem(POLL_CREATOR_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error('Error parsing stored poll data:', error);
    return [];
  }
}

// Check if a poll was created by this device
export function isCreatedByThisDevice(pollId: string): boolean {
  const pollData = getStoredPollData();
  return pollData.some(data => data.pollId === pollId);
}

// Get the creator secret for a poll created by this device
export function getPollCreatorSecret(pollId: string): string | null {
  const pollData = getStoredPollData();
  const found = pollData.find(data => data.pollId === pollId);
  return found ? found.creatorSecret : null;
}

// Clean up old poll data to prevent localStorage from growing indefinitely
export function cleanupOldPolls(): void {
  if (typeof window === 'undefined') return; // SSR safety

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - CLEANUP_INTERVAL_DAYS);

  const pollData = getStoredPollData();
  const filteredData = pollData.filter(data => {
    const createdDate = new Date(data.createdAt);
    return createdDate >= cutoffDate;
  });

  // Only update localStorage if we actually removed something
  if (filteredData.length !== pollData.length) {
    localStorage.setItem(POLL_CREATOR_STORAGE_KEY, JSON.stringify(filteredData));
    console.log(`Cleaned up ${pollData.length - filteredData.length} old poll records`);
  }
}

// Initialize cleanup on module load (only in browser)
if (typeof window !== 'undefined') {
  // Run cleanup immediately
  cleanupOldPolls();
  
  // Set up periodic cleanup (run once per day when the module is loaded)
  const lastCleanup = localStorage.getItem('last_poll_cleanup');
  const today = new Date().toDateString();
  
  if (lastCleanup !== today) {
    cleanupOldPolls();
    localStorage.setItem('last_poll_cleanup', today);
  }
}