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
}

export default function VoterList({ pollId, className = "" }: VoterListProps) {
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
    }
  }, [pollId]);

  if (loading) {
    return (
      <div className={`p-4 ${className}`}>
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Voters</h3>
        <div className="flex items-center justify-center py-4">
          <svg className="animate-spin h-5 w-5 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`p-4 ${className}`}>
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Voters</h3>
        <div className="text-sm text-red-600 dark:text-red-400">{error}</div>
      </div>
    );
  }

  if (voters.length === 0) {
    return (
      <div className={`p-4 ${className}`}>
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Voters</h3>
        <div className="text-sm text-gray-500 dark:text-gray-400 italic">No votes yet</div>
      </div>
    );
  }

  // Get named voters (excluding anonymous ones) and sort alphabetically
  const namedVoters = voters
    .filter(vote => vote.voter_name && vote.voter_name.trim() !== '')
    .sort((a, b) => {
      const nameA = (a.voter_name || '').toLowerCase();
      const nameB = (b.voter_name || '').toLowerCase();
      return nameA.localeCompare(nameB);
    });

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
    <div className={`p-4 ${className}`}>
      <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
        Voters ({voters.length})
      </h3>
      
      <div className="text-center">
        {/* Named voters - displayed as colored bubbles in a flowing layout */}
        <div className="flex flex-wrap justify-center gap-2 mb-3">
          {namedVoters.map((voter, index) => (
            <span 
              key={voter.id} 
              className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${getVoterColor(index)}`}
            >
              {voter.voter_name}
            </span>
          ))}
        </div>
        
        {/* Anonymous voters count */}
        {anonymousCount > 0 && (
          <div className="inline-block px-3 py-1 bg-gray-100 dark:bg-gray-700 rounded-full border border-gray-300 dark:border-gray-600">
            <span className="text-sm text-gray-600 dark:text-gray-300 italic">
              {anonymousCount} × Anonymous {anonymousCount === 1 ? 'voter' : 'voters'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}