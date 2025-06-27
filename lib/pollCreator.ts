// Poll creator authentication utilities
// Manages local storage of creator secrets for polls created by this device

const STORAGE_KEY = 'whoeverwants_created_polls';

interface CreatedPoll {
  pollId: string;
  creatorSecret: string;
  createdAt: string;
  title: string;
}

// Store a poll as created by this device
export function storePollCreation(pollId: string, creatorSecret: string, title: string): void {
  if (typeof window === 'undefined') return; // SSR guard
  
  try {
    const existing = getCreatedPolls();
    const newPoll: CreatedPoll = {
      pollId,
      creatorSecret,
      createdAt: new Date().toISOString(),
      title
    };
    
    const updated = [...existing.filter(p => p.pollId !== pollId), newPoll];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (error) {
    console.error('Failed to store poll creation:', error);
  }
}

// Get all polls created by this device
export function getCreatedPolls(): CreatedPoll[] {
  if (typeof window === 'undefined') return []; // SSR guard
  
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error('Failed to retrieve created polls:', error);
    return [];
  }
}

// Check if this device created a specific poll and get the secret
export function getPollCreatorSecret(pollId: string): string | null {
  const createdPolls = getCreatedPolls();
  const poll = createdPolls.find(p => p.pollId === pollId);
  return poll?.creatorSecret || null;
}

// Check if this device created a specific poll
export function isCreatedByThisDevice(pollId: string): boolean {
  return getPollCreatorSecret(pollId) !== null;
}

// Clean up old poll records (optional - keep last 50 polls)
export function cleanupOldPolls(): void {
  if (typeof window === 'undefined') return;
  
  try {
    const polls = getCreatedPolls();
    if (polls.length > 50) {
      // Sort by creation date and keep the 50 most recent
      const sorted = polls.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      const recent = sorted.slice(0, 50);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(recent));
    }
  } catch (error) {
    console.error('Failed to cleanup old polls:', error);
  }
}

// Generate a secure random string for creator secrets
export function generateCreatorSecret(): string {
  // Use crypto.randomUUID if available, otherwise fallback to a secure alternative
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  
  // Fallback for environments without crypto.randomUUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}