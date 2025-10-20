import React from 'react';
import { TimeSlot } from '@/lib/supabase';

interface TimelineSlotDisplayProps {
  slot: TimeSlot;
  pollTitle?: string;
  showTitle?: boolean;
  isWinner?: boolean;
}

/**
 * Displays a single time slot as a horizontal timeline bar with participant bubbles
 * Shows date, time range, duration, and participating voters
 */
export default function TimelineSlotDisplay({
  slot,
  pollTitle,
  showTitle = false,
  isWinner = true
}: TimelineSlotDisplayProps) {
  // Format date nicely (e.g., "Wednesday, November 5, 2025")
  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr + 'T00:00:00'); // Add time to avoid timezone issues
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
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

  // Color scheme: green for winner, gray for other rounds
  const barColor = isWinner
    ? 'bg-green-100 dark:bg-green-900 border-green-300 dark:border-green-700'
    : 'bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-600';

  const textColor = isWinner
    ? 'text-green-800 dark:text-green-200'
    : 'text-gray-700 dark:text-gray-300';

  return (
    <div className="w-full max-w-2xl mx-auto">
      {/* Title (optional) */}
      {showTitle && pollTitle && (
        <h3 className="text-lg font-semibold text-center mb-2 text-gray-900 dark:text-gray-100">
          {pollTitle}
        </h3>
      )}

      {/* Date header */}
      <div className="text-center mb-4">
        <div className="text-xl font-medium text-gray-900 dark:text-gray-100">
          {formattedDate}
        </div>
      </div>

      {/* Timeline bar with participant bubbles */}
      <div className="relative">
        {/* Horizontal bar */}
        <div
          className={`relative border-2 rounded-lg p-4 min-h-[80px] ${barColor}`}
        >
          {/* Participant bubbles/names */}
          <div className="flex flex-wrap gap-2 items-center justify-center">
            {slot.participant_names.map((name, index) => (
              <div
                key={index}
                className={`inline-flex items-center justify-center px-3 py-1 rounded-full text-sm font-medium ${textColor} bg-white dark:bg-gray-900 border border-current`}
                title={name}
              >
                {name}
              </div>
            ))}
          </div>

          {/* Participant count */}
          {slot.participant_count > 0 && (
            <div className="text-center mt-3 text-sm font-semibold text-gray-600 dark:text-gray-400">
              {slot.participant_count} {slot.participant_count === 1 ? 'participant' : 'participants'}
            </div>
          )}
        </div>

        {/* Time labels on left and right edges */}
        <div className="flex justify-between mt-2 text-sm font-medium text-gray-700 dark:text-gray-300">
          <div>{formattedStartTime}</div>
          <div>{formattedEndTime}</div>
        </div>

        {/* Duration label centered below */}
        <div className="text-center mt-1 text-xs text-gray-500 dark:text-gray-400">
          {formattedDuration}
        </div>
      </div>

      {/* Winner indicator */}
      {isWinner && (
        <div className="text-center mt-3 text-sm font-semibold text-green-700 dark:text-green-300">
          ✓ Event Scheduled
        </div>
      )}
    </div>
  );
}
