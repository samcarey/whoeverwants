// Browser storage for per-question "seen options" snapshots.
//
// Poll-ownership authorization is no longer stored here. Migration 123
// retired the per-browser `creator_secret`; poll authorship is purely
// identity-based server-side (every poll records `creator_user_id`,
// auto-minting a lightweight account for anonymous creators). Whether the
// current viewer is the creator is computed server-side per response and
// surfaced as `poll.viewer_is_creator`.
//
// Group visibility is likewise driven entirely by server-side
// `group_members` (the single source of truth); "forget a group" is "leave
// the group" (DELETE /api/groups/{routeId}/membership).

// One-time cleanup of now-orphaned localStorage keys so they don't linger
// on existing installs. Runs once at module load (browser only).
const ORPHANED_KEYS = [
  'accessible_question_ids',
  'forgotten_question_ids',
  'question_creator_secrets', // retired with creator_secret (migration 123)
];
if (typeof window !== 'undefined') {
  try {
    for (const key of ORPHANED_KEYS) localStorage.removeItem(key);
  } catch {
    // Best-effort; storage access can throw in locked-down contexts.
  }
}

// Is the current viewer the creator of this poll? Server-authoritative
// (migration 123): the server computes this per response by matching the
// caller's resolved user_id — bearer session OR the account linked to their
// browser_id — against the poll's `creator_user_id`. The FE just reads the
// flag, so it works identically for signed-in and anonymous-with-account
// viewers without the FE knowing its own user_id.
export function isPollCreatedByViewer(
  poll: { viewer_is_creator?: boolean | null } | null | undefined,
): boolean {
  return poll?.viewer_is_creator === true;
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