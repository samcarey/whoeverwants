"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import { apiGetVotes } from '@/lib/api';

interface Voter {
  id: string;
  voter_name: string | null;
}

interface VoterListProps {
  pollId: string;
  className?: string;
  refreshTrigger?: number; // Optional prop to trigger refresh
}

const CARD_CLASS = "bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 shadow-sm";

export default function VoterList({ pollId, className = "", refreshTrigger }: VoterListProps) {
  const [voters, setVoters] = useState<Voter[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [anonymousCount, setAnonymousCount] = useState(0);
  const voterIdsRef = useRef('');

  const fetchVoters = useCallback(async () => {
    try {
      const votes = await apiGetVotes(pollId);
      const voterData: Voter[] = votes.map(v => ({ id: v.id, voter_name: v.voter_name }));

      // Skip state updates if voter list hasn't changed
      const newKey = voterData.map(v => `${v.id}:${v.voter_name ?? ''}`).join(',');
      if (newKey !== voterIdsRef.current) {
        voterIdsRef.current = newKey;
        setVoters(voterData);
        setAnonymousCount(voterData.filter(v => !v.voter_name || v.voter_name.trim() === '').length);
      }
      setError(null);
    } catch (err) {
      console.error('Error fetching voters:', err);
      if (!voterIdsRef.current) {
        setError('Failed to load voter list');
      }
    } finally {
      setInitialLoading(false);
    }
  }, [pollId]);

  useEffect(() => {
    if (pollId) {
      fetchVoters();
      const interval = setInterval(fetchVoters, 10000);
      return () => clearInterval(interval);
    }
  }, [pollId, fetchVoters]);

  useEffect(() => {
    if (refreshTrigger && pollId) {
      fetchVoters();
    }
  }, [refreshTrigger, pollId, fetchVoters]);

  if (initialLoading) {
    return (
      <div className={`${CARD_CLASS} ${className}`}>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-lg font-bold text-gray-900 dark:text-white mr-1">Respondents</span>
          {/* Shimmer effect for loading voter bubbles */}
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="animate-pulse inline-block px-3 py-1 rounded-full bg-gray-200 dark:bg-gray-700"
              style={{
                width: `${60 + (i * 15) % 40}px`,
                height: '28px'
              }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`${CARD_CLASS} ${className}`}>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-lg font-bold text-gray-900 dark:text-white mr-1">Respondents</span>
          <div className="text-sm text-red-600 dark:text-red-400">{error}</div>
        </div>
      </div>
    );
  }

  if (voters.length === 0) {
    return null;
  }

  // Get current user's vote ID from localStorage
  const getUserVoteId = (): string | null => {
    if (typeof window === 'undefined') return null;
    try {
      const pollVoteIds = JSON.parse(localStorage.getItem('pollVoteIds') || '{}');
      return pollVoteIds[pollId] || null;
    } catch (error) {
      console.error('Error getting vote ID:', error);
      return null;
    }
  };

  const currentUserVoteId = getUserVoteId();

  // Check if current user is in the voter list (could be named or anonymous)
  const currentUserVote = currentUserVoteId
    ? voters.find(v => v.id === currentUserVoteId)
    : null;

  // Get named voters (excluding anonymous ones and current user if anonymous)
  let allNamedVoters = voters
    .filter(vote => vote.voter_name && vote.voter_name.trim() !== '')
    .sort((a, b) => {
      const nameA = (a.voter_name || '').toLowerCase();
      const nameB = (b.voter_name || '').toLowerCase();
      return nameA.localeCompare(nameB);
    });

  // Separate current user from other named voters
  const currentUserIsNamed = currentUserVote && currentUserVote.voter_name && currentUserVote.voter_name.trim() !== '';

  const otherVoters = currentUserIsNamed
    ? allNamedVoters.filter(v => v.id !== currentUserVote.id)
    : allNamedVoters;

  // Combine: current user first (if named or exists), then others
  const namedVoters = currentUserIsNamed
    ? [currentUserVote, ...otherVoters]
    : currentUserVote
      ? [currentUserVote, ...otherVoters]  // Include anonymous current user
      : otherVoters;

  // Adjust anonymous count to exclude current user if they voted anonymously
  const adjustedAnonymousCount = currentUserVote && !currentUserIsNamed
    ? anonymousCount - 1
    : anonymousCount;

  // Generate consistent colors for voter bubbles
  const getVoterColor = (index: number) => {
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
    return colors[index % colors.length];
  };

  return (
    <div className={`${CARD_CLASS} ${className}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-lg font-bold text-gray-900 dark:text-white mr-1">
          Respondents ({voters.length})
        </span>

        {/* Named voters - displayed as colored bubbles in a flowing layout */}
        {namedVoters.map((voter, index) => {
          const isCurrentUser = currentUserVote && voter.id === currentUserVote.id;
          const displayName = isCurrentUser
            ? (voter.voter_name ? `You (${voter.voter_name})` : 'You')
            : voter.voter_name;

          return (
            <span
              key={voter.id}
              className={`inline-block px-3 py-1 rounded-full text-sm ${
                isCurrentUser ? 'font-bold ring-2 ring-blue-500 dark:ring-blue-400' : 'font-medium'
              } ${getVoterColor(index)}`}
            >
              {displayName}
            </span>
          );
        })}

        {/* Anonymous voters count */}
        {adjustedAnonymousCount > 0 && (
          <span className="inline-block px-3 py-1 bg-gray-100 dark:bg-gray-700 rounded-full border border-gray-300 dark:border-gray-600 text-sm text-gray-600 dark:text-gray-300 italic">
            {adjustedAnonymousCount} × Anonymous
          </span>
        )}
      </div>
    </div>
  );
}
