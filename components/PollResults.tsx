"use client";

import { useState, useEffect } from "react";
import { PollResults, RankedChoiceRound, getRankedChoiceRounds, supabase } from "@/lib/supabase";
import CompactRankedChoiceResults from "./CompactRankedChoiceResults";
import NominationsList from "./NominationsList";

interface PollResultsProps {
  results: PollResults;
  isPollClosed?: boolean;
  userVoteData?: any;
  onFollowUpClick?: () => void;
}

export default function PollResultsDisplay({ results, isPollClosed, userVoteData, onFollowUpClick }: PollResultsProps) {
  if (results.poll_type === 'yes_no') {
    return <YesNoResults results={results} isPollClosed={isPollClosed} userVoteData={userVoteData} onFollowUpClick={onFollowUpClick} />;
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

function YesNoResults({ results, isPollClosed, userVoteData, onFollowUpClick }: { results: PollResults, isPollClosed?: boolean, userVoteData?: any, onFollowUpClick?: () => void }) {
  const yesCount = results.yes_count || 0;
  const noCount = results.no_count || 0;
  const yesPercentage = results.yes_percentage || 0;
  const noPercentage = results.no_percentage || 0;
  const winner = results.winner;
  const totalVotes = results.total_votes;
  
  // Check if user voted and what they voted for (only show on closed polls in development)
  const isDev = process.env.NODE_ENV === 'development';
  const userVotedYes = isDev && isPollClosed && userVoteData?.yes_no_choice === 'yes';
  const userVotedNo = isDev && isPollClosed && userVoteData?.yes_no_choice === 'no';

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
          {totalVotes} total vote{totalVotes !== 1 ? 's' : ''}
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
              {yesCount} vote{yesCount !== 1 ? 's' : ''}
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
              {noCount} vote{noCount !== 1 ? 's' : ''}
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

function RankedChoiceResults({ results }: { results: PollResults }) {
  const [rounds, setRounds] = useState<RankedChoiceRound[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchRounds() {
      try {
        const roundData = await getRankedChoiceRounds(results.poll_id);
        setRounds(roundData);
      } catch (error) {
        console.error('Error fetching ranked choice rounds:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchRounds();
  }, [results.poll_id]);

  if (loading) {
    return (
      <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-6 text-center">
        <div className="flex justify-center items-center py-4">
          <svg className="animate-spin h-6 w-6 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        </div>
      </div>
    );
  }

  if (results.total_votes === 0) {
    return (
      <div className="text-center">
        <p className="text-gray-600 dark:text-gray-400">No Voters</p>
      </div>
    );
  }

  // Group rounds by round number
  const roundsByNumber = rounds.reduce((acc, round) => {
    if (!acc[round.round_number]) {
      acc[round.round_number] = [];
    }
    acc[round.round_number].push(round);
    return acc;
  }, {} as Record<number, RankedChoiceRound[]>);

  const totalRounds = Math.max(...Object.keys(roundsByNumber).map(Number));
  const winner = results.winner;

  return (
    <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-6">
      <div className="text-center mb-6">
        <h3 className="text-lg font-semibold mb-2 text-gray-900 dark:text-white">Ranked Choice Results</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {results.total_votes} total vote{results.total_votes !== 1 ? 's' : ''} • {totalRounds} elimination round{totalRounds !== 1 ? 's' : ''}
        </p>
        {winner && (
          <div className="mt-3 p-3 bg-green-100 dark:bg-green-900 border border-green-300 dark:border-green-600 rounded-lg">
            <span className="text-green-900 dark:text-green-100 font-bold">
              Winner: {winner}
            </span>
          </div>
        )}
      </div>

      <div className="space-y-6">
        {Object.entries(roundsByNumber)
          .sort(([a], [b]) => Number(a) - Number(b))
          .map(([roundNum, roundData]) => {
            const roundNumber = Number(roundNum);
            const eliminated = roundData.filter(r => r.is_eliminated);
            
            return (
              <div key={roundNumber} className="border border-gray-200 dark:border-gray-600 rounded-lg p-4">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="font-semibold text-gray-900 dark:text-white">
                    Round {roundNumber}
                  </h4>
                  {eliminated.length > 0 && (
                    <div className="text-sm text-red-600 dark:text-red-400">
                      Eliminated: {eliminated.map(e => e.option_name).join(', ')}
                    </div>
                  )}
                </div>

                <div className="grid gap-3">
                  {roundData
                    .sort((a, b) => b.vote_count - a.vote_count)
                    .map((option) => {
                      const percentage = results.total_votes > 0 
                        ? Math.round((option.vote_count / results.total_votes) * 100)
                        : 0;
                      
                      return (
                        <div 
                          key={`${roundNumber}-${option.option_name}`}
                          className={`flex items-center justify-between p-3 rounded-lg border ${
                            option.is_eliminated 
                              ? 'bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800 opacity-75'
                              : option.option_name === winner && roundNumber === totalRounds
                              ? 'bg-green-100 dark:bg-green-900 border-green-300 dark:border-green-600'
                              : 'bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600'
                          }`}
                        >
                          <div className="flex items-center space-x-3">
                            <span className={`leading-tight line-clamp-2 ${
                              option.is_eliminated 
                                ? 'text-gray-500/70 dark:text-gray-400/70 font-medium'
                                : option.option_name === winner && roundNumber === totalRounds
                                ? 'text-green-900 dark:text-green-100 font-bold'
                                : 'text-gray-700/80 dark:text-gray-300/80 font-medium'
                            }`}>
                              {option.option_name}
                            </span>
                            {option.is_eliminated && (
                              <span className="text-xs text-red-600 dark:text-red-400 font-medium">
                                ❌ ELIMINATED
                              </span>
                            )}
                          </div>
                          
                          <div className="flex items-center space-x-4">
                            <div className={`text-sm ${
                              option.is_eliminated 
                                ? 'text-red-600 dark:text-red-400'
                                : option.option_name === winner && roundNumber === totalRounds
                                ? 'text-green-700 dark:text-green-300'
                                : 'text-gray-600 dark:text-gray-400'
                            }`}>
                              {percentage}%
                            </div>
                            <div className={`font-semibold ${
                              option.is_eliminated 
                                ? 'text-red-700 dark:text-red-300'
                                : option.option_name === winner && roundNumber === totalRounds
                                ? 'text-green-800 dark:text-green-200'
                                : 'text-gray-900 dark:text-white'
                            }`}>
                              {option.vote_count} vote{option.vote_count !== 1 ? 's' : ''}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                </div>

                {/* Progress bars for this round */}
                <div className="mt-4 space-y-2">
                  {roundData
                    .sort((a, b) => b.vote_count - a.vote_count)
                    .map((option) => {
                      const percentage = results.total_votes > 0 
                        ? Math.round((option.vote_count / results.total_votes) * 100)
                        : 0;
                      
                      return (
                        <div key={`bar-${roundNumber}-${option.option_name}`}>
                          <div className="flex justify-between items-center mb-1">
                            <span className={`text-xs font-medium leading-tight line-clamp-2 ${
                              option.is_eliminated ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-gray-300'
                            }`}>
                              {option.option_name}
                            </span>
                            <span className={`text-xs ${
                              option.is_eliminated ? 'text-red-500 dark:text-red-500' : 'text-gray-600 dark:text-gray-400'
                            }`}>
                              {percentage}%
                            </span>
                          </div>
                          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
                            <div 
                              className={`h-1.5 rounded-full transition-all duration-500 ease-out ${
                                option.is_eliminated 
                                  ? 'bg-red-400' 
                                  : option.option_name === winner && roundNumber === totalRounds
                                  ? 'bg-green-600'
                                  : 'bg-blue-600'
                              }`}
                              style={{ width: `${percentage}%` }}
                            ></div>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            );
          })}
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
  const [loading, setLoading] = useState(true);

  // Fetch participants who are actually participating (based on priority algorithm)
  useEffect(() => {
    const fetchParticipants = async () => {
      try {
        // Get the list of participating voters from the priority algorithm
        const { data, error } = await supabase
          .rpc('calculate_participating_voters', { poll_id_param: results.poll_id });

        if (error) {
          console.error('Error fetching participants:', error);
          setParticipants([]);
        } else {
          // Map the result to match expected format
          setParticipants((data || []).map((p: any) => ({
            id: p.vote_id,
            voter_name: p.voter_name,
            vote_id: p.vote_id
          })));
        }
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

  const isDev = process.env.NODE_ENV === 'development';
  const userVotedYes = isDev && isPollClosed && userVoteData?.yes_no_choice === 'yes';
  const userVotedNo = isDev && isPollClosed && userVoteData?.yes_no_choice === 'no';

  // Check if user's personal conditions were met
  const userMinParticipants = userVoteData?.min_participants;
  const userMaxParticipants = userVoteData?.max_participants;
  const userConditionsMet = userVotedYes && (
    (userMinParticipants === null || userMinParticipants === undefined || yesCount >= userMinParticipants) &&
    (userMaxParticipants === null || userMaxParticipants === undefined || yesCount <= userMaxParticipants)
  );

  // Get named participants and sort alphabetically
  const namedParticipants = participants
    .filter(p => p.voter_name && p.voter_name.trim() !== '')
    .sort((a, b) => {
      const nameA = (a.voter_name || '').toLowerCase();
      const nameB = (b.voter_name || '').toLowerCase();
      return nameA.localeCompare(nameB);
    });

  const anonymousParticipantCount = participants.filter(p => !p.voter_name || p.voter_name.trim() === '').length;

  // Check if current user is in the participant list (by vote ID)
  const userVoteId = userVoteData?.id;
  const userIsInParticipantList = participants.some(p => p.vote_id === userVoteId);

  // Generate consistent colors for participant bubbles
  const getParticipantColor = (index: number, isCurrentUser: boolean) => {
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
    return colors[index % colors.length];
  };

  // SCENARIO: No votes at all
  if (totalVotes === 0) {
    return (
      <div className="text-center">
        <div className="mb-6 px-4 py-2 rounded-lg border-2 bg-red-100 dark:bg-red-900 border-red-400 dark:border-red-600">
          <div className="text-center">
            <div className="text-2xl font-bold mb-2 text-red-800 dark:text-red-200">
              Not happening
            </div>
            <div className="text-sm text-red-700 dark:text-red-300">
              No responses received
            </div>
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
      const isAlone = participants.length === 1;

      return (
        <div className="rounded-lg border-2 bg-green-100 dark:bg-green-900 border-green-400 dark:border-green-600 p-4">
          <div className="text-center mb-4">
            <div className="text-2xl font-bold mb-2 text-green-800 dark:text-green-200">
              🎉 You're participating!
            </div>
            {isAlone ? (
              <div className="text-lg text-green-700 dark:text-green-300">
                😢 All alone
              </div>
            ) : (
              <div>
                <div className="text-sm text-green-700 dark:text-green-300 mb-3">
                  along with
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {/* Other named participants */}
                  {otherParticipants.map((participant, index) => (
                    <span
                      key={participant.id}
                      className={`inline-block px-3 py-1 rounded-full text-sm ${getParticipantColor(index, false)}`}
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
            )}
          </div>
        </div>
      );
    }

    // Scenario: Event IS happening, user voted YES but is NOT in participant list (needs weren't met)
    if (isHappening && userVotedYes && !userIsInParticipantList) {
      return (
        <div className="rounded-lg border-2 bg-yellow-100 dark:bg-yellow-900 border-yellow-400 dark:border-yellow-600 p-4">
          <div className="text-center">
            <div className="text-2xl font-bold mb-2 text-yellow-800 dark:text-yellow-200">
              You're not participating
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <span className="text-sm text-yellow-700 dark:text-yellow-300">
                but these are
              </span>
              {/* Named participants */}
              {namedParticipants.map((participant, index) => (
                <span
                  key={participant.id}
                  className={`inline-block px-3 py-1 rounded-full text-sm ${getParticipantColor(index, false)}`}
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
        <div className="rounded-lg border-2 bg-green-100 dark:bg-green-900 border-green-400 dark:border-green-600 p-4">
          <div className="text-center">
            <div className="text-2xl font-bold mb-2 text-green-800 dark:text-green-200">
              You're not participating
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <span className="text-sm text-green-700 dark:text-green-300">
                but these are
              </span>
              {/* Named participants */}
              {namedParticipants.map((participant, index) => (
                <span
                  key={participant.id}
                  className={`inline-block px-3 py-1 rounded-full text-sm ${getParticipantColor(index, false)}`}
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
              Final: {yesCount} participant{yesCount !== 1 ? 's' : ''}
              {(minParticipants || maxParticipants) && (
                <> (needed {minParticipants && maxParticipants ? `${minParticipants}-${maxParticipants}` : minParticipants ? `${minParticipants}+` : `up to ${maxParticipants}`})</>
              )}
            </div>
            {userNeedsText && (
              <div className="text-sm text-red-700 dark:text-red-300 opacity-75">
                Your needs weren't met ({userNeedsText})
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
          <div className="rounded-lg border-2 bg-red-100 dark:bg-red-900 border-red-400 dark:border-red-600 px-4 py-3">
            <div className="text-center">
              <div className="text-xl font-bold text-red-800 dark:text-red-200">
                No one is participating
              </div>
            </div>
          </div>
        );
      }

      return (
        <div className="rounded-lg border-2 bg-red-100 dark:bg-red-900 border-red-400 dark:border-red-600 px-4 py-3">
          <div className="text-center">
            <div className="text-xl font-bold mb-1 text-red-800 dark:text-red-200">
              ✗ Not happening
            </div>
            <div className="text-sm text-red-700 dark:text-red-300">
              Final: {yesCount} participant{yesCount !== 1 ? 's' : ''}
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
  const [nominations, setNominations] = useState<{option: string, count: number}[]>([]);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    const loadNominations = async () => {
      try {
        // Fetch all nominations from votes for this poll
        const { data: votes, error } = await supabase
          .from('votes')
          .select('nominations, is_abstain, id, created_at')
          .eq('poll_id', results.poll_id)
          .eq('vote_type', 'nomination')
          .eq('is_abstain', false)  // Only count non-abstaining votes
          .not('nominations', 'is', null)
          .order('created_at', { ascending: false }); // Order by most recent first

        if (error) {
          console.error('Error fetching nominations:', error);
          setNominations([]);
          return;
        }

        // Count each nomination
        const nominationMap = new Map<string, number>();
        
        // Add starting options from poll (initialize with 0 votes, not 1)
        const pollOptions = typeof results.options === 'string' ? JSON.parse(results.options) : results.options || [];
        pollOptions.forEach((option: any) => {
          // Handle both string options and object options
          const optionString = typeof option === 'string' ? option : option?.option || option?.toString() || '';
          if (optionString) {
            nominationMap.set(optionString, 0);  // Initialize with 0, not 1
          }
        });
        
        // Count actual nominations from votes
        console.log('[PollResults] Processing votes for counting:', votes);
        votes?.forEach(vote => {
          console.log('[PollResults] Processing vote:', vote.id, 'nominations:', vote.nominations, 'is_abstain:', vote.is_abstain);
          if (vote.nominations && Array.isArray(vote.nominations)) {
            vote.nominations.forEach((nom: any) => {
              // Handle both string nominations and object nominations
              const nomString = typeof nom === 'string' ? nom : nom?.option || nom?.toString() || '';
              if (nomString) {
                console.log('[PollResults] Adding nomination to count:', nomString);
                nominationMap.set(nomString, (nominationMap.get(nomString) || 0) + 1);
              }
            });
          }
        });

        console.log('[PollResults] Final nomination counts:', Array.from(nominationMap.entries()));

        // Convert to sorted array
        const nominationCounts = Array.from(nominationMap.entries())
          .map(([option, count]) => ({ option, count }))
          .sort((a, b) => b.count - a.count);
        
        setNominations(nominationCounts);
      } catch (error) {
        console.error('Error loading nominations:', error);
        setNominations([]);
      } finally {
        setLoading(false);
      }
    };

    loadNominations();
  }, [results]);

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

  if (loading) {
    return (
      <div className="flex justify-center items-center py-8">
        <svg className="animate-spin h-8 w-8 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 718-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 714 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
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