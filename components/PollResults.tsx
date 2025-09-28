"use client";

import { useState, useEffect } from "react";
import { PollResults, RankedChoiceRound, getRankedChoiceRounds, supabase } from "@/lib/supabase";
import CompactRankedChoiceResults from "./CompactRankedChoiceResults";
import NominationsList from "./NominationsList";

interface PollResultsProps {
  results: PollResults;
  isPollClosed?: boolean;
  userVoteData?: any;
}

export default function PollResultsDisplay({ results, isPollClosed, userVoteData }: PollResultsProps) {
  if (results.poll_type === 'yes_no') {
    return <YesNoResults results={results} isPollClosed={isPollClosed} userVoteData={userVoteData} />;
  }

  if (results.poll_type === 'ranked_choice') {
    return <CompactRankedChoiceResults results={results} isPollClosed={isPollClosed} userVoteData={userVoteData} />;
  }

  if (results.poll_type === 'nomination') {
    return <NominationResults results={results} isPollClosed={isPollClosed} userVoteData={userVoteData} />;
  }

  return null;
}

function YesNoResults({ results, isPollClosed, userVoteData }: { results: PollResults, isPollClosed?: boolean, userVoteData?: any }) {
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

function NominationResults({ results, isPollClosed, userVoteData }: { results: PollResults, isPollClosed?: boolean, userVoteData?: any }) {
  const [nominations, setNominations] = useState<{option: string, count: number}[]>([]);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    const loadNominations = async () => {
      try {
        // Fetch all nominations from votes for this poll
        const { data: votes, error } = await supabase
          .from('votes')
          .select('nominations, is_abstain, id, updated_at')
          .eq('poll_id', results.poll_id)
          .eq('vote_type', 'nomination')
          .eq('is_abstain', false)  // Only count non-abstaining votes
          .not('nominations', 'is', null)
          .order('updated_at', { ascending: false }); // Order by most recent first

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
            No nominations available.
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