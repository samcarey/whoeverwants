"use client";

import { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
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
  icon?: string;
  filter?: (vote: ApiVote) => boolean;
  /** Single-line overflow mode: hides icon + count, renders one row, and
   *  collapses overflow into a "+N" badge. Used under thread poll cards. */
  singleLine?: boolean;
}

export default function VoterList({ pollId, className = "", refreshTrigger, label, icon = "👥", filter, singleLine = false }: VoterListProps) {
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

  useEffect(() => {
    if (!pollId) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { pollId?: string } | undefined;
      if (detail?.pollId === pollId) fetchVoters();
    };
    window.addEventListener('poll:votesChanged', handler);
    return () => window.removeEventListener('poll:votesChanged', handler);
  }, [pollId, fetchVoters]);

  if (initialLoading) {
    if (singleLine) {
      return (
        <div className={`flex items-center gap-1.5 overflow-hidden whitespace-nowrap ${className}`}>
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
    return (
      <div className={`flex flex-wrap items-center justify-center gap-1.5 ${className}`}>
        <span className="text-sm text-gray-500 dark:text-gray-400 mr-0.5" title={label || "Respondents"}>{icon}</span>
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
      'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
      'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300',
      'bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
      'bg-pink-50 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300',
      'bg-yellow-50 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
      'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
      'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300',
      'bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
    ];
    return colors[index % colors.length];
  };

  if (singleLine) {
    // Render all bubbles + anon + a trailing "+N" badge that acts as the
    // overflow placeholder. A layout effect hides bubbles that don't fit and
    // updates the badge count; if everything fits, the badge is hidden.
    return (
      <SingleLineVoters
        namedVoters={namedVoters}
        currentUserVoteId={currentUserVote?.id ?? null}
        adjustedAnonymousCount={adjustedAnonymousCount}
        getVoterColor={getVoterColor}
        className={className}
      />
    );
  }

  return (
    <div className={`flex flex-wrap items-center justify-center gap-1.5 ${className}`}>
      <span className="text-sm text-gray-500 dark:text-gray-400 mr-0.5" title={label || "Respondents"}>
        {voters.length} {icon}
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

interface SingleLineVotersProps {
  namedVoters: Voter[];
  currentUserVoteId: string | null;
  adjustedAnonymousCount: number;
  getVoterColor: (index: number) => string;
  className: string;
}

function SingleLineVoters({
  namedVoters,
  currentUserVoteId,
  adjustedAnonymousCount,
  getVoterColor,
  className,
}: SingleLineVotersProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const bubbleRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const anonRef = useRef<HTMLSpanElement | null>(null);
  const plusRef = useRef<HTMLSpanElement | null>(null);
  const [overflow, setOverflow] = useState(0);

  const totalItems = namedVoters.length + (adjustedAnonymousCount > 0 ? 1 : 0);
  const GAP = 6; // matches gap-1.5

  // Re-measure on size change and whenever the item set changes.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const containerWidth = el.clientWidth;
      const items: HTMLElement[] = [];
      for (const ref of bubbleRefs.current) {
        if (ref) items.push(ref);
      }
      if (anonRef.current) items.push(anonRef.current);
      // Temporarily ensure all items are visible for measurement.
      for (const it of items) it.style.display = '';
      if (plusRef.current) plusRef.current.style.display = '';
      const plusWidth = plusRef.current ? plusRef.current.offsetWidth : 0;
      let used = 0;
      let fit = 0;
      for (let i = 0; i < items.length; i++) {
        const w = items[i].offsetWidth + (i > 0 ? GAP : 0);
        const remaining = items.length - (i + 1);
        const reservePlus = remaining > 0 ? GAP + plusWidth : 0;
        if (used + w + reservePlus <= containerWidth) {
          used += w;
          fit++;
        } else {
          break;
        }
      }
      const hidden = items.length - fit;
      for (let i = 0; i < items.length; i++) {
        items[i].style.display = i < fit ? '' : 'none';
      }
      if (plusRef.current) plusRef.current.style.display = hidden > 0 ? '' : 'none';
      setOverflow(hidden);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [totalItems]);

  return (
    <div
      ref={containerRef}
      className={`flex items-center gap-1.5 overflow-hidden whitespace-nowrap ${className}`}
    >
      {namedVoters.map((voter, index) => {
        const isCurrentUser = currentUserVoteId && voter.id === currentUserVoteId;
        const displayName = isCurrentUser
          ? (voter.voter_name ? `You (${voter.voter_name})` : 'You')
          : voter.voter_name;
        return (
          <span
            key={voter.id}
            ref={(el) => { bubbleRefs.current[index] = el; }}
            className={`inline-block shrink-0 px-2.5 py-0.5 rounded-full text-xs ${
              isCurrentUser ? 'font-bold ring-2 ring-blue-500 dark:ring-blue-400' : 'font-medium'
            } ${getVoterColor(index)}`}
          >
            {displayName}
          </span>
        );
      })}
      {adjustedAnonymousCount > 0 && (
        <span
          ref={anonRef}
          className="inline-block shrink-0 px-2.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded-full border border-gray-300 dark:border-gray-600 text-xs text-gray-600 dark:text-gray-300 italic"
        >
          {adjustedAnonymousCount} × Anon
        </span>
      )}
      <span
        ref={plusRef}
        className="inline-block shrink-0 px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400"
        style={{ display: overflow > 0 ? '' : 'none' }}
      >
        +{overflow}
      </span>
    </div>
  );
}
