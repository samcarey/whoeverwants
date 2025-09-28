// Function to completely forget a poll from browser storage
export function forgetPoll(pollId: string): void {
  if (typeof window === 'undefined' || !pollId) {
    return;
  }

  try {
    // Remove from accessible poll IDs
    const accessiblePollIds = JSON.parse(localStorage.getItem('accessible_poll_ids') || '[]');
    const filteredAccessible = accessiblePollIds.filter((id: string) => id !== pollId);
    localStorage.setItem('accessible_poll_ids', JSON.stringify(filteredAccessible));

    // Remove from voted polls
    const votedPolls = JSON.parse(localStorage.getItem('votedPolls') || '{}');
    delete votedPolls[pollId];
    localStorage.setItem('votedPolls', JSON.stringify(votedPolls));

    // Remove vote ID
    const voteIds = JSON.parse(localStorage.getItem('pollVoteIds') || '{}');
    delete voteIds[pollId];
    localStorage.setItem('pollVoteIds', JSON.stringify(voteIds));

    // Remove creator secret if exists
    const creatorSecrets = JSON.parse(localStorage.getItem('poll_creator_secrets') || '[]');
    const filteredSecrets = creatorSecrets.filter((s: any) => s.pollId !== pollId);
    localStorage.setItem('poll_creator_secrets', JSON.stringify(filteredSecrets));

    console.log(`Poll ${pollId.substring(0, 8)}... forgotten from browser storage`);
  } catch (error) {
    console.error('Error forgetting poll:', error);
  }
}

// Check if poll has any data in browser storage
export function hasPollData(pollId: string): boolean {
  if (typeof window === 'undefined' || !pollId) {
    return false;
  }

  try {
    // Check accessible polls
    const accessiblePollIds = JSON.parse(localStorage.getItem('accessible_poll_ids') || '[]');
    if (accessiblePollIds.includes(pollId)) return true;

    // Check voted polls
    const votedPolls = JSON.parse(localStorage.getItem('votedPolls') || '{}');
    if (votedPolls[pollId]) return true;

    // Check vote IDs
    const voteIds = JSON.parse(localStorage.getItem('pollVoteIds') || '{}');
    if (voteIds[pollId]) return true;

    // Check creator secrets
    const creatorSecrets = JSON.parse(localStorage.getItem('poll_creator_secrets') || '[]');
    if (creatorSecrets.some((s: any) => s.pollId === pollId)) return true;

    return false;
  } catch (error) {
    console.error('Error checking poll data:', error);
    return false;
  }
}