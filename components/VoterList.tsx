"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import { apiGetVotes, ApiVote } from '@/lib/api';

interface Voter {
  id: string;
  voter_name: string | null;
}

interface VoterListProps {
  pollId: string;
  className?: string;
  refreshTrigger?: number;
  label?: string;
  filter?: (vote: ApiVote) => boolean;
}

export default function VoterList({ pollId, className = "", refreshTrigger, label, filter }: VoterListProps) {
  const [voters, setVoters] = useState<Voter[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [anonymousCount, setAnonymousCount] = useState(0);
  const voterIdsRef = useRef('');

  const fetchVoters = useCallback(async () => {
    try {
      let votes = await apiGetVotes(pollId);
      if (filter) votes = votes.filter(filter);
      const voterData: Voter[] = votes.map(v => ({ id: v.id, voter_name: v.voter_name }));

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
  }, [pollId, filter]);

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
      <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
        <span className="text-sm text-gray-500 dark:text-gray-400 mr-0.5" title={label || "Respondents"}>👥</span>
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="animate-pulse inline-block px-2.5 py-0.5 rounded-full bg-gray-200 dark:bg-gray-700"
            style={{ width: `${50 + (i * 12) % 30}px`, height: '24px' }}
          />
        ))}
      </div>
    );
  }

  if (error || voters.length === 0) {
    return null;
  }

  // Get current user's vote ID from localStorage
  const getUserVoteId = (): string | null => {
    if (typeof window === 'undefined') return null;
    try {
      const pollVoteIds = JSON.parse(localStorage.getItem('pollVoteIds') || '{}');
      return pollVoteIds[pollId] || null;
    } catch {
      return null;
    }
  };

  const currentUserVoteId = getUserVoteId();
  const currentUserVote = currentUserVoteId
    ? voters.find(v => v.id === currentUserVoteId)
    : null;

  let allNamedVoters = voters
    .filter(vote => vote.voter_name && vote.voter_name.trim() !== '')
    .sort((a, b) => (a.voter_name || '').toLowerCase().localeCompare((b.voter_name || '').toLowerCase()));

  const currentUserIsNamed = currentUserVote && currentUserVote.voter_name && currentUserVote.voter_name.trim() !== '';

  const otherVoters = currentUserIsNamed
    ? allNamedVoters.filter(v => v.id !== currentUserVote.id)
    : allNamedVoters;

  const namedVoters = currentUserVote
    ? [currentUserVote, ...otherVoters]
    : otherVoters;

  const adjustedAnonymousCount = currentUserVote && !currentUserIsNamed
    ? anonymousCount - 1
    : anonymousCount;

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
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      <span className="text-sm text-gray-500 dark:text-gray-400 mr-0.5" title={label || "Respondents"}>
        👥 {voters.length}
      </span>

      {namedVoters.map((voter, index) => {
        const isCurrentUser = currentUserVote && voter.id === currentUserVote.id;
        const displayName = isCurrentUser
          ? (voter.voter_name ? `You (${voter.voter_name})` : 'You')
          : voter.voter_name;

        return (
          <span
            key={voter.id}
            className={`inline-block px-2.5 py-0.5 rounded-full text-xs ${
              isCurrentUser ? 'font-bold ring-2 ring-blue-500 dark:ring-blue-400' : 'font-medium'
            } ${getVoterColor(index)}`}
          >
            {displayName}
          </span>
        );
      })}

      {adjustedAnonymousCount > 0 && (
        <span className="inline-block px-2.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded-full border border-gray-300 dark:border-gray-600 text-xs text-gray-600 dark:text-gray-300 italic">
          {adjustedAnonymousCount} × Anon
        </span>
      )}
    </div>
  );
}
