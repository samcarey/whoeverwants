import { invalidateAccessibleQuestions, invalidateQuestion } from '@/lib/questionCache';
import { addForgottenQuestionId, removeAccessibleQuestionId } from '@/lib/browserQuestionAccess';
import { apiLeaveGroup } from '@/lib/api';
import type { Group } from '@/lib/groupUtils';

// Forget every question in a group + drop server-side membership.
// Mirrors the per-question forget flow in the group page's pendingAction
// handler: after `forgetQuestion` for each question, fire `apiLeaveGroup`
// fire-and-forget so the group doesn't reappear via Phase C.3 membership
// visibility on the next /api/groups/mine call.
export function forgetGroup(group: Group): void {
  for (const question of group.questions) {
    forgetQuestion(question.id);
  }
  const routeId = group.groupId ?? group.rootPollId;
  if (routeId) void apiLeaveGroup(routeId);
}

// Function to completely forget a question from browser storage
export function forgetQuestion(questionId: string): void {
  if (typeof window === 'undefined' || !questionId) {
    return;
  }

  try {
    removeAccessibleQuestionId(questionId);

    const votedQuestions = JSON.parse(localStorage.getItem('votedQuestions') || '{}');
    delete votedQuestions[questionId];
    localStorage.setItem('votedQuestions', JSON.stringify(votedQuestions));

    const voteIds = JSON.parse(localStorage.getItem('questionVoteIds') || '{}');
    delete voteIds[questionId];
    localStorage.setItem('questionVoteIds', JSON.stringify(voteIds));

    const creatorSecrets = JSON.parse(localStorage.getItem('question_creator_secrets') || '[]');
    const filteredSecrets = creatorSecrets.filter((s: any) => s.questionId !== questionId);
    localStorage.setItem('question_creator_secrets', JSON.stringify(filteredSecrets));

    // Drop in-memory caches so subsequent navigations (e.g. back to the
    // containing group) don't rebuild views from stale data that still
    // includes this question. Forget is shape-changing — it removes the
    // question from the accessible list — so wipe the accessible-polls
    // cache too (the field-level invalidateQuestion alone leaves the
    // accessible list rebuilding with the dead entry until TTL).
    invalidateQuestion(questionId);
    invalidateAccessibleQuestions();

    // Mark as explicitly forgotten so relation discovery won't re-add it
    // when the server returns this question as a follow-up of its parent.
    addForgottenQuestionId(questionId);

    console.log(`Question ${questionId.substring(0, 8)}... forgotten from browser storage`);
  } catch (error) {
    console.error('Error forgetting question:', error);
  }
}

// Check if question has any data in browser storage
export function hasQuestionData(questionId: string): boolean {
  if (typeof window === 'undefined' || !questionId) {
    return false;
  }

  try {
    // Check accessible questions
    const accessibleQuestionIds = JSON.parse(localStorage.getItem('accessible_question_ids') || '[]');
    if (accessibleQuestionIds.includes(questionId)) return true;

    // Check voted questions
    const votedQuestions = JSON.parse(localStorage.getItem('votedQuestions') || '{}');
    if (votedQuestions[questionId]) return true;

    // Check vote IDs
    const voteIds = JSON.parse(localStorage.getItem('questionVoteIds') || '{}');
    if (voteIds[questionId]) return true;

    // Check creator secrets
    const creatorSecrets = JSON.parse(localStorage.getItem('question_creator_secrets') || '[]');
    if (creatorSecrets.some((s: any) => s.questionId === questionId)) return true;

    return false;
  } catch (error) {
    console.error('Error checking question data:', error);
    return false;
  }
}