"use client";

import { useState, useEffect } from "react";
import { PollResults } from "@/lib/types";
import { apiGetVotes, apiGetParticipants } from "@/lib/api";
import CompactRankedChoiceResults from "./CompactRankedChoiceResults";
import NominationsList from "./NominationsList";

interface PollResultsProps {
  results: PollResults;
  isPollClosed?: boolean;
  userVoteData?: any;
  onFollowUpClick?: () => void;
}

export default function PollResultsDisplay({ results, isPollClosed, userVoteData, onFollowUpClick }: PollResultsProps) {
  // 2-option ranked_choice polls get the simplified two-column results UI
  const isTwoOptionPoll = results.poll_type === 'ranked_choice' && results.options && results.options.length === 2;

  if (isTwoOptionPoll) {
    return <TwoOptionResults results={results} isPollClosed={isPollClosed} userVoteData={userVoteData} onFollowUpClick={onFollowUpClick} />;
  }

  if (results.poll_type === 'participation') {
    return <ParticipationResults results={results} isPollClosed={isPollClosed} userVoteData={userVoteData} onFollowUpClick={onFollowUpClick} />;
  }

  if (results.poll_type === 'ranked_choice') {
    return <CompactRankedChoiceResults results={results} isPollClosed={isPollClosed} userVoteData={userVoteData} onFollowUpClick={onFollowUpClick} />;
  }

  if (results.poll_type === 'nomination') {
    return <NominationResults results={results} isPollClosed={isPollClosed} userVoteData={userVoteData} onFollowUpClick={onFollowUpClick} />;
  }

  return null;
}

