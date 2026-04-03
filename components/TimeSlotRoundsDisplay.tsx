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

function formatTime(timeStr: string): string {
  const [hours, minutes] = timeStr.split(':').map(Number);
  const displayHours = hours % 12 || 12;
  return `${displayHours}:${minutes.toString().padStart(2, '0')}`;
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
  const endHours = slot.slot_end_time.split(':').map(Number);
  const displayEnd = (endHours[0] % 12 || 12) + ':' + endHours[1].toString().padStart(2, '0') + (isNextDay ? '+1' : '');

  if (startPeriod === endPeriod && !isNextDay) {
    return `${start}\u2013${displayEnd} ${endPeriod}`;
  }
  return `${start} ${startPeriod}\u2013${displayEnd} ${endPeriod}`;
}

// --- Grouping logic ---

interface StartTimeRange {
  first: string; // HH:MM
  last: string;  // HH:MM
  count: number;
  step: number;  // minutes between consecutive slots
}

interface DateRanges {
  date: string;
  ranges: StartTimeRange[];
}

interface SlotGroup {
  duration_hours: number;
  participant_vote_ids: string[];
  participant_names: string[];
  participant_count: number;
  winner_slot: TimeSlot | null;
  dateRanges: DateRanges[];
  slotCount: number;
}

function timeToMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTimeStr(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

function findContiguousRanges(sortedMinutes: number[]): StartTimeRange[] {
  if (sortedMinutes.length === 0) return [];
  if (sortedMinutes.length === 1) {
    return [{ first: minutesToTimeStr(sortedMinutes[0]), last: minutesToTimeStr(sortedMinutes[0]), count: 1, step: 0 }];
  }

  // Detect step as minimum positive gap
  let minStep = Infinity;
  for (let i = 1; i < sortedMinutes.length; i++) {
    const diff = sortedMinutes[i] - sortedMinutes[i - 1];
    if (diff > 0 && diff < minStep) minStep = diff;
  }

  const ranges: StartTimeRange[] = [];
  let start = sortedMinutes[0];
  let prev = sortedMinutes[0];
  let count = 1;

  for (let i = 1; i < sortedMinutes.length; i++) {
    if (sortedMinutes[i] - prev === minStep) {
      prev = sortedMinutes[i];
      count++;
    } else {
      ranges.push({ first: minutesToTimeStr(start), last: minutesToTimeStr(prev), count, step: minStep });
      start = sortedMinutes[i];
      prev = sortedMinutes[i];
      count = 1;
    }
  }
  ranges.push({ first: minutesToTimeStr(start), last: minutesToTimeStr(prev), count, step: minStep });

  return ranges;
}

function buildGroups(slots: TimeSlot[]): SlotGroup[] {
  const groupMap = new Map<string, TimeSlot[]>();

  for (const slot of slots) {
    const key = `${slot.duration_hours}|${[...slot.participant_vote_ids].sort().join(',')}`;
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key)!.push(slot);
  }

  const groups: SlotGroup[] = [];

  for (const [, slotsInGroup] of groupMap) {
    const first = slotsInGroup[0];

    const byDate = new Map<string, string[]>();
    let winnerSlot: TimeSlot | null = null;

    for (const slot of slotsInGroup) {
      if (!byDate.has(slot.slot_date)) byDate.set(slot.slot_date, []);
      byDate.get(slot.slot_date)!.push(slot.slot_start_time);
      if (slot.is_winner) winnerSlot = slot;
    }

    const dateRanges: DateRanges[] = [];
    const sortedDates = [...byDate.keys()].sort();

    for (const date of sortedDates) {
      const startTimes = byDate.get(date)!;
      const minutes = startTimes.map(timeToMinutes).sort((a, b) => a - b);
      dateRanges.push({ date, ranges: findContiguousRanges(minutes) });
    }

    groups.push({
      duration_hours: first.duration_hours,
      participant_vote_ids: first.participant_vote_ids,
      participant_names: first.participant_names,
      participant_count: first.participant_count,
      winner_slot: winnerSlot,
      dateRanges,
      slotCount: slotsInGroup.length,
    });
  }

  // Sort: winner group first, then by slot count descending
  groups.sort((a, b) => {
    if (a.winner_slot && !b.winner_slot) return -1;
    if (!a.winner_slot && b.winner_slot) return 1;
    return b.slotCount - a.slotCount;
  });

  return groups;
}

