// Simple browser storage for poll access tracking
// Stores list of poll IDs that this browser has access to

const STORAGE_KEY = 'accessible_poll_ids';
const CREATOR_SECRETS_KEY = 'poll_creator_secrets';

interface CreatorSecret {
  pollId: string;
  secret: string;
  createdAt: string;
}

// Get list of poll IDs this browser can access
export function getAccessiblePollIds(): string[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return [];
    }

    const pollIds = JSON.parse(stored);
    return Array.isArray(pollIds) ? pollIds : [];
  } catch (error) {
    console.error('Error reading accessible poll IDs:', error);
    return [];
  }
}

// Add a poll ID to the accessible list
export function addAccessiblePollId(pollId: string): void {
  if (typeof window === 'undefined' || !pollId) {
    return;
  }

  try {
    const currentIds = getAccessiblePollIds();
    
    // Add if not already present
    if (!currentIds.includes(pollId)) {
      currentIds.push(pollId);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(currentIds));
      console.log('Added poll access:', pollId.substring(0, 8) + '...');
    }
  } catch (error) {
    console.error('Error adding accessible poll ID:', error);
  }
}

// Remove a poll ID from the accessible list
export function removeAccessiblePollId(pollId: string): void {
  if (typeof window === 'undefined' || !pollId) {
    return;
  }

  try {
    const currentIds = getAccessiblePollIds();
    const filteredIds = currentIds.filter(id => id !== pollId);
    
    if (filteredIds.length !== currentIds.length) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(filteredIds));
      console.log('Removed poll access:', pollId.substring(0, 8) + '...');
    }
  } catch (error) {
    console.error('Error removing accessible poll ID:', error);
  }
}

// Clear all accessible poll IDs
export function clearAccessiblePollIds(): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    localStorage.removeItem(STORAGE_KEY);
    console.log('Cleared all poll access');
  } catch (error) {
    console.error('Error clearing accessible poll IDs:', error);
  }
}

// Check if browser has access to a specific poll
export function hasAccessToPoll(pollId: string): boolean {
  const accessibleIds = getAccessiblePollIds();
  return accessibleIds.includes(pollId);
}

// Get count of accessible polls
export function getAccessiblePollCount(): number {
  return getAccessiblePollIds().length;
}

// Generate a random creator secret
export function generateCreatorSecret(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// Store creator secret for a poll
export function storeCreatorSecret(pollId: string, secret: string): void {
  if (typeof window === 'undefined' || !pollId || !secret) {
    return;
  }

  try {
    const existingSecrets = getCreatorSecrets();
    
    // Add new secret (replace if already exists)
    const filteredSecrets = existingSecrets.filter(s => s.pollId !== pollId);
    filteredSecrets.push({
      pollId,
      secret,
      createdAt: new Date().toISOString()
    });
    
    localStorage.setItem(CREATOR_SECRETS_KEY, JSON.stringify(filteredSecrets));
  } catch (error) {
    console.error('Error storing creator secret:', error);
  }
}

// Get stored creator secrets
function getCreatorSecrets(): CreatorSecret[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const stored = localStorage.getItem(CREATOR_SECRETS_KEY);
    if (!stored) {
      return [];
    }

    const secrets = JSON.parse(stored);
    return Array.isArray(secrets) ? secrets : [];
  } catch (error) {
    console.error('Error reading creator secrets:', error);
    return [];
  }
}

// Get creator secret for a specific poll
export function getCreatorSecret(pollId: string): string | null {
  const secrets = getCreatorSecrets();
  const found = secrets.find(s => s.pollId === pollId);
  return found ? found.secret : null;
}

// Check if this browser created a specific poll
export function isCreatedByThisBrowser(pollId: string): boolean {
  return getCreatorSecret(pollId) !== null;
}

// Record poll creation with creator secret
export function recordPollCreation(pollId: string, creatorSecret?: string): void {
  // Add to accessible polls
  addAccessiblePollId(pollId);
  
  // Store creator secret if provided
  if (creatorSecret) {
    storeCreatorSecret(pollId, creatorSecret);
  }
}

// Debug function to log current accessible polls
export function debugAccessiblePolls(): void {
  if (process.env.NODE_ENV !== 'development') {
    return;
  }

  const pollIds = getAccessiblePollIds();
  const secrets = getCreatorSecrets();
  
  console.log('Browser has access to', pollIds.length, 'polls:');
  pollIds.forEach(id => {
    const isCreator = secrets.some(s => s.pollId === id);
    console.log(`  - ${id.substring(0, 8)}... ${isCreator ? '(creator)' : '(viewer)'}`);
  });
}