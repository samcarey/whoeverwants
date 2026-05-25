// Browser storage for poll-ownership creator secrets + per-question
// "seen options" snapshots.
//
// The legacy per-browser "accessible question ids" + "forgotten question
// ids" lists (and their localStorage keys) have been REMOVED. Group
// visibility is now driven entirely by server-side `group_members`
// (the single source of truth); "forget a group" is "leave the group"
// (DELETE /api/groups/{routeId}/membership). Creator secrets are kept
// here purely as poll-ownership authorization (out of scope for the
// membership change).

const CREATOR_SECRETS_KEY = 'question_creator_secrets';

// One-time cleanup of the now-orphaned localStorage keys so they don't
// linger on existing installs. Runs once at module load (browser only).
const LEGACY_ACCESSIBLE_KEY = 'accessible_question_ids';
const LEGACY_FORGOTTEN_KEY = 'forgotten_question_ids';
if (typeof window !== 'undefined') {
  try {
    localStorage.removeItem(LEGACY_ACCESSIBLE_KEY);
    localStorage.removeItem(LEGACY_FORGOTTEN_KEY);
  } catch {
    // Best-effort; storage access can throw in locked-down contexts.
  }
}

interface CreatorSecret {
  questionId: string;
  secret: string;
  createdAt: string;
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

// Record question creation. Persists the creator secret (poll-ownership
// authorization) — visibility no longer needs any local bookkeeping
// since `group_members` is the single source of truth.
export function recordQuestionCreation(questionId: string, creatorSecret?: string): void {
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