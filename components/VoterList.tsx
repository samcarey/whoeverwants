"use client";

import { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import { apiGetVotes, ApiVote, POLL_VOTES_CHANGED_EVENT } from '@/lib/api';
import { getCachedVotes } from '@/lib/pollCache';

interface Voter {
  id: string;
  voter_name: string | null;
}

interface VoterListProps {
  pollId: string;
  className?: string;
  label?: string;
  filter?: (vote: ApiVote) => boolean;
  /** Single-line overflow mode: hides icon + count, renders one row, and
   *  collapses overflow into a "+N" badge. Used under thread poll cards. */
  singleLine?: boolean;
  /** In singleLine mode: text to render (at the same height as the voter
   *  bubbles) when there are no voters, so the row doesn't collapse and
   *  cause layout shift when the initial fetch completes. Ignored in
   *  multi-line mode. */
  emptyText?: string;
}

export default function VoterList({ pollId, className = "", label, filter, singleLine = false, emptyText }: VoterListProps) {
  // Seed from the shared votes cache synchronously so warm navigations (home
  // page, thread prefetch) render bubbles on the first paint instead of
  // flashing the skeleton for one frame. The thread page also fires
  // apiGetVotes in parallel with the thread load, so even on a cold refresh
  // the cache is usually populated by the time the first VoterList mounts.
  const seed = (() => {
    if (typeof window === 'undefined') return null;
    const cached = getCachedVotes(pollId);
    if (!cached) return null;
    const filtered = filter ? cached.filter(filter) : cached;
    return {
      voters: filtered.map(v => ({ id: v.id, voter_name: v.voter_name })),
      anonymousCount: filtered.filter(v => !v.voter_name || v.voter_name.trim() === '').length,
      key: filtered.map(v => `${v.id}:${v.voter_name ?? ''}`).join(','),
    };
  })();

  const [voters, setVoters] = useState<Voter[]>(seed?.voters ?? []);
  const [initialLoading, setInitialLoading] = useState(seed === null);
  const [error, setError] = useState<string | null>(null);
  const [anonymousCount, setAnonymousCount] = useState(seed?.anonymousCount ?? 0);
  const voterIdsRef = useRef(seed?.key ?? '');

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
    if (!pollId) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { pollId?: string } | undefined;
      if (detail?.pollId === pollId) fetchVoters();
    };
    window.addEventListener(POLL_VOTES_CHANGED_EVENT, handler);
    return () => window.removeEventListener(POLL_VOTES_CHANGED_EVENT, handler);
  }, [pollId, fetchVoters]);

  if (initialLoading) {
    return (
      <div
        className={`flex items-center gap-1.5 ${
          singleLine ? 'overflow-hidden whitespace-nowrap' : 'flex-wrap justify-center'
        } ${className}`}
      >
        {!singleLine && (
          <span className="text-sm text-gray-500 dark:text-gray-400 mr-0.5" title={label || "Respondents"}>👥</span>
        )}
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="animate-pulse inline-block px-2.5 py-0.5 rounded-full bg-gray-200 dark:bg-gray-700"
            // 20px matches the loaded bubble height (text-xs line-height 16px
            // + py-0.5 4px). Without this, skeleton → loaded transition
            // shrinks the row by 4px and every card below jitters up.
            style={{ width: `${50 + (i * 12) % 30}px`, height: '20px' }}
          />
        ))}
      </div>
    );
  }

  if (error) {
    return null;
  }

  if (voters.length === 0) {
    if (singleLine && emptyText) {
      // Reserve the same vertical space the bubble row would occupy. py-0.5
      // matches the bubble padding so loading skeletons → empty state →
      // populated bubbles all render at the same height.
      return (
        <div className={`flex items-center gap-1.5 overflow-hidden whitespace-nowrap ${className}`}>
          <span className="text-xs text-gray-500 dark:text-gray-400 py-0.5">{emptyText}</span>
        </div>
      );
    }
    return null;
  }

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

  // Exclude the current user from the respondents list — their poll card
  // signals their vote state (golden border if they haven't voted).
  const allNamedVoters = voters
    .filter(vote => vote.voter_name && vote.voter_name.trim() !== '')
    .sort((a, b) => (a.voter_name || '').toLowerCase().localeCompare((b.voter_name || '').toLowerCase()));

  const namedVoters = currentUserVoteId
    ? allNamedVoters.filter(v => v.id !== currentUserVoteId)
    : allNamedVoters;

  const currentUserVote = currentUserVoteId
    ? voters.find(v => v.id === currentUserVoteId)
    : null;
  const currentUserIsAnonymous = !!(
    currentUserVote && (!currentUserVote.voter_name || currentUserVote.voter_name.trim() === '')
  );
  const adjustedAnonymousCount = currentUserIsAnonymous ? anonymousCount - 1 : anonymousCount;

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
    // Nothing renders when the only voter is the current user (who's excluded
    // since their state lives on the poll card itself). Fall back to the
    // empty-text placeholder so the row keeps its height.
    if (namedVoters.length === 0 && adjustedAnonymousCount === 0 && emptyText) {
      return (
        <div className={`flex items-center gap-1.5 overflow-hidden whitespace-nowrap ${className}`}>
          <span className="text-xs text-gray-500 dark:text-gray-400 py-0.5">{emptyText}</span>
        </div>
      );
    }
    return (
      <SingleLineVoters
        namedVoters={namedVoters}
        adjustedAnonymousCount={adjustedAnonymousCount}
        getVoterColor={getVoterColor}
        className={className}
      />
    );
  }

  return (
    <div className={`flex flex-wrap items-center justify-center gap-1.5 ${className}`}>
      <span className="text-sm text-gray-500 dark:text-gray-400 mr-0.5" title={label || "Respondents"}>
        {voters.length} 👥
      </span>

      {namedVoters.map((voter, index) => (
        <span
          key={voter.id}
          className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${getVoterColor(index)}`}
        >
          {voter.voter_name}
        </span>
      ))}

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
  adjustedAnonymousCount: number;
  getVoterColor: (index: number) => string;
  className: string;
}

function SingleLineVoters({
  namedVoters,
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
  const GAP = 6; // matches Tailwind gap-1.5

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const items: HTMLElement[] = [];
      for (const ref of bubbleRefs.current) {
        if (ref) items.push(ref);
      }
      if (anonRef.current) items.push(anonRef.current);
      // Make every item visible before measuring; React controls the +N
      // badge's own visibility via the `overflow` state / style prop.
      for (const it of items) it.style.display = '';
      const plusWidth = plusRef.current ? plusRef.current.offsetWidth : 0;
      const containerWidth = el.clientWidth;
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
      for (let i = 0; i < items.length; i++) {
        items[i].style.display = i < fit ? '' : 'none';
      }
      setOverflow(items.length - fit);
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
      {namedVoters.map((voter, index) => (
        <span
          key={voter.id}
          ref={(el) => { bubbleRefs.current[index] = el; }}
          className={`inline-block shrink-0 px-2.5 py-0.5 rounded-full text-xs font-medium ${getVoterColor(index)}`}
        >
          {voter.voter_name}
        </span>
      ))}
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
        style={{ display: overflow > 0 ? undefined : 'none' }}
      >
        +{overflow}
      </span>
    </div>
  );
}
