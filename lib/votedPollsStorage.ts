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
