import React, { useState, useEffect } from 'react';
import { TimeSlot, supabase } from '@/lib/supabase';

interface TimelineSlotDisplayProps {
  slot: TimeSlot;
  pollTitle?: string;
  showTitle?: boolean;
  isWinner?: boolean;
  pollId?: string;
}

/**
 * Displays a single time slot as a horizontal timeline bar with participant bubbles
 * Shows date, time range, duration, and participating voters
 */
export default function TimelineSlotDisplay({
  slot,
  pollTitle,
  showTitle = false,
  isWinner = true,
  pollId
}: TimelineSlotDisplayProps) {
  const [displayOrderVoters, setDisplayOrderVoters] = useState<{id: string, voter_name: string | null}[]>([]);
  const [currentUserVoteId, setCurrentUserVoteId] = useState<string | null>(null);

  // Fetch all voters and sort in display order (matching VoterList exactly)
  useEffect(() => {
    if (!pollId) return;

    const fetchVoters = async () => {
      try {
        const { data: votersData, error } = await supabase
          .from('votes')
          .select('id, voter_name')
          .eq('poll_id', pollId);

        if (error) {
          console.error('Error fetching voters:', error);
          setDisplayOrderVoters([]);
        } else {
          // Get current user's vote ID from localStorage
          let userVoteId: string | null = null;
          if (typeof window !== 'undefined') {
            try {
              const pollVoteIds = JSON.parse(localStorage.getItem('pollVoteIds') || '{}');
              userVoteId = pollVoteIds[pollId] || null;
            } catch (error) {
              console.error('Error getting vote ID:', error);
            }
          }

          setCurrentUserVoteId(userVoteId);

          const currentUserVote = userVoteId
            ? votersData?.find(v => v.id === userVoteId)
            : null;

          // Get named voters sorted alphabetically
          let allNamedVoters = (votersData || [])
            .filter(vote => vote.voter_name && vote.voter_name.trim() !== '')
            .sort((a, b) => {
              const nameA = (a.voter_name || '').toLowerCase();
              const nameB = (b.voter_name || '').toLowerCase();
              return nameA.localeCompare(nameB);
            });

          // Separate current user from other named voters (matching VoterList logic)
          const currentUserIsNamed = currentUserVote && currentUserVote.voter_name && currentUserVote.voter_name.trim() !== '';

          const otherVoters = currentUserIsNamed
            ? allNamedVoters.filter(v => v.id !== currentUserVote.id)
            : allNamedVoters;

          // Combine: current user first (if named), then others (matching VoterList)
          const displayOrder = currentUserIsNamed
            ? [currentUserVote, ...otherVoters]
            : otherVoters;

          setDisplayOrderVoters(displayOrder);
        }
      } catch (err) {
        console.error('Error loading voters:', err);
        setDisplayOrderVoters([]);
      }
    };

    fetchVoters();
  }, [pollId]);

  // Generate consistent colors for participant bubbles (matching VoterList)
  const getParticipantColor = (voteId: string) => {
    const colors = [
      'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
      'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
      'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
      'bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200',
      'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
      'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200',
      'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
      'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200',
    ];

    // Find the index of this vote_id in the display order array (matching VoterList)
    const voterIndex = displayOrderVoters.findIndex(v => v.id === voteId);
    if (voterIndex === -1) {
      // Fallback: use first color
      return colors[0];
    }

    return colors[voterIndex % colors.length];
  };

  // Format date nicely (e.g., "Wed 11/5/25")
  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr + 'T00:00:00'); // Add time to avoid timezone issues
    const weekday = date.toLocaleDateString('en-US', { weekday: 'short' });
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const year = date.getFullYear().toString().slice(-2);
    return `${weekday} ${month}/${day}/${year}`;
  };

  // Format time nicely (e.g., "09:00" → "9:00 AM")
  const formatTime = (timeStr: string): string => {
    const [hours, minutes] = timeStr.split(':').map(Number);
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`;
  };

  // Format duration (e.g., 2.5 → "2.5 hours", 1 → "1 hour")
  const formatDuration = (hours: number): string => {
    if (hours === 1) return '1 hour';
    if (hours % 1 === 0) return `${hours} hours`;
    return `${hours} hours`;
  };

  const formattedDate = formatDate(slot.slot_date);
  const formattedStartTime = formatTime(slot.slot_start_time);
  const formattedEndTime = formatTime(slot.slot_end_time);
  const formattedDuration = formatDuration(slot.duration_hours);

  // Check if current user is participating
  const userIsParticipating = currentUserVoteId && slot.participant_vote_ids.includes(currentUserVoteId);

  // Check if event is today or tomorrow
  const eventDate = new Date(slot.slot_date + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  let datePrefix = '';
  if (eventDate.getTime() === today.getTime()) {
    datePrefix = 'Today - ';
  } else if (eventDate.getTime() === tomorrow.getTime()) {
    datePrefix = 'Tomorrow - ';
  }

  // Neutral color scheme for the bar
  const barColor = 'border-gray-300 dark:border-gray-600';

  return (
    <div className="w-full max-w-2xl mx-auto">
      {/* Title (optional) */}
      {showTitle && pollTitle && (
        <h3 className="text-lg font-semibold text-center mb-2 text-gray-900 dark:text-gray-100">
          {pollTitle}
        </h3>
      )}

      {/* Header: participation status and date */}
      <div className="text-center mb-2">
        {userIsParticipating && (
          <div className="text-xl font-bold text-green-700 dark:text-green-300 mb-2">
            🎉 You&apos;re Participating!
          </div>
        )}
        <div className="inline-block px-2 py-0.5 rounded-lg bg-blue-50 dark:bg-blue-900/30">
          <div className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            {datePrefix}{formattedDate}
          </div>
        </div>
      </div>

      {/* Timeline bar with participant bubbles */}
      <div className="relative">
        {/* Time labels on left and right edges */}
        <div className="flex justify-between mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
          <div>{formattedStartTime}</div>
          <div>{formattedEndTime}</div>
        </div>

        {/* Horizontal bar */}
        <div
          className={`relative border-2 rounded-lg px-1 py-2 flex items-center ${barColor}`}
        >
          {/* Participant bubbles/names */}
          <div className="flex flex-wrap gap-2 items-center justify-center w-full">
            {slot.participant_names.map((name, index) => {
              const voteId = slot.participant_vote_ids[index];
              const isCurrentUser = voteId === currentUserVoteId;
              const colorClass = voteId ? getParticipantColor(voteId) : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';

              // Match VoterList display name logic
              const displayName = isCurrentUser
                ? (name ? `You (${name})` : 'You')
                : name;

              return (
                <span
                  key={voteId || index}
                  className={`inline-block px-3 py-1 rounded-full text-sm ${
                    isCurrentUser ? 'font-bold border-2 border-blue-500 dark:border-blue-400' : 'font-medium'
                  } ${colorClass}`}
                >
                  {displayName}
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