function TwoOptionResults({ results, isPollClosed, userVoteData, onFollowUpClick }: { results: PollResults, isPollClosed?: boolean, userVoteData?: any, onFollowUpClick?: () => void }) {
  const options = results.options || ['Yes', 'No'];
  const optionA = options[0];
  const optionB = options[1];

  // Compute counts from ranked_choice_rounds if API doesn't provide yes_count/no_count
  const roundA = results.ranked_choice_rounds?.find(r => r.option_name === optionA);
  const roundB = results.ranked_choice_rounds?.find(r => r.option_name === optionB);

  const yesCount = results.yes_count ?? roundA?.vote_count ?? 0;
  const noCount = results.no_count ?? roundB?.vote_count ?? 0;
  const totalVotes = results.total_votes;
  const countTotal = yesCount + noCount + (results.abstain_count ?? (totalVotes - yesCount - noCount));
  const yesPercentage = results.yes_percentage ?? (countTotal > 0 ? Math.round((yesCount / countTotal) * 100) : 0);
  const noPercentage = results.no_percentage ?? (countTotal > 0 ? Math.round((noCount / countTotal) * 100) : 0);
  const winner = results.winner;

  // Check if user voted and what they voted for via ranked_choices
  const userFirstChoice = userVoteData?.ranked_choices?.[0];
  const userVotedYes = userFirstChoice === optionA;
  const userVotedNo = userFirstChoice === optionB;

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
        {/* Option A Results */}
        <div className={`p-4 rounded-lg border-2 transition-all ${
          winner === optionA
            ? 'bg-green-100 dark:bg-green-900 border-green-400 dark:border-green-600 shadow-lg'
            : winner === 'tie'
            ? 'bg-yellow-100 dark:bg-yellow-900/30 border-yellow-400 dark:border-yellow-600'
            : 'bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600'
        }`}>
          <div className="text-center">
            <div className={`text-2xl font-bold mb-1 ${
              winner === optionA
                ? 'text-green-800 dark:text-green-200'
                : winner === 'tie'
                ? 'text-yellow-800 dark:text-yellow-200'
                : 'text-gray-700 dark:text-gray-300'
            }`}>
              {yesPercentage}%
            </div>
            <div className={`text-lg mb-2 ${
              winner === optionA
                ? 'text-green-900 dark:text-green-100 font-bold'
                : winner === 'tie'
                ? 'text-yellow-900 dark:text-yellow-100 font-bold'
                : 'text-gray-600/70 dark:text-gray-400/70 font-medium'
            }`}>
              {optionA}
            </div>
            <div className={`text-sm ${
              winner === optionA
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

        {/* Option B Results */}
        <div className={`p-4 rounded-lg border-2 transition-all ${
          winner === optionB
            ? 'bg-red-100 dark:bg-red-900 border-red-400 dark:border-red-600 shadow-lg'
            : winner === 'tie'
            ? 'bg-yellow-100 dark:bg-yellow-900/30 border-yellow-400 dark:border-yellow-600'
            : 'bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600'
        }`}>
          <div className="text-center">
            <div className={`text-2xl font-bold mb-1 ${
              winner === optionB
                ? 'text-red-800 dark:text-red-200'
                : winner === 'tie'
                ? 'text-yellow-800 dark:text-yellow-200'
                : 'text-gray-700 dark:text-gray-300'
            }`}>
              {noPercentage}%
            </div>
            <div className={`text-lg mb-2 ${
              winner === optionB
                ? 'text-red-900 dark:text-red-100 font-bold'
                : winner === 'tie'
                ? 'text-yellow-900 dark:text-yellow-100 font-bold'
                : 'text-gray-600/70 dark:text-gray-400/70 font-medium'
            }`}>
              {optionB}
            </div>
            <div className={`text-sm ${
              winner === optionB
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
  let statusMessage = '';

  if (minParticipants !== undefined && minParticipants !== null) {
    if (yesCount < minParticipants) {
      isHappening = false;
      statusMessage = `Need at least ${minParticipants} participants`;
    }
  }

  if (maxParticipants !== undefined && maxParticipants !== null) {
    if (yesCount > maxParticipants) {
      isHappening = false;
      statusMessage = `Maximum ${maxParticipants} participants exceeded`;
    }
  }

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

  // SCENARIO: No votes at all
  if (totalVotes === 0) {
    return (
      <div className="rounded-lg border-2 bg-red-100 dark:bg-red-900 border-red-400 dark:border-red-600 p-6">
        <div className="text-center">
          <div className="text-2xl font-bold mb-2 text-red-800 dark:text-red-200">
            Not happening
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
        <div className="rounded-lg border-2 bg-green-100 dark:bg-green-900 border-green-400 dark:border-green-600 p-6">
          <div className="text-center">
            <div className="text-2xl font-bold mb-4 text-green-800 dark:text-green-200">
              🎉 You&apos;re participating!
            </div>
            {isAlone ? (
              <div className="text-lg text-green-700 dark:text-green-300">
                😢 All alone
              </div>
            ) : (
              <div>
                <div className="text-sm text-green-700 dark:text-green-300 mb-2">
                  along with
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {/* Other named participants */}
                  {otherParticipants.map((participant) => (
                    <span
                      key={participant.id}
                      className={`inline-block px-3 py-1 rounded-full text-sm ${getParticipantColor(participant.vote_id!, false)}`}
                    >
                      {participant.voter_name}
                    </span>
                  ))}

                  {/* Anonymous participants (excluding current user) */}
                  {otherAnonymousCount > 0 && (
                    <div className="inline-block px-3 py-1 bg-gray-100 dark:bg-gray-700 rounded-full border border-gray-300 dark:border-gray-600">
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
      return (
        <div className="rounded-lg border-2 bg-yellow-100 dark:bg-yellow-900 border-yellow-400 dark:border-yellow-600 p-6">
          <div className="text-center">
            <div className="text-2xl font-bold mb-4 text-yellow-800 dark:text-yellow-200">
              You&apos;re not participating
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <span className="text-sm text-yellow-700 dark:text-yellow-300">
                but these are
              </span>
              {/* Named participants */}
              {namedParticipants.map((participant) => (
                <span
                  key={participant.id}
                  className={`inline-block px-3 py-1 rounded-full text-sm ${getParticipantColor(participant.vote_id!, false)}`}
                >
                  {participant.voter_name}
                </span>
              ))}

              {/* Anonymous participants */}
              {anonymousParticipantCount > 0 && (
                <div className="inline-block px-3 py-1 bg-gray-100 dark:bg-gray-700 rounded-full border border-gray-300 dark:border-gray-600">
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
        <div className="rounded-lg border-2 bg-green-100 dark:bg-green-900 border-green-400 dark:border-green-600 p-6">
          <div className="text-center">
            <div className="text-2xl font-bold mb-4 text-green-800 dark:text-green-200">
              You&apos;re not participating
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <span className="text-sm text-green-700 dark:text-green-300">
                but these are
              </span>
              {/* Named participants */}
              {namedParticipants.map((participant) => (
                <span
                  key={participant.id}
                  className={`inline-block px-3 py-1 rounded-full text-sm ${getParticipantColor(participant.vote_id!, false)}`}
                >
                  {participant.voter_name}
                </span>
              ))}

              {/* Anonymous participants */}
              {anonymousParticipantCount > 0 && (
                <div className="inline-block px-3 py-1 bg-gray-100 dark:bg-gray-700 rounded-full border border-gray-300 dark:border-gray-600">
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
      // If no one is participating at all, use simplified message
      if (yesCount === 0) {
        return (
          <div className="rounded-lg border-2 bg-red-100 dark:bg-red-900 border-red-400 dark:border-red-600 px-4 py-3">
            <div className="text-center">
              <div className="text-xl font-bold text-red-800 dark:text-red-200">
                No one is participating
              </div>
            </div>
          </div>
        );
      }

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
            <div className="text-sm text-red-700 dark:text-red-300 mb-2">
              Final: {yesCount} participant{yesCount !== 1 ? "s" : ""}
              {(minParticipants || maxParticipants) && (
                <> (needed {minParticipants && maxParticipants ? `${minParticipants}-${maxParticipants}` : minParticipants ? `${minParticipants}+` : `up to ${maxParticipants}`})</>
              )}
            </div>
            {userNeedsText && (
              <div className="text-sm text-red-700 dark:text-red-300 opacity-75">
                Your needs weren&apos;t met ({userNeedsText})
              </div>
            )}
          </div>
        </div>
      );
    }

    // Scenario: Event NOT happening, user voted NO or didn't vote
    if (!isHappening) {
      // Check if there are no participants at all
      if (yesCount === 0) {
        return (
          <div className="rounded-lg border-2 bg-red-100 dark:bg-red-900 border-red-400 dark:border-red-600 p-6">
            <div className="text-center">
              <div className="text-xl font-bold text-red-800 dark:text-red-200">
                No one is participating
              </div>
            </div>
          </div>
        );
      }

      return (
        <div className="rounded-lg border-2 bg-red-100 dark:bg-red-900 border-red-400 dark:border-red-600 p-6">
          <div className="text-center">
            <div className="text-xl font-bold mb-2 text-red-800 dark:text-red-200">
              ✗ Not happening
            </div>
            <div className="text-sm text-red-700 dark:text-red-300">
              Final: {yesCount} participant{yesCount !== 1 ? "s" : ""}
              {(minParticipants || maxParticipants) && (
                <> (needed {minParticipants && maxParticipants ? `${minParticipants}-${maxParticipants}` : minParticipants ? `${minParticipants}+` : `up to ${maxParticipants}`})</>
              )}
            </div>
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

function NominationResults({ results, isPollClosed, userVoteData, onFollowUpClick }: { results: PollResults, isPollClosed?: boolean, userVoteData?: any, onFollowUpClick?: () => void }) {
  // Use server-side nomination counts from the results endpoint
  const nominations = results.nomination_counts || [];

  const totalVoters = results.total_votes;
  
  // Count of unique nomination items
  const uniqueNominationCount = nominations.length;

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
        {nominations.length === 0 ? (
          <p className="text-gray-600 dark:text-gray-400 text-center py-4">
            No suggestions available.
          </p>
        ) : (
          <NominationsList
            nominations={nominations}
            userNominations={userVoteData?.nominations || []}
            showVoteCounts={true}
            showUserIndicator={true}
          />
        )}
      </div>
    </div>
  );
}