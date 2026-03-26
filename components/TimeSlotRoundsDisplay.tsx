"use client";

import React, { useState } from 'react';

export interface TimeSlot {
  round_number: number;
  slot_date: string;
  slot_start_time: string;
  slot_end_time: string;
  duration_hours: number;
  participant_count: number;
  participant_vote_ids: string[];
  participant_names: string[];
  is_winner: boolean;
}

interface TimeSlotRoundsDisplayProps {
  allRounds: TimeSlot[];
  allVoters: {id: string, voter_name: string | null}[];
  currentUserVoteId: string | null;
}

/**
 * Displays elimination rounds for participation poll time slots.
 * Users can navigate between rounds to see alternative time slots.
 */
export default function TimeSlotRoundsDisplay({
  allRounds,
  allVoters,
  currentUserVoteId,
}: TimeSlotRoundsDisplayProps) {
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

    const voterIndex = allVoters.findIndex(v => v.id === voteId);
    if (voterIndex === -1) return colors[0];
    return colors[voterIndex % colors.length];
  };

  // Group slots by round number
  const roundsByNumber = allRounds.reduce((acc, slot) => {
    if (!acc[slot.round_number]) {
      acc[slot.round_number] = [];
    }
    acc[slot.round_number].push(slot);
    return acc;
  }, {} as Record<number, TimeSlot[]>);

  const totalRounds = Math.max(...Object.keys(roundsByNumber).map(Number));
  const [currentRound, setCurrentRound] = useState(1);

  const currentSlots = roundsByNumber[currentRound] || [];
  const participantCount = currentSlots.length > 0 ? currentSlots[0].participant_count : 0;

  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });
  };

  const formatTime = (timeStr: string, showNextDay?: boolean): string => {
    const [hours, minutes] = timeStr.split(':').map(Number);
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    const suffix = showNextDay ? ' +1' : '';
    return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}${suffix}`;
  };

  const formatDuration = (hours: number): string => {
    if (hours === 1) return '1 hr';
    return `${hours} hrs`;
  };

  if (allRounds.length === 0) {
    return (
      <div className="text-center text-gray-600 dark:text-gray-400">
        No time slots available
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl mx-auto">
      {/* Round header with navigation */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => setCurrentRound(r => Math.max(1, r - 1))}
          disabled={currentRound === 1}
          className={`p-2 rounded ${
            currentRound === 1
              ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
              : 'text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900'
          }`}
          aria-label="Previous round"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <div className="text-center flex-1">
          <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Round {currentRound} of {totalRounds}
          </div>
          <div className="text-sm text-gray-600 dark:text-gray-400">
            {participantCount} {participantCount === 1 ? 'participant' : 'participants'}
          </div>
        </div>

        <button
          onClick={() => setCurrentRound(r => Math.min(totalRounds, r + 1))}
          disabled={currentRound === totalRounds}
          className={`p-2 rounded ${
            currentRound === totalRounds
              ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
              : 'text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900'
          }`}
          aria-label="Next round"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Time slots list */}
      <div className="space-y-3 max-h-96 overflow-y-auto">
        {currentSlots.map((slot, index) => (
          <div
            key={index}
            className={`border rounded-lg p-4 ${
              slot.is_winner
                ? 'bg-green-50 dark:bg-green-900 border-green-300 dark:border-green-700'
                : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold text-gray-900 dark:text-gray-100">
                {formatDate(slot.slot_date)} @ {formatTime(slot.slot_start_time)}-{formatTime(slot.slot_end_time, slot.slot_end_time < slot.slot_start_time)}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">
                ({formatDuration(slot.duration_hours)})
              </div>
            </div>

            <div className="flex flex-wrap gap-2 mt-2">
              {slot.participant_names.map((name, idx) => {
                const voteId = slot.participant_vote_ids[idx];
                const isCurrentUser = voteId === currentUserVoteId;
                const colorClass = voteId ? getParticipantColor(voteId) : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
                const displayName = isCurrentUser
                  ? (name ? `You (${name})` : 'You')
                  : name;

                return (
                  <span
                    key={voteId || idx}
                    className={`inline-block px-3 py-1 rounded-full text-sm ${
                      isCurrentUser ? 'font-bold border-2 border-blue-500 dark:border-blue-400' : 'font-medium'
                    } ${colorClass}`}
                  >
                    {displayName}
                  </span>
                );
              })}
            </div>

            {slot.is_winner && (
              <div className="mt-2 text-sm font-semibold text-green-700 dark:text-green-300">
                Selected Time
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Round indicator dots */}
      {totalRounds > 1 && (
        <div className="flex justify-center gap-2 mt-4">
          {Array.from({ length: totalRounds }, (_, i) => i + 1).map((roundNum) => (
            <button
              key={roundNum}
              onClick={() => setCurrentRound(roundNum)}
              className={`w-2 h-2 rounded-full ${
                roundNum === currentRound
                  ? 'bg-blue-600 dark:bg-blue-400'
                  : 'bg-gray-300 dark:bg-gray-600'
              }`}
              aria-label={`Go to round ${roundNum}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
