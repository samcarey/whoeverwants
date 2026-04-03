"use client";

import { useState, useEffect } from "react";
import { PollResults, OptionsMetadata } from "@/lib/types";
import { apiGetVotes, apiGetParticipants } from "@/lib/api";
import CompactRankedChoiceResults from "./CompactRankedChoiceResults";
import SuggestionsList from "./SuggestionsList";

interface PollResultsProps {
  results: PollResults;
  isPollClosed?: boolean;
  userVoteData?: any;
  onFollowUpClick?: () => void;
  optionsMetadata?: OptionsMetadata | null;
}

export default function PollResultsDisplay({ results, isPollClosed, userVoteData, onFollowUpClick, optionsMetadata }: PollResultsProps) {
  if (results.poll_type === 'yes_no') {
    return <YesNoResults results={results} isPollClosed={isPollClosed} userVoteData={userVoteData} onFollowUpClick={onFollowUpClick} />;
  }

  if (results.poll_type === 'participation') {
    return <ParticipationResults results={results} isPollClosed={isPollClosed} userVoteData={userVoteData} onFollowUpClick={onFollowUpClick} />;
  }

  if (results.poll_type === 'ranked_choice') {
    return <CompactRankedChoiceResults results={results} isPollClosed={isPollClosed} userVoteData={userVoteData} onFollowUpClick={onFollowUpClick} optionsMetadata={optionsMetadata} />;
  }

  if (results.poll_type === 'suggestion') {
    return <SuggestionResults results={results} isPollClosed={isPollClosed} userVoteData={userVoteData} onFollowUpClick={onFollowUpClick} optionsMetadata={optionsMetadata} />;
  }

  return null;
}

