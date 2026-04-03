"use client";

import React, { useState, useMemo } from 'react';

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

const COLLAPSED_VISIBLE = 3;

const PARTICIPANT_COLORS = [
  'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  'bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200',
  'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200',
  'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200',
];

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });
}

function formatTime(timeStr: string, showNextDay?: boolean): string {
  const [hours, minutes] = timeStr.split(':').map(Number);
  const displayHours = hours % 12 || 12;
  const suffix = showNextDay ? '+1' : '';
  return `${displayHours}:${minutes.toString().padStart(2, '0')}${suffix}`;
}

function formatPeriod(timeStr: string): string {
  const [hours] = timeStr.split(':').map(Number);
  return hours >= 12 ? 'PM' : 'AM';
}

function formatDuration(hours: number): string {
  return hours === 1 ? '1h' : `${hours}h`;
}

function formatTimeRange(slot: TimeSlot): string {
  const startPeriod = formatPeriod(slot.slot_start_time);
  const isNextDay = slot.slot_end_time <= slot.slot_start_time;
  const endPeriod = formatPeriod(slot.slot_end_time);
  const start = formatTime(slot.slot_start_time);
  const end = formatTime(slot.slot_end_time, isNextDay);

  if (startPeriod === endPeriod && !isNextDay) {
    return `${start}\u2013${end} ${endPeriod}`;
  }
  return `${start} ${startPeriod}\u2013${end} ${endPeriod}`;
}

interface DisplaySlot {
  slot: TimeSlot;
  date: string;
  isFirstInDate: boolean;
}

export default function TimeSlotRoundsDisplay({
  allRounds,
  allVoters,
  currentUserVoteId,
}: TimeSlotRoundsDisplayProps) {
  const [currentRound, setCurrentRound] = useState(1);
  const [expanded, setExpanded] = useState(false);

  // Build a vote ID -> color index map from allVoters (or fallback to stable ordering from data)
  const colorMap = useMemo(() => {
    const map = new Map<string, string>();
    if (allVoters.length > 0) {
      allVoters.forEach((v, i) => map.set(v.id, PARTICIPANT_COLORS[i % PARTICIPANT_COLORS.length]));
    } else {
      // Derive unique vote IDs from all rounds in stable order
      const seen = new Set<string>();
      for (const slot of allRounds) {
        for (const id of slot.participant_vote_ids) {
          if (id && !seen.has(id)) {
            map.set(id, PARTICIPANT_COLORS[seen.size % PARTICIPANT_COLORS.length]);
            seen.add(id);
          }
        }
      }
    }
    return map;
  }, [allVoters, allRounds]);

  const { roundsByNumber, totalRounds } = useMemo(() => {
    const byNumber = allRounds.reduce((acc, slot) => {
      if (!acc[slot.round_number]) acc[slot.round_number] = [];
      acc[slot.round_number].push(slot);
      return acc;
    }, {} as Record<number, TimeSlot[]>);
    return {
      roundsByNumber: byNumber,
      totalRounds: Math.max(...Object.keys(byNumber).map(Number)),
    };
  }, [allRounds]);

  const currentSlots = roundsByNumber[currentRound] || [];
  const participantCount = currentSlots.length > 0 ? currentSlots[0].participant_count : 0;

  const { allDisplaySlots, winnerIdx } = useMemo(() => {
    const slots: DisplaySlot[] = [];
    let winner = -1;
    // Group by date and flatten in one pass
    let prevDate = '';
    for (const slot of currentSlots) {
      const isFirst = slot.slot_date !== prevDate;
      if (slot.is_winner) winner = slots.length;
      slots.push({ slot, date: slot.slot_date, isFirstInDate: isFirst });
      prevDate = slot.slot_date;
    }
    return { allDisplaySlots: slots, winnerIdx: winner };
  }, [currentSlots]);

  const needsCollapse = allDisplaySlots.length > COLLAPSED_VISIBLE + 1;
  const showAll = expanded || !needsCollapse;

  const visibleSlots = useMemo(() => {
    if (showAll) return allDisplaySlots;
    // Show winner (if exists) + first COLLAPSED_VISIBLE other slots
    const visible: DisplaySlot[] = [];
    let added = 0;
    for (let i = 0; i < allDisplaySlots.length && (added < COLLAPSED_VISIBLE || i === winnerIdx); i++) {
      if (i === winnerIdx) {
        visible.push(allDisplaySlots[i]);
      } else if (added < COLLAPSED_VISIBLE) {
        visible.push(allDisplaySlots[i]);
        added++;
      }
    }
    // Ensure winner is included even if beyond COLLAPSED_VISIBLE range
    if (winnerIdx >= 0 && !visible.includes(allDisplaySlots[winnerIdx])) {
      visible.push(allDisplaySlots[winnerIdx]);
    }
    return visible;
  }, [allDisplaySlots, winnerIdx, showAll]);

  const hiddenCount = allDisplaySlots.length - visibleSlots.length;

  if (allRounds.length === 0) {
    return (
      <div className="text-center text-gray-600 dark:text-gray-400">
        No time slots available
      </div>
    );
  }

  const renderSlotRow = (item: DisplaySlot, index: number) => {
    const { slot, date, isFirstInDate } = item;
    const isWinner = slot.is_winner;
    return (
      <React.Fragment key={`${date}-${index}`}>
        {isFirstInDate && (
          <div className="px-3 py-1 bg-gray-50 dark:bg-gray-800 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide border-t border-gray-100 dark:border-gray-700 first:border-t-0">
            {formatDate(date)}
          </div>
        )}
        <div
          className={`flex items-center px-3 py-1.5 border-t border-gray-100 dark:border-gray-700 ${
            isWinner
              ? 'bg-green-50 dark:bg-green-900/30'
              : 'bg-white dark:bg-gray-800'
          }`}
        >
          <div className="w-5 flex-shrink-0">
            {isWinner && (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-green-600 dark:text-green-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            )}
          </div>

          <div className={`flex-1 min-w-0 ${isWinner ? 'font-semibold' : ''}`}>
            <span className="text-sm text-gray-900 dark:text-gray-100">
              {formatTimeRange(slot)}
            </span>
            <span className="text-xs text-gray-400 dark:text-gray-500 ml-1.5">
              {formatDuration(slot.duration_hours)}
            </span>
          </div>

          <div className="flex flex-wrap gap-1 justify-end ml-2">
            {slot.participant_names.map((name, idx) => {
              const voteId = slot.participant_vote_ids[idx];
              const isCurrentUser = voteId === currentUserVoteId;
              const colorClass = (voteId && colorMap.get(voteId)) || PARTICIPANT_COLORS[0];
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
      </React.Fragment>
    );
  };

  return (
    <div className="w-full max-w-2xl mx-auto">
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
            {participantCount} {participantCount === 1 ? 'participant' : 'participants'} &middot; {allDisplaySlots.length} time slots
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

      <div className="border rounded-lg overflow-hidden dark:border-gray-700">
        {visibleSlots.map((item, index) => renderSlotRow(item, index))}

        {needsCollapse && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full px-3 py-2 text-center text-sm text-blue-600 dark:text-blue-400 hover:bg-gray-50 dark:hover:bg-gray-700 border-t border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800"
          >
            {expanded
              ? 'Show less'
              : `Show ${hiddenCount} more time slot${hiddenCount === 1 ? '' : 's'}`
            }
          </button>
        )}
      </div>

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
