// Snapshot builder for duplicate / follow-up create flows.
//
// The legacy per-question creator-secret storage that used to live here
// (and in the now-deleted lib/pollAccess.ts) is gone — migration 123 retired
// `creator_secret` entirely. Poll authorship is identity-based server-side
// (`creator_user_id` + the per-viewer `viewer_is_creator` flag). The
// orphaned localStorage keys are cleaned up once on module load below.

import type { Poll, Question } from '@/lib/types';

// Build a snapshot of question fields used for duplicate/follow-up forms.
// Centralized here to avoid drift when fields are added or renamed.
//
// Phase 5b: wrapper-level fields (response_deadline, creator_name) are
// sourced from the parent `Poll` since they no longer live on `Question`.
// `poll` is optional so callsites that build a snapshot for a question
// whose wrapper isn't loaded (e.g. an old localStorage entry) can still
// pass just the question — the resulting snapshot just omits the wrapper bits.
//
// Titles (and the is_auto_title flag) are intentionally NOT copied: the new
// form regenerates its title fresh from the new input fields, and a
// user-typed yes_no prompt should be retyped rather than carried verbatim.
export function buildQuestionSnapshot(question: Question, poll?: Poll | null) {
  return {
    question_type: question.question_type,
    options: question.options,
    response_deadline: poll?.response_deadline ?? null,
    creator_name: poll?.creator_name ?? null,
    auto_close_after: question.auto_close_after,
    details: question.details,
    category: question.category,
    category_icon: question.category_icon,
    winner_method: question.winner_method,
    options_metadata: question.options_metadata,
    // Migration 098: these fields live on the poll wrapper now.
    min_responses: poll?.min_responses ?? null,
    show_preliminary_results: poll?.show_preliminary_results ?? true,
    allow_pre_ranking: poll?.allow_pre_ranking ?? true,
  };
}

// One-time cleanup of orphaned localStorage keys from retired creator-secret
// plumbing, so they don't linger on existing installs.
if (typeof window !== 'undefined') {
  try {
    localStorage.removeItem('question_creator_data');
    localStorage.removeItem('question_access_data');
  } catch {
    // Best-effort; storage access can throw in locked-down contexts.
  }
}
