"use client";

import React, { useState } from 'react';
import { TimeSlot } from '@/lib/supabase';

interface TimeSlotRoundsDisplayProps {
  allRounds: TimeSlot[];
  pollId: string;
}

/**
 * Displays elimination rounds for participation poll time slots
 * Users can navigate between rounds to see alternative time slots
 * Similar to CompactRankedChoiceResults navigation
 */
export default function TimeSlotRoundsDisplay({
  allRounds,
  pollId
}: TimeSlotRoundsDisplayProps) {
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

  // Format date (e.g., "Wed Nov 1")
  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });
  };

  // Format time (e.g., "09:00" → "9:00 AM")
  const formatTime = (timeStr: string): string => {
    const [hours, minutes] = timeStr.split(':').map(Number);
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`;
  };

  // Format duration (e.g., 2.5 → "2.5 hrs")
  const formatDuration = (hours: number): string => {
    if (hours === 1) return '1 hr';
    if (hours % 1 === 0) return `${hours} hrs`;
    return `${hours} hrs`;
  };

  const handlePrevRound = () => {
    if (currentRound > 1) {
      setCurrentRound(currentRound - 1);
    }
  };

  const handleNextRound = () => {
    if (currentRound < totalRounds) {
      setCurrentRound(currentRound + 1);
    }
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
        {/* Left arrow */}
        <button
          onClick={handlePrevRound}
          disabled={currentRound === 1}
          className={`p-2 rounded ${
            currentRound === 1
              ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
              : 'text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900'
          }`}
          aria-label="Previous round"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        {/* Round title */}
        <div className="text-center flex-1">
          <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Round {currentRound} of {totalRounds}
          </div>
          <div className="text-sm text-gray-600 dark:text-gray-400">
            {participantCount} {participantCount === 1 ? 'participant' : 'participants'}
          </div>
        </div>

        {/* Right arrow */}
        <button
          onClick={handleNextRound}
          disabled={currentRound === totalRounds}
          className={`p-2 rounded ${
            currentRound === totalRounds
              ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
              : 'text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900'
          }`}
          aria-label="Next round"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
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
            {/* Time slot header */}
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold text-gray-900 dark:text-gray-100">
                {formatDate(slot.slot_date)} @ {formatTime(slot.slot_start_time)}-{formatTime(slot.slot_end_time)}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">
                ({formatDuration(slot.duration_hours)})
              </div>
            </div>

            {/* Participants */}
            <div className="flex flex-wrap gap-2 mt-2">
              {slot.participant_names.map((name, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200"
                >
                  {name}
                </span>
              ))}
            </div>

            {/* Winner badge */}
            {slot.is_winner && (
              <div className="mt-2 text-sm font-semibold text-green-700 dark:text-green-300">
                ✓ Selected Time
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Round indicator dots */}
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
    </div>
  );
}