function formatStartTimeRange(range: StartTimeRange): string {
  if (range.first === range.last) {
    return `${formatTime(range.first)} ${formatPeriod(range.first)}`;
  }
  const firstPeriod = formatPeriod(range.first);
  const lastPeriod = formatPeriod(range.last);
  if (firstPeriod === lastPeriod) {
    return `${formatTime(range.first)}\u2013${formatTime(range.last)} ${lastPeriod}`;
  }
  return `${formatTime(range.first)} ${firstPeriod}\u2013${formatTime(range.last)} ${lastPeriod}`;
}

function formatStep(minutes: number): string {
  if (minutes <= 0) return '';
  if (minutes >= 60 && minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? 'every hr' : `every ${hours}h`;
  }
  return `every ${minutes}m`;
}

// --- Component ---

export default function TimeSlotRoundsDisplay({
  allRounds,
  allVoters,
  currentUserVoteId,
}: TimeSlotRoundsDisplayProps) {
  const [currentRound, setCurrentRound] = useState(1);
  const [expanded, setExpanded] = useState(false);

  const colorMap = useMemo(() => {
    const map = new Map<string, string>();
    if (allVoters.length > 0) {
      allVoters.forEach((v, i) => map.set(v.id, PARTICIPANT_COLORS[i % PARTICIPANT_COLORS.length]));
    } else {
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
  const totalSlotCount = currentSlots.length;

  const groups = useMemo(() => buildGroups(currentSlots), [currentSlots]);

  const COLLAPSED_GROUPS = 4;
  const needsCollapse = groups.length > COLLAPSED_GROUPS + 1;
  const showAll = expanded || !needsCollapse;
  const visibleGroups = showAll ? groups : groups.slice(0, COLLAPSED_GROUPS);
  const hiddenGroupCount = groups.length - visibleGroups.length;

  if (allRounds.length === 0) {
    return (
      <div className="text-center text-gray-600 dark:text-gray-400">
        No time slots available
      </div>
    );
  }

  const renderParticipantPills = (group: SlotGroup) => (
    <div className="flex flex-wrap gap-1">
      {group.participant_names.map((name, idx) => {
        const voteId = group.participant_vote_ids[idx];
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
  );

  const renderGroup = (group: SlotGroup, groupIdx: number) => {
    const hasWinner = !!group.winner_slot;

    return (
      <div
        key={groupIdx}
        className={`${groupIdx > 0 ? 'border-t border-gray-200 dark:border-gray-600' : ''} ${
          hasWinner ? 'bg-green-50 dark:bg-green-900/30' : 'bg-white dark:bg-gray-800'
        }`}
      >
        {/* Header: duration, slot count, participants */}
        <div className="px-3 pt-2.5 pb-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {hasWinner && (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-green-600 dark:text-green-400 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              )}
              <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                {formatDuration(group.duration_hours)}
              </span>
              <span className="text-xs text-gray-400 dark:text-gray-500">
                {group.slotCount} slot{group.slotCount !== 1 ? 's' : ''}
              </span>
            </div>
            {renderParticipantPills(group)}
          </div>

          {/* Winner callout */}
          {hasWinner && group.winner_slot && (
            <div className="mt-1 text-xs font-medium text-green-700 dark:text-green-300">
              Winner: {formatTimeRange(group.winner_slot)}, {formatDate(group.winner_slot.slot_date)}
            </div>
          )}
        </div>

        {/* Date + start time ranges */}
        <div className="px-3 pb-2.5">
          {group.dateRanges.map((dr) => (
            <div key={dr.date} className="mt-1">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                {formatDate(dr.date)}
              </span>
              <div className="text-sm text-gray-900 dark:text-gray-100 ml-1 mt-0.5">
                {dr.ranges.map((r, i) => (
                  <span key={i}>
                    {i > 0 && <span className="text-gray-400 dark:text-gray-500">,{' '}</span>}
                    {formatStartTimeRange(r)}
                    {r.count > 1 && r.step > 0 && (
                      <span className="text-xs text-gray-400 dark:text-gray-500 ml-1">
                        {formatStep(r.step)}
                      </span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
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
            {participantCount} {participantCount === 1 ? 'participant' : 'participants'} &middot; {totalSlotCount} time slot{totalSlotCount !== 1 ? 's' : ''}
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
        {visibleGroups.map((group, index) => renderGroup(group, index))}

        {needsCollapse && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full px-3 py-2 text-center text-sm text-blue-600 dark:text-blue-400 hover:bg-gray-50 dark:hover:bg-gray-700 border-t border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800"
          >
            {expanded
              ? 'Show less'
              : `Show ${hiddenGroupCount} more group${hiddenGroupCount === 1 ? '' : 's'}`
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
