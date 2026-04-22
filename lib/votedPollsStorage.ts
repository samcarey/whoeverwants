/** Parse votedPolls from localStorage into voted and abstained sets. */
export function loadVotedPolls(): { votedPollIds: Set<string>; abstainedPollIds: Set<string> } {
  const voted = new Set<string>();
  const abstained = new Set<string>();
  try {
    const votedPolls = JSON.parse(localStorage.getItem('votedPolls') || '{}');
    Object.keys(votedPolls).forEach(id => {
      if (votedPolls[id] === 'abstained') abstained.add(id);
      else if (votedPolls[id] === true) voted.add(id);
    });
  } catch (error) {
    console.error('Error loading voted polls:', error);
  }
  return { votedPollIds: voted, abstainedPollIds: abstained };
}

/** Set the votedPolls flag for a single poll (true = voted, 'abstained',
 *  or null to remove). Safe to call server-side — no-ops without window. */
export function setVotedPollFlag(pollId: string, state: true | 'abstained' | null): void {
  if (typeof window === 'undefined') return;
  try {
    const votedPolls = JSON.parse(localStorage.getItem('votedPolls') || '{}');
    if (state === null) delete votedPolls[pollId];
    else votedPolls[pollId] = state;
    localStorage.setItem('votedPolls', JSON.stringify(votedPolls));
  } catch (error) {
    console.error('Error updating voted polls:', error);
  }
}

/** Get the stored voteId for a poll from localStorage.pollVoteIds, or null. */
export function getStoredVoteId(pollId: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const ids = JSON.parse(localStorage.getItem('pollVoteIds') || '{}');
    return ids[pollId] || null;
  } catch {
    return null;
  }
}

/** Store the voteId for a poll in localStorage.pollVoteIds. */
export function setStoredVoteId(pollId: string, voteId: string): void {
  if (typeof window === 'undefined') return;
  try {
    const ids = JSON.parse(localStorage.getItem('pollVoteIds') || '{}');
    ids[pollId] = voteId;
    localStorage.setItem('pollVoteIds', JSON.stringify(ids));
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
