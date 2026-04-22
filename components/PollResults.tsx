"use client";

import { useState, useEffect, useMemo } from "react";
import { PollResults, OptionsMetadata } from "@/lib/types";
import { apiGetVotes, apiGetParticipants } from "@/lib/api";
import CompactRankedChoiceResults from "./CompactRankedChoiceResults";
import {
  formatStackedDayLabel,
  formatTimeSlot,
  getBubbleLabel,
  groupSlotsByDay,
} from "@/lib/timeUtils";


interface PollResultsProps {
  results: PollResults;
  isPollClosed?: boolean;
  userVoteData?: any;
  onFollowUpClick?: () => void;
  optionsMetadata?: OptionsMetadata | null;
  // For yes/no polls: keeps the winner card rendered in a stable DOM
  // position and hides the losing card (via grid-rows animation) when true.
  // Used by the thread view so the winner doesn't flicker across
  // expand/collapse transitions.
  hideLoser?: boolean;
  // For yes/no polls: the current viewer's choice (if voted). When defined
  // along with onVoteChange, the option cards + abstain row become
  // tappable — clicking a different option fires onVoteChange(newChoice).
  userVoteChoice?: 'yes' | 'no' | 'abstain' | null;
  onVoteChange?: (newChoice: 'yes' | 'no' | 'abstain') => void;
}

export default function PollResultsDisplay({ results, isPollClosed, userVoteData, onFollowUpClick, optionsMetadata, hideLoser, userVoteChoice, onVoteChange }: PollResultsProps) {
  if (results.poll_type === 'yes_no') {
    return <YesNoResults results={results} isPollClosed={isPollClosed} userVoteData={userVoteData} onFollowUpClick={onFollowUpClick} hideLoser={hideLoser} userVoteChoice={userVoteChoice} onVoteChange={onVoteChange} />;
  }

  if (results.poll_type === 'participation') {
    return <ParticipationResults results={results} isPollClosed={isPollClosed} userVoteData={userVoteData} onFollowUpClick={onFollowUpClick} />;
  }

  if (results.poll_type === 'ranked_choice') {
    return <CompactRankedChoiceResults results={results} isPollClosed={isPollClosed} userVoteData={userVoteData} onFollowUpClick={onFollowUpClick} optionsMetadata={optionsMetadata} />;
  }

  if (results.poll_type === 'time') {
    return <TimeResults results={results} isPollClosed={isPollClosed} />;
  }

  return null;
}

