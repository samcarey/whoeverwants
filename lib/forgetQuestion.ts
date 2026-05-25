import { invalidateAccessibleQuestions, invalidateQuestion } from '@/lib/questionCache';
import { apiLeaveGroup } from '@/lib/api';
import type { Group } from '@/lib/groupUtils';

// "Forget a group" is now "leave the group": drop the server-side
// `group_members` row (the single source of truth for visibility) and
// clear local voted-state + creator secrets + in-memory caches for the
// group's questions. The group disappears from home on the next
// /api/groups/mine call because the membership row is gone.
export function forgetGroup(group: Group): void {
  for (const question of group.questions) {
    forgetQuestion(question.id);
  }
  const routeId = group.groupId ?? group.rootPollId;
  if (routeId) void apiLeaveGroup(routeId);
}

// Clear a single question's local browser state: voted/abstained flags,
// stored vote id, creator secret, and in-memory caches. Does NOT touch
// any access list — group membership is server-authoritative now, so
// removing the localStorage row would have no effect on visibility.
export function forgetQuestion(questionId: string): void {
  if (typeof window === 'undefined' || !questionId) {
    return;
  }

  try {
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
    // includes this question. The accessible-polls cache is shape-derived
    // from the server's membership response, so invalidate it too — the
    // next fetch reflects the (now-left) group.
    invalidateQuestion(questionId);
    invalidateAccessibleQuestions();

    console.log(`Question ${questionId.substring(0, 8)}... forgotten from browser storage`);
  } catch (error) {
    console.error('Error forgetting question:', error);
  }
}

// Check if question has any local browser state (voted flag, vote id, or
// creator secret). Used to decide whether a "forget" affordance is worth
// showing. No longer consults any access list.
export function hasQuestionData(questionId: string): boolean {
  if (typeof window === 'undefined' || !questionId) {
    return false;
  }

  try {
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