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
 * Compact table-like layout with one row per time slot.
 */
export default function TimeSlotRoundsDisplay({
  allRounds,
  allVoters,
  currentUserVoteId,
}: TimeSlotRoundsDisplayProps) {
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
    const suffix = showNextDay ? '+1' : '';
    return `${displayHours}:${minutes.toString().padStart(2, '0')}${suffix}`;
  };

  const formatPeriod = (timeStr: string): string => {
    const [hours] = timeStr.split(':').map(Number);
    return hours >= 12 ? 'PM' : 'AM';
  };

  const formatDuration = (hours: number): string => {
    if (hours === 1) return '1h';
    return `${hours}h`;
  };

  if (allRounds.length === 0) {
    return (
      <div className="text-center text-gray-600 dark:text-gray-400">
        No time slots available
      </div>
    );
  }

  // Group current slots by date
  const slotsByDate = currentSlots.reduce((acc, slot) => {
    if (!acc[slot.slot_date]) acc[slot.slot_date] = [];
    acc[slot.slot_date].push(slot);
    return acc;
  }, {} as Record<string, TimeSlot[]>);

  // Check if start/end AM/PM are same for a compact format
  const formatTimeRange = (slot: TimeSlot) => {
    const startPeriod = formatPeriod(slot.slot_start_time);
    const isNextDay = slot.slot_end_time <= slot.slot_start_time;
    const endPeriod = formatPeriod(slot.slot_end_time);
    const start = formatTime(slot.slot_start_time);
    const end = formatTime(slot.slot_end_time, isNextDay);

    // If same period, only show it on the end time
    if (startPeriod === endPeriod && !isNextDay) {
      return `${start}\u2013${end} ${endPeriod}`;
    }
    return `${start} ${startPeriod}\u2013${end} ${endPeriod}`;
  };

  return (
    <div className="w-full max-w-2xl mx-auto">
      {/* Round header with navigation */}
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => setCurrentRound(r => Math.max(1, r - 1))}
          disabled={currentRound === 1}
          className={`p-1.5 rounded ${
            currentRound === 1
              ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
              : 'text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900'
          }`}
          aria-label="Previous round"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <div className="text-center flex-1">
          <div className="text-base font-semibold text-gray-900 dark:text-gray-100">
            Round {currentRound} of {totalRounds}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {participantCount} {participantCount === 1 ? 'participant' : 'participants'}
          </div>
        </div>

        <button
          onClick={() => setCurrentRound(r => Math.min(totalRounds, r + 1))}
          disabled={currentRound === totalRounds}
          className={`p-1.5 rounded ${
            currentRound === totalRounds
              ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
              : 'text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900'
          }`}
          aria-label="Next round"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Compact time slots grouped by date */}
      <div className="border rounded-lg overflow-hidden dark:border-gray-700">
        {Object.entries(slotsByDate).map(([date, slots], groupIdx) => (
          <div key={date}>
            {/* Date header */}
            <div className={`px-3 py-1.5 bg-gray-50 dark:bg-gray-800 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide ${
              groupIdx > 0 ? 'border-t dark:border-gray-700' : ''
            }`}>
              {formatDate(date)}
            </div>

            {/* Slot rows */}
            {slots.map((slot, index) => {
              const isWinner = slot.is_winner;
              return (
                <div
                  key={index}
                  className={`flex items-center px-3 py-2 ${
                    index > 0 ? 'border-t border-gray-100 dark:border-gray-750' : ''
                  } ${
                    isWinner
                      ? 'bg-green-50 dark:bg-green-900/30'
                      : 'bg-white dark:bg-gray-800'
                  }`}
                >
                  {/* Winner indicator */}
                  <div className="w-5 flex-shrink-0">
                    {isWinner && (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-green-600 dark:text-green-400" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </div>

                  {/* Time range */}
                  <div className={`flex-1 min-w-0 ${isWinner ? 'font-semibold' : ''}`}>
                    <span className="text-sm text-gray-900 dark:text-gray-100">
                      {formatTimeRange(slot)}
                    </span>
                    <span className="text-xs text-gray-400 dark:text-gray-500 ml-1.5">
                      {formatDuration(slot.duration_hours)}
                    </span>
                  </div>

                  {/* Participant badges - compact */}
                  <div className="flex flex-wrap gap-1 justify-end ml-2">
                    {slot.participant_names.map((name, idx) => {
                      const voteId = slot.participant_vote_ids[idx];
                      const isCurrentUser = voteId === currentUserVoteId;
                      const colorClass = voteId ? getParticipantColor(voteId) : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
                      const displayName = isCurrentUser
                        ? (name ? `You (${name})` : 'You')
                        : (name || 'Anonymous');

                      return (
                        <span
                          key={voteId || idx}
                          className={`inline-block px-2 py-0.5 rounded-full text-xs ${
                            isCurrentUser ? 'font-bold ring-1 ring-blue-500 dark:ring-blue-400' : 'font-medium'
                          } ${colorClass}`}
                        >
                          {displayName}
                        </span>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Round indicator dots */}
      {totalRounds > 1 && (
        <div className="flex justify-center gap-2 mt-3">
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
