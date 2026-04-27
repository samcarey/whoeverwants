"use client";

import { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import { apiGetVotes, ApiVote, QUESTION_VOTES_CHANGED_EVENT } from '@/lib/api';
import { getCachedVotes } from '@/lib/questionCache';
import { getUserName } from '@/lib/userProfile';

interface Voter {
  id: string;
  voter_name: string | null;
}

interface VoterListProps {
  questionId?: string;
  className?: string;
  label?: string;
  filter?: (vote: ApiVote) => boolean;
  /** Single-line overflow mode: hides icon + count, renders one row, and
   *  collapses overflow into a "+N" badge. Used under thread question cards. */
  singleLine?: boolean;
  /** In singleLine mode: text to render (at bubble height) when there are no
   *  voters, so the row doesn't collapse and cause layout shift. Ignored in
   *  multi-line mode. */
  emptyText?: string;
  /** Static / pre-resolved mode (Phase 3.2 poll-level rendering). When
   *  set, VoterList skips `apiGetVotes` entirely and renders from these
   *  props. Use for poll-level voter displays — the parent has
   *  already fetched the poll wrapper (which carries `voter_names` +
   *  `anonymous_count`) and just needs the bubble row. The current viewer
   *  is excluded by `getUserName()` from localStorage, since there's no
   *  per-question voteId to disambiguate by here. */
  staticVoterNames?: string[];
  staticAnonymousCount?: number;
}

// Shared derivation so the synchronous cache-seed and the async fetcher both
// produce identical {voters, anonymousCount, key} shapes from a votes array.
function deriveVoterState(votes: ApiVote[], filter?: (v: ApiVote) => boolean) {
  const filtered = filter ? votes.filter(filter) : votes;
  return {
    voters: filtered.map(v => ({ id: v.id, voter_name: v.voter_name })),
    anonymousCount: filtered.filter(v => !v.voter_name || v.voter_name.trim() === '').length,
    key: filtered.map(v => `${v.id}:${v.voter_name ?? ''}`).join(','),
  };
}

function EmptyPlaceholder({ text, className }: { text: string; className: string }) {
  // Matches the bubble row's height (text-xs 16px + py-0.5 4px = 20px) so the
  // skeleton → empty → populated transitions don't jitter.
  return (
    <div className={`flex items-center gap-1.5 overflow-hidden whitespace-nowrap ${className}`}>
      <span className="text-xs text-gray-500 dark:text-gray-400 py-0.5">{text}</span>
    </div>
  );
}

export default function VoterList({ questionId, className = "", label, filter, singleLine = false, emptyText, staticVoterNames, staticAnonymousCount }: VoterListProps) {
  const isStatic = !!staticVoterNames;

  // Seed from the shared votes cache (or from static props) so warm
  // navigations render bubbles on the first paint instead of flashing
  // the skeleton. useState lazy initializer runs exactly once at mount.
  const [seed] = useState<ReturnType<typeof deriveVoterState> | null>(() => {
    if (typeof window === 'undefined') return null;
    if (isStatic) {
      // In static mode the parent has already fetched the poll
      // wrapper. Fabricate a seed from the names so the rendering path
      // stays identical to the fetched path.
      const names = staticVoterNames ?? [];
      return {
        voters: names.map((n, i) => ({ id: `static-${i}-${n}`, voter_name: n })),
        anonymousCount: staticAnonymousCount ?? 0,
        key: names.join(',') + `|${staticAnonymousCount ?? 0}`,
      };
    }
    if (!questionId) return null;
    const cached = getCachedVotes(questionId);
    return cached ? deriveVoterState(cached, filter) : null;
  });

  const [voters, setVoters] = useState<Voter[]>(seed?.voters ?? []);
  const [initialLoading, setInitialLoading] = useState(seed === null);
  const [error, setError] = useState<string | null>(null);
  const [anonymousCount, setAnonymousCount] = useState(seed?.anonymousCount ?? 0);
  const voterIdsRef = useRef(seed?.key ?? '');

  const fetchVoters = useCallback(async () => {
    if (!questionId) return;
    try {
      const votes = await apiGetVotes(questionId);
      const derived = deriveVoterState(votes, filter);
      if (derived.key !== voterIdsRef.current) {
        voterIdsRef.current = derived.key;
        setVoters(derived.voters);
        setAnonymousCount(derived.anonymousCount);
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
  }, [questionId, filter]);

  // In static mode, sync local state when the props change so a parent
  // re-fetch (e.g. after vote propagation) updates the bubbles.
  useEffect(() => {
    if (!isStatic) return;
    const names = staticVoterNames ?? [];
    const anon = staticAnonymousCount ?? 0;
    const key = names.join(',') + `|${anon}`;
    if (key === voterIdsRef.current) return;
    voterIdsRef.current = key;
    setVoters(names.map((n, i) => ({ id: `static-${i}-${n}`, voter_name: n })));
    setAnonymousCount(anon);
    setInitialLoading(false);
  }, [isStatic, staticVoterNames, staticAnonymousCount]);

  useEffect(() => {
    if (isStatic || !questionId) return;
    fetchVoters();
    const interval = setInterval(fetchVoters, 10000);
    return () => clearInterval(interval);
  }, [isStatic, questionId, fetchVoters]);

  useEffect(() => {
    if (isStatic || !questionId) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { questionId?: string } | undefined;
      if (detail?.questionId === questionId) fetchVoters();
    };
    window.addEventListener(QUESTION_VOTES_CHANGED_EVENT, handler);
    return () => window.removeEventListener(QUESTION_VOTES_CHANGED_EVENT, handler);
  }, [isStatic, questionId, fetchVoters]);

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
            // 20px matches loaded bubble height (text-xs 16px + py-0.5 4px).
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
    if (singleLine && emptyText) return <EmptyPlaceholder text={emptyText} className={className} />;
    return null;
  }

  // Single-question mode: look up the user's voteId by questionId. Static
  // (poll-level) mode: there's no per-question voteId here, so fall back
  // to the saved profile name. Keep the voteId path primary for
  // single-question because it stays correct across rename / inline edits.
  const getUserVoteId = (): string | null => {
    if (typeof window === 'undefined' || !questionId) return null;
    try {
      const questionVoteIds = JSON.parse(localStorage.getItem('questionVoteIds') || '{}');
      return questionVoteIds[questionId] || null;
    } catch {
      return null;
    }
  };

  const currentUserVoteId = isStatic ? null : getUserVoteId();

  // Exclude the current user from the respondents list — their question card
  // signals their vote state (golden border if they haven't voted).
  const allNamedVoters = voters
    .filter(vote => vote.voter_name && vote.voter_name.trim() !== '')
    .sort((a, b) => (a.voter_name || '').toLowerCase().localeCompare((b.voter_name || '').toLowerCase()));

  let namedVoters = currentUserVoteId
    ? allNamedVoters.filter(v => v.id !== currentUserVoteId)
    : allNamedVoters;

  let currentUserIsAnonymous = false;
  if (isStatic) {
    const savedName = (getUserName() || '').trim().toLowerCase();
    if (savedName) {
      namedVoters = namedVoters.filter(v => (v.voter_name || '').trim().toLowerCase() !== savedName);
    }
  } else {
    const currentUserVote = currentUserVoteId
      ? voters.find(v => v.id === currentUserVoteId)
      : null;
    currentUserIsAnonymous = !!(
      currentUserVote && (!currentUserVote.voter_name || currentUserVote.voter_name.trim() === '')
    );
  }
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
    // When the only voter is the current user (excluded since their state
    // lives on the question card itself), fall back to the empty placeholder.
    if (namedVoters.length === 0 && adjustedAnonymousCount === 0 && emptyText) {
      return <EmptyPlaceholder text={emptyText} className={className} />;
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
      // Temporarily force +N visible so we can read its real width even when
      // React currently has it hidden (overflow starts at 0). Without this,
      // offsetWidth returns 0 and reservePlus collapses to just GAP —
      // under-reserving ~20px, which clips the leftmost visible bubble's
      // left edge when justify-end aligns the row to the right edge.
      const plusEl = plusRef.current;
      const prevPlusDisplay = plusEl?.style.display;
      if (plusEl) plusEl.style.display = '';
      const plusWidth = plusEl ? plusEl.offsetWidth : 0;
      if (plusEl) plusEl.style.display = prevPlusDisplay ?? '';
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