function YesNoResults({ results, isPollClosed, userVoteData, onFollowUpClick }: { results: PollResults, isPollClosed?: boolean, userVoteData?: any, onFollowUpClick?: () => void }) {
  const yesCount = results.yes_count || 0;
  const noCount = results.no_count || 0;
  const yesPercentage = results.yes_percentage || 0;
  const noPercentage = results.no_percentage || 0;
  const winner = results.winner;
  const totalVotes = results.total_votes;
  
  // Check if user voted and what they voted for (only show on closed polls in development)
  const userVotedYes = userVoteData?.yes_no_choice === 'yes';
  const userVotedNo = userVoteData?.yes_no_choice === 'no';

  if (totalVotes === 0) {
    return (
      <div className="text-center">
        <p className="text-gray-600 dark:text-gray-400">No Voters</p>
      </div>
    );
  }

  return (
    <div>
      <div className="text-center mb-6">
        <h3 className="text-lg font-semibold mb-2 text-gray-900 dark:text-white">Poll Results</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {totalVotes} total vote{totalVotes !== 1 ? "s" : ""}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        {/* Yes Results */}
        <div className={`p-4 rounded-lg border-2 transition-all ${
          winner === 'yes' 
            ? 'bg-green-100 dark:bg-green-900 border-green-400 dark:border-green-600 shadow-lg' 
            : winner === 'tie'
            ? 'bg-yellow-100 dark:bg-yellow-900/30 border-yellow-400 dark:border-yellow-600'
            : 'bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600'
        }`}>
          <div className="text-center">
            <div className={`text-2xl font-bold mb-1 ${
              winner === 'yes' 
                ? 'text-green-800 dark:text-green-200'
                : winner === 'tie'
                ? 'text-yellow-800 dark:text-yellow-200'
                : 'text-gray-700 dark:text-gray-300'
            }`}>
              {yesPercentage}%
            </div>
            <div className={`text-lg mb-2 ${
              winner === 'yes' 
                ? 'text-green-900 dark:text-green-100 font-bold'
                : winner === 'tie'
                ? 'text-yellow-900 dark:text-yellow-100 font-bold'
                : 'text-gray-600/70 dark:text-gray-400/70 font-medium'
            }`}>
              Yes
            </div>
            <div className={`text-sm ${
              winner === 'yes' 
                ? 'text-green-700 dark:text-green-300' 
                : 'text-gray-500 dark:text-gray-400'
            }`}>
              {yesCount} vote{yesCount !== 1 ? "s" : ""}
            </div>
            {userVotedYes && (
              <div className="mt-2">
                <span className="inline-block px-2 py-1 bg-blue-500 text-white text-xs font-medium rounded-full">
                  Your Vote
                </span>
              </div>
            )}
          </div>
        </div>

        {/* No Results */}
        <div className={`p-4 rounded-lg border-2 transition-all ${
          winner === 'no' 
            ? 'bg-red-100 dark:bg-red-900 border-red-400 dark:border-red-600 shadow-lg' 
            : winner === 'tie'
            ? 'bg-yellow-100 dark:bg-yellow-900/30 border-yellow-400 dark:border-yellow-600'
            : 'bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600'
        }`}>
          <div className="text-center">
            <div className={`text-2xl font-bold mb-1 ${
              winner === 'no' 
                ? 'text-red-800 dark:text-red-200'
                : winner === 'tie'
                ? 'text-yellow-800 dark:text-yellow-200'
                : 'text-gray-700 dark:text-gray-300'
            }`}>
              {noPercentage}%
            </div>
            <div className={`text-lg mb-2 ${
              winner === 'no' 
                ? 'text-red-900 dark:text-red-100 font-bold'
                : winner === 'tie'
                ? 'text-yellow-900 dark:text-yellow-100 font-bold'
                : 'text-gray-600/70 dark:text-gray-400/70 font-medium'
            }`}>
              No
            </div>
            <div className={`text-sm ${
              winner === 'no' 
                ? 'text-red-700 dark:text-red-300' 
                : 'text-gray-500 dark:text-gray-400'
            }`}>
              {noCount} vote{noCount !== 1 ? "s" : ""}
            </div>
            {userVotedNo && (
              <div className="mt-2">
                <span className="inline-block px-2 py-1 bg-blue-500 text-white text-xs font-medium rounded-full">
                  Your Vote
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


function ParticipationResults({ results, isPollClosed, userVoteData, onFollowUpClick }: { results: PollResults, isPollClosed?: boolean, userVoteData?: any, onFollowUpClick?: () => void }) {
  const yesCount = results.yes_count || 0;
  const noCount = results.no_count || 0;
  const totalYesVotes = results.total_yes_votes ?? yesCount;
  const totalVotes = results.total_votes;
  const minParticipants = results.min_participants;
  const maxParticipants = results.max_participants;

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

  // Determine if the event is happening based on participant count being in range
  let isHappening = yesCount > 0;

  if (minParticipants !== undefined && minParticipants !== null) {
    if (yesCount < minParticipants) {
      isHappening = false;
    }
  }

  if (maxParticipants !== undefined && maxParticipants !== null) {
    if (yesCount > maxParticipants) {
      isHappening = false;
    }
  }

  // Generate a detailed reason for why the event isn't happening
  const getFailureReason = (): string => {
    // Nobody responded at all
    if (totalVotes === 0) return 'No responses received';

    // People responded but nobody said yes
    if (totalYesVotes === 0) {
      if (noCount > 0) return `Everyone declined (${noCount} no${noCount !== 1 ? "'s" : ''})`;
      return 'No one volunteered';
    }

    // People said yes but the algorithm couldn't form a compatible group
    if (yesCount === 0 && totalYesVotes > 0) {
      return `${totalYesVotes} wanted to participate but their conditions were incompatible`;
    }

    // Some participants selected but below minimum
    if (minParticipants && yesCount < minParticipants) {
      return `Only ${yesCount} of ${minParticipants} required participants`;
    }

    // Over maximum (shouldn't normally happen, but just in case)
    if (maxParticipants && yesCount > maxParticipants) {
      return `${yesCount} participants exceeded the maximum of ${maxParticipants}`;
    }

    return '';
  };

  const userVotedYes = userVoteData?.yes_no_choice === 'yes';
  const userVotedNo = userVoteData?.yes_no_choice === 'no';

  // Check if user's personal conditions were met
  const userMinParticipants = userVoteData?.min_participants;
  const userMaxParticipants = userVoteData?.max_participants;
  const userConditionsMet = userVotedYes && (
    (userMinParticipants === null || userMinParticipants === undefined || yesCount >= userMinParticipants) &&
    (userMaxParticipants === null || userMaxParticipants === undefined || yesCount <= userMaxParticipants)
  );

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

      return (
        <div className="rounded-lg border-2 bg-green-100 dark:bg-green-900 border-green-400 dark:border-green-600 px-4 py-3">
          <div className="text-center">
            <div className="text-xl font-bold mb-1 text-green-800 dark:text-green-200">
              🎉 You&apos;re participating!
            </div>
            {isAlone ? (
              <div className="text-sm text-green-700 dark:text-green-300">
                😢 All alone
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
              </div>
            )}
          </div>
        </div>
      );
    }

    // Scenario: Event IS happening, user voted YES but is NOT in participant list (needs weren't met)
    if (isHappening && userVotedYes && !userIsInParticipantList) {
      // Explain why the user was excluded
      const userExclusionReason = (() => {
        if (userMaxParticipants !== null && userMaxParticipants !== undefined && yesCount > userMaxParticipants) {
          return `Too many participants for your conditions (max ${userMaxParticipants})`;
        }
        if (userMinParticipants !== null && userMinParticipants !== undefined && yesCount < userMinParticipants) {
          return `Not enough participants for your conditions (min ${userMinParticipants})`;
        }
        return 'Your conditions were incompatible with the group';
      })();

      return (
        <div className="rounded-lg border-2 bg-yellow-100 dark:bg-yellow-900 border-yellow-400 dark:border-yellow-600 px-4 py-3">
          <div className="text-center">
            <div className="text-xl font-bold mb-1 text-yellow-800 dark:text-yellow-200">
              You&apos;re not participating
            </div>
            <div className="text-sm text-yellow-700 dark:text-yellow-300 mb-1">
              {userExclusionReason}
            </div>
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              <span className="text-sm text-yellow-700 dark:text-yellow-300">
                but these are
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
          </div>
        </div>
      );
    }

    // Scenario: Event IS happening, user voted NO or didn't vote
    if (isHappening && (userVotedNo || !userVoteData)) {
      return (
        <div className="rounded-lg border-2 bg-green-100 dark:bg-green-900 border-green-400 dark:border-green-600 px-4 py-3">
          <div className="text-center">
            <div className="text-xl font-bold mb-1 text-green-800 dark:text-green-200">
              You&apos;re not participating
            </div>
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              <span className="text-sm text-green-700 dark:text-green-300">
                but these are
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
          </div>
        </div>
      );
    }

    // Scenario: Event NOT happening, user voted YES
    if (!isHappening && userVotedYes) {
      const failureReason = getFailureReason();

      const userNeedsText = userMinParticipants && userMaxParticipants
        ? `${userMinParticipants}-${userMaxParticipants}`
        : userMinParticipants
        ? `${userMinParticipants}+`
        : userMaxParticipants
        ? `up to ${userMaxParticipants}`
        : null;

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
            {!userIsInParticipantList && userNeedsText && (
              <div className="text-sm text-red-700 dark:text-red-300 opacity-75">
                Your conditions weren&apos;t met ({userNeedsText} participants)
              </div>
            )}
          </div>
        </div>
      );
    }

    // Scenario: Event NOT happening, user voted NO or didn't vote
    if (!isHappening) {
      const failureReason = getFailureReason();

      return (
        <div className="rounded-lg border-2 bg-red-100 dark:bg-red-900 border-red-400 dark:border-red-600 px-4 py-3">
          <div className="text-center">
            <div className="text-xl font-bold mb-1 text-red-800 dark:text-red-200">
              ✗ Not happening
            </div>
            {failureReason && (
              <div className="text-sm text-red-700 dark:text-red-300">
                {failureReason}
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

function SuggestionResults({ results, isPollClosed, userVoteData, onFollowUpClick, optionsMetadata }: { results: PollResults, isPollClosed?: boolean, userVoteData?: any, onFollowUpClick?: () => void, optionsMetadata?: OptionsMetadata | null }) {
  // Use server-side suggestion counts from the results endpoint
  const suggestions = results.suggestion_counts || [];

  const totalVoters = results.total_votes;
  
  // Count of unique suggestion items
  const uniqueSuggestionCount = suggestions.length;

  if (totalVoters === 0) {
    return (
      <div className="text-center">
        <p className="text-gray-600 dark:text-gray-400">No Voters</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {suggestions.length === 0 ? (
          <p className="text-gray-600 dark:text-gray-400 text-center py-4">
            No suggestions available.
          </p>
        ) : (
          <SuggestionsList
            suggestions={suggestions}
            userSuggestions={userVoteData?.suggestions || []}
            showVoteCounts={true}
            showUserIndicator={true}
            optionsMetadata={optionsMetadata}
          />
        )}
      </div>
    </div>
  );
}