function YesNoResults({ results, isPollClosed, userVoteData, onFollowUpClick, hideLoser = false, userVoteChoice, onVoteChange }: { results: PollResults, isPollClosed?: boolean, userVoteData?: any, onFollowUpClick?: () => void, hideLoser?: boolean, userVoteChoice?: 'yes' | 'no' | 'abstain' | null, onVoteChange?: (newChoice: 'yes' | 'no' | 'abstain') => void }) {
  const yesCount = results.yes_count || 0;
  const noCount = results.no_count || 0;
  const yesPercentage = results.yes_percentage || 0;
  const noPercentage = results.no_percentage || 0;
  const winner = results.winner;
  const totalVotes = results.total_votes;

  // Prefer the explicit userVoteChoice prop (used by the thread view) over
  // the legacy userVoteData shape so callers can drive the badges + abstain
  // row without needing the full vote object.
  const voteChoice: 'yes' | 'no' | 'abstain' | null =
    userVoteChoice !== undefined
      ? userVoteChoice
      : userVoteData?.is_abstain
        ? 'abstain'
        : userVoteData?.yes_no_choice === 'yes'
          ? 'yes'
          : userVoteData?.yes_no_choice === 'no'
            ? 'no'
            : null;
  const userVotedYes = voteChoice === 'yes';
  const userVotedNo = voteChoice === 'no';
  const userAbstained = voteChoice === 'abstain';
  const canChangeVote = !isPollClosed && !!onVoteChange && voteChoice != null;

  if (totalVotes === 0) {
    return (
      <div className="text-center">
        <p className="text-sm text-gray-600 dark:text-gray-400">No Voters</p>
      </div>
    );
  }

  const yesIsWinner = winner === 'yes';
  const noIsWinner = winner === 'no';
  const isTie = winner === 'tie';

  const renderCard = (side: 'yes' | 'no') => {
    const isYes = side === 'yes';
    const count = isYes ? yesCount : noCount;
    const percentage = isYes ? yesPercentage : noPercentage;
    const isWinner = isYes ? yesIsWinner : noIsWinner;
    const userVoted = isYes ? userVotedYes : userVotedNo;
    const label = isYes ? 'Yes' : 'No';

    const containerClass = isWinner
      ? isYes
        ? 'bg-green-100 dark:bg-green-900 border-green-400 dark:border-green-600 shadow-sm'
        : 'bg-red-100 dark:bg-red-900 border-red-400 dark:border-red-600 shadow-sm'
      : isTie
        ? 'bg-yellow-100 dark:bg-yellow-900/30 border-yellow-400 dark:border-yellow-600'
        : 'bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600';

    const percentClass = isWinner
      ? isYes
        ? 'text-green-800 dark:text-green-200'
        : 'text-red-800 dark:text-red-200'
      : isTie
        ? 'text-yellow-800 dark:text-yellow-200'
        : 'text-gray-700 dark:text-gray-300';

    const labelClass = isWinner
      ? isYes
        ? 'text-green-900 dark:text-green-100 font-bold'
        : 'text-red-900 dark:text-red-100 font-bold'
      : isTie
        ? 'text-yellow-900 dark:text-yellow-100 font-bold'
        : 'text-gray-600/70 dark:text-gray-400/70 font-medium';

    const countClass = isWinner
      ? isYes
        ? 'text-green-700 dark:text-green-300'
        : 'text-red-700 dark:text-red-300'
      : 'text-gray-500 dark:text-gray-400';

    const interactive = canChangeVote && !userVoted;
    const cardClasses = `px-3 py-1.5 rounded-lg border-2 transition-all w-full text-left ${containerClass} ${interactive ? 'cursor-pointer hover:brightness-95 active:scale-[0.99]' : ''}`;

    // "Your Vote" pill sits flush-left; %, label, and vote count flush-right
    // so the layout reads the same whether or not there's a pill.
    const content = (
      <div className="flex items-center gap-2">
        {userVoted && (
          <span className="inline-block px-2 py-0.5 bg-blue-500 text-white text-[10px] font-medium rounded-full">
            Your Vote
          </span>
        )}
        <div className="ml-auto flex items-baseline gap-2">
          <span className={`text-xl font-bold tabular-nums ${percentClass}`}>
            {percentage}%
          </span>
          <span className={`text-base ${labelClass}`}>
            {label}
          </span>
          <span className={`text-xs ${countClass}`}>
            {count} vote{count !== 1 ? 's' : ''}
          </span>
        </div>
      </div>
    );

    if (interactive) {
      return (
        <button
          type="button"
          onClick={() => onVoteChange!(side)}
          className={cardClasses}
        >
          {content}
        </button>
      );
    }
    return <div className={cardClasses}>{content}</div>;
  };

  // Winner on top. Tie → yes first (arbitrary but stable).
  const topSide: 'yes' | 'no' = noIsWinner ? 'no' : 'yes';
  const bottomSide: 'yes' | 'no' = topSide === 'yes' ? 'no' : 'yes';

  // Abstain row — shown only once the viewer has voted (voteChoice != null).
  // Already-abstained: informational gold text. Otherwise: tappable text that
  // matches visual weight so cards + abstain feel like a single control set.
  const abstainRow = voteChoice == null ? null : userAbstained ? (
    <div className="mt-1.5 flex justify-end">
      <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
        You abstained
      </span>
    </div>
  ) : canChangeVote ? (
    <div className="mt-1.5 flex justify-end">
      <button
        type="button"
        onClick={() => onVoteChange!('abstain')}
        className="text-xs text-amber-600 dark:text-amber-400 font-medium hover:underline active:opacity-70"
      >
        Abstain
      </button>
    </div>
  ) : null;

  // The winner card stays in a stable DOM position; the loser is wrapped in
  // a grid-rows [0fr↔1fr] clip so hideLoser toggles it smoothly without
  // re-mounting the winner above it. The inner mt-1.5 gives the 6px gap when
  // expanded and gets clipped to zero when collapsed. The abstain row sits
  // outside the clip — users should see their abstain status even when the
  // card is compact.
  return (
    <div>
      {renderCard(topSide)}
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-out ${hideLoser ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]'}`}
        aria-hidden={hideLoser}
      >
        <div className="overflow-hidden">
          <div className="mt-1.5">{renderCard(bottomSide)}</div>
        </div>
      </div>
      {abstainRow}
    </div>
  );
}


