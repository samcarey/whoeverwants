// Simple browser storage for question access tracking
// Stores list of question IDs that this browser has access to

const STORAGE_KEY = 'accessible_question_ids';
const CREATOR_SECRETS_KEY = 'question_creator_secrets';
const FORGOTTEN_KEY = 'forgotten_question_ids';

interface CreatorSecret {
  questionId: string;
  secret: string;
  createdAt: string;
}

// Get list of question IDs this browser can access
export function getAccessibleQuestionIds(): string[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return [];
    }

    const questionIds = JSON.parse(stored);
    return Array.isArray(questionIds) ? questionIds : [];
  } catch (error) {
    console.error('Error reading accessible question IDs:', error);
    return [];
  }
}

// Add a question ID to the accessible list. Callers should only use this for
// *explicit* access grants (visiting a question/thread URL, creating a question) —
// doing so clears any prior "forgotten" marker since the user is opting in.
// Automatic discovery must go through the forgotten-list-aware path in
// `discoverRelatedQuestions` instead.
export function addAccessibleQuestionId(questionId: string): void {
  if (typeof window === 'undefined' || !questionId) {
    return;
  }

  try {
    // Explicit re-access undoes a prior forget.
    removeForgottenQuestionId(questionId);

    const currentIds = getAccessibleQuestionIds();

    // Add if not already present
    if (!currentIds.includes(questionId)) {
      currentIds.push(questionId);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(currentIds));
      console.log('Added question access:', questionId.substring(0, 8) + '...');
    }
  } catch (error) {
    console.error('Error adding accessible question ID:', error);
  }
}

// Remove a question ID from the accessible list
export function removeAccessibleQuestionId(questionId: string): void {
  if (typeof window === 'undefined' || !questionId) {
    return;
  }

  try {
    const currentIds = getAccessibleQuestionIds();
    const filteredIds = currentIds.filter(id => id !== questionId);
    
    if (filteredIds.length !== currentIds.length) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(filteredIds));
      console.log('Removed question access:', questionId.substring(0, 8) + '...');
    }
  } catch (error) {
    console.error('Error removing accessible question ID:', error);
  }
}

// Clear all accessible question IDs
export function clearAccessibleQuestionIds(): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    localStorage.removeItem(STORAGE_KEY);
    console.log('Cleared all question access');
  } catch (error) {
    console.error('Error clearing accessible question IDs:', error);
  }
}

// Check if browser has access to a specific question
export function hasAccessToQuestion(questionId: string): boolean {
  const accessibleIds = getAccessibleQuestionIds();
  return accessibleIds.includes(questionId);
}

// Get count of accessible questions
export function getAccessibleQuestionCount(): number {
  return getAccessibleQuestionIds().length;
}

// Questions the user has explicitly forgotten. Kept separate from the accessible
// list so that automatic relation discovery (which walks follow_up chains on
// the server) can avoid re-adding them. Visiting a question URL directly clears
// the forgotten marker — direct URL visits always grant access.
export function getForgottenQuestionIds(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(FORGOTTEN_KEY);
    if (!stored) return [];
    const ids = JSON.parse(stored);
    return Array.isArray(ids) ? ids : [];
  } catch (error) {
    console.error('Error reading forgotten question IDs:', error);
    return [];
  }
}

export function addForgottenQuestionId(questionId: string): void {
  if (typeof window === 'undefined' || !questionId) return;
  try {
    const current = getForgottenQuestionIds();
    if (!current.includes(questionId)) {
      current.push(questionId);
      localStorage.setItem(FORGOTTEN_KEY, JSON.stringify(current));
    }
  } catch (error) {
    console.error('Error adding forgotten question ID:', error);
  }
}

export function removeForgottenQuestionId(questionId: string): void {
  if (typeof window === 'undefined' || !questionId) return;
  try {
    const current = getForgottenQuestionIds();
    const filtered = current.filter(id => id !== questionId);
    if (filtered.length !== current.length) {
      localStorage.setItem(FORGOTTEN_KEY, JSON.stringify(filtered));
    }
  } catch (error) {
    console.error('Error removing forgotten question ID:', error);
  }
}

// Generate a random creator secret
export function generateCreatorSecret(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// Store creator secret for a question
export function storeCreatorSecret(questionId: string, secret: string): void {
  if (typeof window === 'undefined' || !questionId || !secret) {
    return;
  }

  try {
    const existingSecrets = getCreatorSecrets();
    
    // Add new secret (replace if already exists)
    const filteredSecrets = existingSecrets.filter(s => s.questionId !== questionId);
    filteredSecrets.push({
      questionId,
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

// Get creator secret for a specific question
export function getCreatorSecret(questionId: string): string | null {
  const secrets = getCreatorSecrets();
  const found = secrets.find(s => s.questionId === questionId);
  return found ? found.secret : null;
}

// Check if this browser created a specific question
export function isCreatedByThisBrowser(questionId: string): boolean {
  return getCreatorSecret(questionId) !== null;
}

// Record question creation with creator secret
export function recordQuestionCreation(questionId: string, creatorSecret?: string): void {
  // Add to accessible questions
  addAccessibleQuestionId(questionId);
  
  // Store creator secret if provided
  if (creatorSecret) {
    storeCreatorSecret(questionId, creatorSecret);
  }
}

const SEEN_OPTIONS_KEY_PREFIX = 'question_seen_options_';

// Store options that were available when the user last voted on a suggestion question.
// Used to detect new suggestions added after the user ranked.
export function storeSeenQuestionOptions(questionId: string, options: string[]): void {
  if (typeof window === 'undefined' || !questionId) return;
  try {
    localStorage.setItem(SEEN_OPTIONS_KEY_PREFIX + questionId, JSON.stringify(options));
  } catch (e) {
    // Silently fail — this is a UX enhancement, not critical
  }
}

// Get the options that were available when the user last voted on a suggestion question.
// Returns [] if not stored (e.g., different device or cleared localStorage).
export function getSeenQuestionOptions(questionId: string): string[] {
  if (typeof window === 'undefined' || !questionId) return [];
  try {
    const stored = localStorage.getItem(SEEN_OPTIONS_KEY_PREFIX + questionId);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

// Debug function to log current accessible questions
export function debugAccessibleQuestions(): void {
  if (process.env.NODE_ENV !== 'development') {
    return;
  }

  const questionIds = getAccessibleQuestionIds();
  const secrets = getCreatorSecrets();
  
  console.log('Browser has access to', questionIds.length, 'questions:');
  questionIds.forEach(id => {
    const isCreator = secrets.some(s => s.questionId === id);
    console.log(`  - ${id.substring(0, 8)}... ${isCreator ? '(creator)' : '(viewer)'}`);
  });
}