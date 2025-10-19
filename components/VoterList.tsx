"use client";

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

interface Voter {
  id: string;
  voter_name: string | null;
}

interface VoterListProps {
  pollId: string;
  className?: string;
  refreshTrigger?: number; // Optional prop to trigger refresh
}

export default function VoterList({ pollId, className = "", refreshTrigger }: VoterListProps) {
  const [voters, setVoters] = useState<Voter[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [anonymousCount, setAnonymousCount] = useState(0);

  const fetchVoters = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const { data, error: fetchError } = await supabase
        .from('votes')
        .select('id, voter_name')
        .eq('poll_id', pollId);

      if (fetchError) {
        throw fetchError;
      }

      if (data) {
        setVoters(data);
        // Count votes without names
        const anonymousVotes = data.filter(vote => !vote.voter_name || vote.voter_name.trim() === '');
        setAnonymousCount(anonymousVotes.length);
      }
    } catch (err) {
      console.error('Error fetching voters:', err);
      setError('Failed to load voter list');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (pollId) {
      fetchVoters();
      
      // Set up real-time subscription for new votes
      const channel = supabase
        .channel(`votes:${pollId}`)
        .on(
          'postgres_changes',
          {
            event: '*', // Listen to all events (INSERT, UPDATE, DELETE)
            schema: 'public',
            table: 'votes',
            filter: `poll_id=eq.${pollId}`
          },
          (payload) => {
            // Refetch voters when any vote changes
            fetchVoters();
          }
        )
        .subscribe();
      
      // Cleanup subscription on unmount
      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [pollId]);

  // Trigger refresh when refreshTrigger changes
  useEffect(() => {
    if (refreshTrigger && pollId) {
      fetchVoters();
    }
  }, [refreshTrigger]);

  if (loading) {
    return (
      <div className={`bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 shadow-sm ${className}`}>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-3 w-full text-center">Respondents</h3>
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
      <div className={`bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 shadow-sm ${className}`}>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-3 w-full text-center">Respondents</h3>
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
    <div className={`bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 shadow-sm ${className}`}>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <h3 className="text-lg font-bold text-gray-900 dark:text-white w-full text-center mb-3">
          Respondents ({voters.length})
        </h3>

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
          <div className="inline-block px-3 py-1 bg-gray-100 dark:bg-gray-700 rounded-full border border-gray-300 dark:border-gray-600">
            <span className="text-sm text-gray-600 dark:text-gray-300 italic">
              {adjustedAnonymousCount} × Anonymous {adjustedAnonymousCount === 1 ? 'voter' : 'voters'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}