function ParticipationResults({ results, isPollClosed, userVoteData, onFollowUpClick }: { results: PollResults, isPollClosed?: boolean, userVoteData?: any, onFollowUpClick?: () => void }) {
  const yesCount = results.yes_count || 0;        // participants selected by algorithm
  const noCount = results.no_count || 0;
  const abstainCount = results.abstain_count || 0;
  const totalYesVotes = results.total_yes_votes ?? yesCount;  // raw yes votes before algorithm
  const totalVotes = results.total_votes;
  const minParticipants = results.min_participants;
  const maxParticipants = results.max_participants;
  const excludedYesVoters = totalYesVotes - yesCount;  // said yes but didn't make the cut

  const [participants, setParticipants] = useState<{id: string, voter_name: string | null, vote_id?: string}[]>([]);
  const [allVoters, setAllVoters] = useState<{id: string, voter_name: string | null}[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch participants who are actually participating (based on priority algorithm)
  // AND all voters to establish color mapping
  useEffect(() => {
    const fetchParticipants = async () => {
      try {
        // Get all voters to establish consistent color mapping
        try {
          const allVotes = await apiGetVotes(results.poll_id);
          const sortedVoters = allVotes
            .filter(v => v.voter_name && v.voter_name.trim() !== '')
            .sort((a, b) => {
              const nameA = (a.voter_name || '').toLowerCase();
              const nameB = (b.voter_name || '').toLowerCase();
              return nameA.localeCompare(nameB);
            });
          setAllVoters(sortedVoters);
        } catch (votersError) {
          console.error('Error fetching all voters:', votersError);
          setAllVoters([]);
        }

        // Fetch participating voters from the priority algorithm
        const participantList = await apiGetParticipants(results.poll_id);
        setParticipants(participantList.map(p => ({
          id: p.vote_id,
          voter_name: p.voter_name,
          vote_id: p.vote_id,
        })));
      } catch (err) {
        console.error('Error loading participants:', err);
        setParticipants([]);
      } finally {
        setLoading(false);
      }
    };

    fetchParticipants();
  }, [results.poll_id]);

  const isHappening = yesCount > 0
    && (minParticipants == null || yesCount >= minParticipants)
    && (maxParticipants == null || yesCount <= maxParticipants);

  // Generate a detailed reason for why the event isn't happening
  // When isCurrentUserYesVoter is true, uses "you" language instead of third-person
  const getFailureReason = (isCurrentUserYesVoter: boolean = false): string => {
    if (totalVotes === 0) return 'No responses received';

    if (totalYesVotes === 0) {
      if (noCount > 0 && abstainCount > 0) return `${noCount} declined, ${abstainCount} abstained — no one said yes`;
      if (noCount > 0) return `All ${noCount} respondent${noCount !== 1 ? 's' : ''} declined`;
      if (abstainCount > 0) return `All ${abstainCount} respondent${abstainCount !== 1 ? 's' : ''} abstained`;
      return 'No one said yes';
    }

    if (yesCount === 0 && totalYesVotes > 0) {
      if (isCurrentUserYesVoter && totalYesVotes === 1) {
        const conds = formatConditions(userMinParticipants, userMaxParticipants);
        if (conds) return `You wanted ${conds}, but no one else said yes`;
        return 'No one else said yes, so your conditions couldn\u2019t be met';
      }
      if (isCurrentUserYesVoter) {
        const othersCount = totalYesVotes - 1;
        const conds = formatConditions(userMinParticipants, userMaxParticipants);
        const base = `You and ${othersCount} other${othersCount !== 1 ? 's' : ''} wanted to join, but everyone\u2019s conditions were incompatible`;
        if (conds) return `${base} (you wanted ${conds})`;
        return base;
      }
      if (totalYesVotes === 1) return '1 person wanted to join but their conditions couldn\u2019t be satisfied';
      return `${totalYesVotes} people wanted to join but their conditions were incompatible`;
    }

    if (minParticipants && yesCount < minParticipants) {
      const shortBy = minParticipants - yesCount;
      return `${yesCount} participant${yesCount !== 1 ? 's' : ''} — ${shortBy} short of the ${minParticipants} required`;
    }

    if (maxParticipants && yesCount > maxParticipants) {
      return `${yesCount} participants exceeded the maximum of ${maxParticipants}`;
    }

    return '';
  };

  // Build a compact vote breakdown string
  const getVoteBreakdown = (): string => {
    const parts: string[] = [];
    if (totalYesVotes > 0) parts.push(`${totalYesVotes} yes`);
    if (noCount > 0) parts.push(`${noCount} no`);
    if (abstainCount > 0) parts.push(`${abstainCount} abstain`);
    if (parts.length === 0) return '';
    return parts.join(', ');
  };

  // Format a min/max constraint as readable text
  const formatConditions = (min: number | null | undefined, max: number | null | undefined): string | null => {
    const hasMin = min !== null && min !== undefined;
    const hasMax = max !== null && max !== undefined;
    if (!hasMin && !hasMax) return null;
    if (hasMin && hasMax) {
      if (min === max) return `exactly ${min} participant${min !== 1 ? 's' : ''}`;
      return `${min}–${max} participants`;
    }
    if (hasMin) return `at least ${min} participant${min !== 1 ? 's' : ''}`;
    return `at most ${max} participant${max !== 1 ? 's' : ''}`;
  };

  // Build explanation for why the user specifically was excluded
  const getUserExclusionReason = (): string => {
    if (userMaxParticipants != null && yesCount > userMaxParticipants) {
      return `You set a max of ${userMaxParticipants} participant${userMaxParticipants !== 1 ? 's' : ''}, but ${yesCount} were selected`;
    }
    if (userMinParticipants != null && yesCount < userMinParticipants) {
      return `You required at least ${userMinParticipants} participant${userMinParticipants !== 1 ? 's' : ''}, but only ${yesCount} ${yesCount !== 1 ? 'were' : 'was'} selected`;
    }
    return 'Your conditions were incompatible with the selected group';
  };

  const userVotedYes = userVoteData?.yes_no_choice === 'yes';
  const userVotedNo = userVoteData?.yes_no_choice === 'no';

  const userMinParticipants = userVoteData?.min_participants;
  const userMaxParticipants = userVoteData?.max_participants;

  // Check if current user is in the participant list (by vote ID)
  const userVoteId = userVoteData?.id;
  const userIsInParticipantList = participants.some(p => p.vote_id === userVoteId);

  // Get named participants and sort alphabetically
  const namedParticipants = participants
    .filter(p => p.voter_name && p.voter_name.trim() !== '')
    .sort((a, b) => {
      const nameA = (a.voter_name || '').toLowerCase();
      const nameB = (b.voter_name || '').toLowerCase();
      return nameA.localeCompare(nameB);
    });

  // Count all anonymous participants
  const anonymousParticipantCount = participants.filter(p => !p.voter_name || p.voter_name.trim() === '').length;

  // Generate consistent colors for participant bubbles based on vote_id
  // This matches the color assigned in VoterList by finding the voter's index in the sorted list
  const getParticipantColor = (voteId: string, isCurrentUser: boolean) => {
    if (isCurrentUser) {
      return 'bg-blue-500 text-white dark:bg-blue-600 dark:text-white font-bold ring-2 ring-blue-300 dark:ring-blue-400';
    }

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

    // Find the index of this vote_id in the allVoters array (which matches VoterList sorting)
    const voterIndex = allVoters.findIndex(v => v.id === voteId);
    if (voterIndex === -1) {
      // Fallback: if not found in allVoters, use first color
      return colors[0];
    }

    return colors[voterIndex % colors.length];
  };

  // Wait for participant data before rendering status
  if (loading) {
    return (
      <div className="rounded-lg border-2 bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-600 px-4 py-3">
        <div className="text-center">
          <div className="text-gray-500 dark:text-gray-400 animate-pulse">
            Loading results...
          </div>
        </div>
      </div>
    );
  }

  // SCENARIO: No votes at all
  if (totalVotes === 0) {
    return (
      <div className="rounded-lg border-2 bg-red-100 dark:bg-red-900 border-red-400 dark:border-red-600 px-4 py-3">
        <div className="text-center">
          <div className="text-xl font-bold mb-1 text-red-800 dark:text-red-200">
            ✗ Not happening
          </div>
          <div className="text-sm text-red-700 dark:text-red-300">
            No responses received
          </div>
        </div>
      </div>
    );
  }

  // CLOSED POLL SCENARIOS
  if (isPollClosed) {
    // Scenario: Event IS happening, user voted YES and is in the participating list
    if (isHappening && userVotedYes && userIsInParticipantList) {
      // Filter out current user from participant list
      const otherParticipants = namedParticipants.filter(p => p.vote_id !== userVoteId);
      const otherAnonymousCount = participants.filter(p =>
        (!p.voter_name || p.voter_name.trim() === '') && p.vote_id !== userVoteId
      ).length;
      const isAlone = participants.length === 1;
      const breakdown = getVoteBreakdown();

      return (
        <div className="rounded-lg border-2 bg-green-100 dark:bg-green-900 border-green-400 dark:border-green-600 px-4 py-3">
          <div className="text-center">
            <div className="text-xl font-bold mb-1 text-green-800 dark:text-green-200">
              🎉 You&apos;re participating!
            </div>
            {isAlone ? (
              <div className="text-sm text-green-700 dark:text-green-300">
                Just you so far
                {excludedYesVoters > 0 && ` — ${excludedYesVoters} other${excludedYesVoters !== 1 ? 's' : ''} wanted to but couldn\u2019t`}
              </div>
            ) : (
              <div>
                <div className="text-xs text-green-700 dark:text-green-300 mb-1">
                  along with
                </div>
                <div className="flex flex-wrap items-center justify-center gap-1.5">
                  {/* Other named participants */}
                  {otherParticipants.map((participant) => (
                    <span
                      key={participant.id}
                      className={`inline-block px-2 py-0.5 rounded-full text-sm ${getParticipantColor(participant.vote_id!, false)}`}
                    >
                      {participant.voter_name}
                    </span>
                  ))}

                  {/* Anonymous participants (excluding current user) */}
                  {otherAnonymousCount > 0 && (
                    <div className="inline-block px-2 py-0.5 bg-gray-100 dark:bg-gray-700 rounded-full border border-gray-300 dark:border-gray-600">
                      <span className="text-sm text-gray-600 dark:text-gray-300 italic">
                        {otherAnonymousCount} × Anonymous
                      </span>
                    </div>
                  )}
                </div>
                {excludedYesVoters > 0 && (
                  <div className="text-xs text-green-600 dark:text-green-400 opacity-75 mt-1">
                    {excludedYesVoters} other{excludedYesVoters !== 1 ? 's' : ''} wanted to join but couldn&apos;t
                  </div>
                )}
              </div>
            )}
            {breakdown && (
              <div className="text-xs text-green-600 dark:text-green-400 opacity-75 mt-1">
                Responses: {breakdown}
              </div>
            )}
          </div>
        </div>
      );
    }

    // Scenario: Event IS happening, user voted YES but is NOT in participant list (needs weren't met)
    if (isHappening && userVotedYes && !userIsInParticipantList) {
      const exclusionReason = getUserExclusionReason();
      const breakdown = getVoteBreakdown();

      return (
        <div className="rounded-lg border-2 bg-yellow-100 dark:bg-yellow-900 border-yellow-400 dark:border-yellow-600 px-4 py-3">
          <div className="text-center">
            <div className="text-xl font-bold mb-1 text-yellow-800 dark:text-yellow-200">
              You&apos;re not participating
            </div>
            <div className="text-sm text-yellow-700 dark:text-yellow-300 mb-2">
              {exclusionReason}
            </div>
            <div className="flex flex-wrap items-center justify-center gap-1.5 mb-2">
              <span className="text-sm text-yellow-700 dark:text-yellow-300">
                Going without you:
              </span>
              {/* Named participants */}
              {namedParticipants.map((participant) => (
                <span
                  key={participant.id}
                  className={`inline-block px-2 py-0.5 rounded-full text-sm ${getParticipantColor(participant.vote_id!, false)}`}
                >
                  {participant.voter_name}
                </span>
              ))}

              {/* Anonymous participants */}
              {anonymousParticipantCount > 0 && (
                <div className="inline-block px-2 py-0.5 bg-gray-100 dark:bg-gray-700 rounded-full border border-gray-300 dark:border-gray-600">
                  <span className="text-sm text-gray-600 dark:text-gray-300 italic">
                    {anonymousParticipantCount} × Anonymous
                  </span>
                </div>
              )}
            </div>
            {breakdown && (
              <div className="text-xs text-yellow-600 dark:text-yellow-400 opacity-75">
                Responses: {breakdown}
                {excludedYesVoters > 0 && ` (${excludedYesVoters} other${excludedYesVoters !== 1 ? 's' : ''} also excluded)`}
              </div>
            )}
          </div>
        </div>
      );
    }

    // Scenario: Event IS happening, user voted NO or didn't vote
    if (isHappening && (userVotedNo || !userVoteData)) {
      const breakdown = getVoteBreakdown();
      const userAbstained = userVoteData?.is_abstain;
      const statusLine = userAbstained
        ? 'You abstained'
        : userVotedNo
        ? 'You declined'
        : 'You didn\u2019t vote';

      return (
        <div className="rounded-lg border-2 bg-green-100 dark:bg-green-900 border-green-400 dark:border-green-600 px-4 py-3">
          <div className="text-center">
            <div className="text-xl font-bold mb-1 text-green-800 dark:text-green-200">
              It&apos;s happening!
            </div>
            <div className="text-sm text-green-700 dark:text-green-300 mb-1">
              {statusLine} — {yesCount} participant{yesCount !== 1 ? 's' : ''} going
            </div>
            <div className="flex flex-wrap items-center justify-center gap-1.5 mb-2">
              {/* Named participants */}
              {namedParticipants.map((participant) => (
                <span
                  key={participant.id}
                  className={`inline-block px-2 py-0.5 rounded-full text-sm ${getParticipantColor(participant.vote_id!, false)}`}
                >
                  {participant.voter_name}
                </span>
              ))}

              {/* Anonymous participants */}
              {anonymousParticipantCount > 0 && (
                <div className="inline-block px-2 py-0.5 bg-gray-100 dark:bg-gray-700 rounded-full border border-gray-300 dark:border-gray-600">
                  <span className="text-sm text-gray-600 dark:text-gray-300 italic">
                    {anonymousParticipantCount} × Anonymous
                  </span>
                </div>
              )}
            </div>
            {breakdown && (
              <div className="text-xs text-green-600 dark:text-green-400 opacity-75">
                Responses: {breakdown}
              </div>
            )}
          </div>
        </div>
      );
    }

    // Scenario: Event NOT happening, user voted YES
    if (!isHappening && userVotedYes) {
      const failureReason = getFailureReason(true);
      const breakdown = getVoteBreakdown();
      const userConditionsText = formatConditions(userMinParticipants, userMaxParticipants);

      // Only show the user's conditions separately if the failure reason doesn't already
      // explain them (i.e. it's a poll-level constraint failure, not a user-conditions failure)
      const showUserConditions = userConditionsText
        && yesCount > 0  // if yesCount === 0, the failure reason already covers conditions
        && minParticipants && yesCount < minParticipants;  // poll-level min not met

      return (
        <div className="rounded-lg border-2 bg-red-100 dark:bg-red-900 border-red-400 dark:border-red-600 px-4 py-3">
          <div className="text-center">
            <div className="text-xl font-bold mb-1 text-red-800 dark:text-red-200">
              ✗ Not happening
            </div>
            {failureReason && (
              <div className="text-sm text-red-700 dark:text-red-300 mb-1">
                {failureReason}
              </div>
            )}
            {showUserConditions && (
              <div className="text-sm text-red-700 dark:text-red-300 opacity-75 mb-1">
                Your conditions: {userConditionsText}
              </div>
            )}
            {breakdown && (
              <div className="text-xs text-red-600 dark:text-red-400 opacity-75">
                Responses: {breakdown}
              </div>
            )}
          </div>
        </div>
      );
    }

    // Scenario: Event NOT happening, user voted NO or didn't vote
    if (!isHappening) {
      const failureReason = getFailureReason();
      const breakdown = getVoteBreakdown();

      return (
        <div className="rounded-lg border-2 bg-red-100 dark:bg-red-900 border-red-400 dark:border-red-600 px-4 py-3">
          <div className="text-center">
            <div className="text-xl font-bold mb-1 text-red-800 dark:text-red-200">
              ✗ Not happening
            </div>
            {failureReason && (
              <div className="text-sm text-red-700 dark:text-red-300 mb-1">
                {failureReason}
              </div>
            )}
            {breakdown && (
              <div className="text-xs text-red-600 dark:text-red-400 opacity-75">
                Responses: {breakdown}
              </div>
            )}
          </div>
        </div>
      );
    }
  }

  // OPEN POLL: Show live status without revealing results details
  return (
    <div className="text-center">
      <div className="text-gray-600 dark:text-gray-400 text-sm">
        Poll is still open - results will show when closed
      </div>
    </div>
  );
}

function TimeResults({ results, isPollClosed }: { results: PollResults; isPollClosed?: boolean }) {
  const winner = results.winner;
  const options = results.options ?? [];
  const availCounts = results.availability_counts;
  const maxAvail = results.max_availability;
  const likeCounts = results.like_counts;
  const dislikeCounts = results.dislike_counts;

  // Slot keys ("YYYY-MM-DD HH:MM-HH:MM") already arrive in chronological
  // order from the backend, so no sort is needed before grouping.
  const slotsByDay = useMemo(() => groupSlotsByDay(options), [options]);

  if (!isPollClosed) {
    return (
      <div className="text-center py-3">
        <div className="text-gray-600 dark:text-gray-400 text-sm">
          Results will show when the poll closes
        </div>
      </div>
    );
  }

  if (options.length === 0) {
    return (
      <div className="text-center py-4">
        <p className="text-gray-600 dark:text-gray-400">No time slots met the availability threshold.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {winner && (
        <div className="text-center">
          <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Scheduled Time</p>
          <div className="inline-flex items-center px-4 py-2 bg-green-100 dark:bg-green-900 border border-green-300 dark:border-green-700 rounded-xl">
            <span className="text-sm font-semibold text-green-800 dark:text-green-200">
              {formatTimeSlot(winner)}
            </span>
          </div>
          {maxAvail != null && availCounts?.[winner] != null && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
              {availCounts[winner]} of {maxAvail} available
            </p>
          )}
        </div>
      )}

      {options.length > 1 && (
        <div>
          <div className="flex items-baseline justify-between gap-3 mb-3">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Candidate Slots ({options.length})
            </h3>
            <div className="flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400 flex-shrink-0">
              <span className="inline-flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500" /> liked
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500" /> disliked
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-orange-500" /> unavail.
              </span>
            </div>
          </div>
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {slotsByDay.map(([dateStr, slots]) => {
              const { weekday, monthDay } = formatStackedDayLabel(dateStr);
              return (
                <div key={dateStr} className="flex gap-2 items-start py-3 first:pt-0 last:pb-0">
                  <div className="w-12 shrink-0 pt-1 text-xs font-medium text-gray-500 dark:text-gray-400 text-left leading-tight">
                    <div>{weekday}</div>
                    <div>{monthDay}</div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {slots.map((slot, idx) => {
                      const label = getBubbleLabel(slot, idx > 0 ? slots[idx - 1] : null);
                      const likes = likeCounts?.[slot] ?? 0;
                      const dislikes = dislikeCounts?.[slot] ?? 0;
                      const unavailable =
                        maxAvail != null && availCounts?.[slot] != null
                          ? maxAvail - availCounts[slot]
                          : 0;
                      const isWinner = slot === winner;

                      return (
                        <div
                          key={slot}
                          title={formatTimeSlot(slot)}
                          className={[
                            "relative w-12 h-8 flex items-center justify-center rounded-full text-[0.9rem] font-medium tabular-nums leading-none bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300",
                            isWinner
                              ? "border-2 border-green-500 shadow-sm"
                              : "border border-gray-300 dark:border-gray-600",
                          ].join(" ")}
                        >
                          <span className="block cap-height-text">{label}</span>
                          {likes > 0 && (
                            <span className="absolute -top-1.5 -right-1.5 flex h-[18px] min-w-[18px] px-1 items-center justify-center rounded-full bg-green-500 text-[10px] font-bold text-white leading-none ring-1 ring-white dark:ring-gray-900">
                              {likes}
                            </span>
                          )}
                          {dislikes > 0 && (
                            <span className="absolute -top-1.5 -left-1.5 flex h-[18px] min-w-[18px] px-1 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white leading-none ring-1 ring-white dark:ring-gray-900">
                              {dislikes}
                            </span>
                          )}
                          {unavailable > 0 && (
                            <span className="absolute -bottom-1.5 -right-1.5 flex h-[18px] min-w-[18px] px-1 items-center justify-center rounded-full bg-orange-500 text-[10px] font-bold text-white leading-none ring-1 ring-white dark:ring-gray-900">
                              {unavailable}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

