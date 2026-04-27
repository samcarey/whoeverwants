/** Parse votedQuestions from localStorage into voted and abstained sets. */
export function loadVotedQuestions(): { votedQuestionIds: Set<string>; abstainedQuestionIds: Set<string> } {
  const voted = new Set<string>();
  const abstained = new Set<string>();
  try {
    const votedQuestions = JSON.parse(localStorage.getItem('votedQuestions') || '{}');
    Object.keys(votedQuestions).forEach(id => {
      if (votedQuestions[id] === 'abstained') abstained.add(id);
      else if (votedQuestions[id] === true) voted.add(id);
    });
  } catch (error) {
    console.error('Error loading voted questions:', error);
  }
  return { votedQuestionIds: voted, abstainedQuestionIds: abstained };
}

/** Returns true if this browser's localStorage has any record of voting
 *  (yes/no/ranked) or abstaining on the given question. */
export function hasVotedOnQuestion(questionId: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const votedQuestions = JSON.parse(localStorage.getItem('votedQuestions') || '{}');
    return votedQuestions[questionId] === true || votedQuestions[questionId] === 'abstained';
  } catch (error) {
    console.error('Error checking vote status:', error);
    return false;
  }
}

/** Set the votedQuestions flag for a single question (true = voted, 'abstained',
 *  or null to remove). Safe to call server-side — no-ops without window. */
export function setVotedQuestionFlag(questionId: string, state: true | 'abstained' | null): void {
  if (typeof window === 'undefined') return;
  try {
    const votedQuestions = JSON.parse(localStorage.getItem('votedQuestions') || '{}');
    if (state === null) delete votedQuestions[questionId];
    else votedQuestions[questionId] = state;
    localStorage.setItem('votedQuestions', JSON.stringify(votedQuestions));
  } catch (error) {
    console.error('Error updating voted questions:', error);
  }
}

/** Get the stored voteId for a question from localStorage.questionVoteIds, or null. */
export function getStoredVoteId(questionId: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const ids = JSON.parse(localStorage.getItem('questionVoteIds') || '{}');
    return ids[questionId] || null;
  } catch {
    return null;
  }
}

/** Store the voteId for a question in localStorage.questionVoteIds. */
export function setStoredVoteId(questionId: string, voteId: string): void {
  if (typeof window === 'undefined') return;
  try {
    const ids = JSON.parse(localStorage.getItem('questionVoteIds') || '{}');
    ids[questionId] = voteId;
    localStorage.setItem('questionVoteIds', JSON.stringify(ids));
  } catch (error) {
    console.error('Error storing vote id:', error);
  }
}

/** Parse a yes/no vote record into a single choice tag. */
export function parseYesNoChoice(vote: { is_abstain?: boolean | null; yes_no_choice?: string | null } | null | undefined): 'yes' | 'no' | 'abstain' | null {
  if (!vote) return null;
  if (vote.is_abstain) return 'abstain';
  if (vote.yes_no_choice === 'yes') return 'yes';
  if (vote.yes_no_choice === 'no') return 'no';
  return null;
}
