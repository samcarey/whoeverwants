"use client";

import { useState, useEffect } from "react";
import { PollResults, RankedChoiceRound, getRankedChoiceRounds } from "@/lib/supabase";

interface PollResultsProps {
  results: PollResults;
}

export default function PollResultsDisplay({ results }: PollResultsProps) {
  if (results.poll_type === 'yes_no') {
    return <YesNoResults results={results} />;
  }

  if (results.poll_type === 'ranked_choice') {
    return <RankedChoiceResults results={results} />;
  }

  return null;
}

function YesNoResults({ results }: { results: PollResults }) {
  const yesCount = results.yes_count || 0;
  const noCount = results.no_count || 0;
  const yesPercentage = results.yes_percentage || 0;
  const noPercentage = results.no_percentage || 0;
  const winner = results.winner;
  const totalVotes = results.total_votes;

  if (totalVotes === 0) {
    return (
      <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-6 text-center">
        <h3 className="text-lg font-semibold mb-2 text-gray-900 dark:text-white">No Votes Yet</h3>
        <p className="text-gray-600 dark:text-gray-400">This poll hasn&apos;t received any votes.</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-6">
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
            ? 'bg-green-50 dark:bg-green-950 border-green-300 dark:border-green-700'
            : 'bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800'
        }`}>
          <div className="text-center">
            <div className={`text-2xl font-bold mb-1 ${
              winner === 'yes' 
                ? 'text-green-800 dark:text-green-200' 
                : 'text-green-700 dark:text-green-300'
            }`}>
              {yesPercentage}%
            </div>
            <div className={`text-lg font-semibold mb-2 ${
              winner === 'yes' 
                ? 'text-green-800 dark:text-green-200' 
                : 'text-green-700 dark:text-green-300'
            }`}>
              Yes
              {winner === 'yes' && (
                <span className="ml-2 text-sm">👑 Winner</span>
              )}
              {winner === 'tie' && (
                <span className="ml-2 text-sm">🤝 Tie</span>
              )}
            </div>
            <div className={`text-sm ${
              winner === 'yes' 
                ? 'text-green-700 dark:text-green-300' 
                : 'text-green-600 dark:text-green-400'
            }`}>
              {yesCount} vote{yesCount !== 1 ? 's' : ''}
            </div>
          </div>
        </div>

        {/* No Results */}
        <div className={`p-4 rounded-lg border-2 transition-all ${
          winner === 'no' 
            ? 'bg-red-100 dark:bg-red-900 border-red-400 dark:border-red-600 shadow-lg' 
            : winner === 'tie'
            ? 'bg-red-50 dark:bg-red-950 border-red-300 dark:border-red-700'
            : 'bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800'
        }`}>
          <div className="text-center">
            <div className={`text-2xl font-bold mb-1 ${
              winner === 'no' 
                ? 'text-red-800 dark:text-red-200' 
                : 'text-red-700 dark:text-red-300'
            }`}>
              {noPercentage}%
            </div>
            <div className={`text-lg font-semibold mb-2 ${
              winner === 'no' 
                ? 'text-red-800 dark:text-red-200' 
                : 'text-red-700 dark:text-red-300'
            }`}>
              No
              {winner === 'no' && (
                <span className="ml-2 text-sm">👑 Winner</span>
              )}
              {winner === 'tie' && (
                <span className="ml-2 text-sm">🤝 Tie</span>
              )}
            </div>
            <div className={`text-sm ${
              winner === 'no' 
                ? 'text-red-700 dark:text-red-300' 
                : 'text-red-600 dark:text-red-400'
            }`}>
              {noCount} vote{noCount !== 1 ? 's' : ''}
            </div>
          </div>
        </div>
      </div>

      {/* Visual Progress Bars */}
      <div className="space-y-3">
        <div>
          <div className="flex justify-between items-center mb-1">
            <span className="text-sm font-medium text-green-700 dark:text-green-300">Yes</span>
            <span className="text-sm text-green-600 dark:text-green-400">{yesPercentage}%</span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
            <div 
              className="bg-green-600 h-2 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${yesPercentage}%` }}
            ></div>
          </div>
        </div>
        
        <div>
          <div className="flex justify-between items-center mb-1">
            <span className="text-sm font-medium text-red-700 dark:text-red-300">No</span>
            <span className="text-sm text-red-600 dark:text-red-400">{noPercentage}%</span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
            <div 
              className="bg-red-600 h-2 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${noPercentage}%` }}
            ></div>
          </div>
        </div>
      </div>

      {winner === 'tie' && (
        <div className="mt-4 p-3 bg-yellow-100 dark:bg-yellow-900 border border-yellow-300 dark:border-yellow-600 rounded-lg text-center">
          <span className="text-yellow-800 dark:text-yellow-200 font-medium">
            🤝 It&apos;s a tie! Both choices received equal votes.
          </span>
        </div>
      )}
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
      <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-6 text-center">
        <h3 className="text-lg font-semibold mb-2 text-gray-900 dark:text-white">No Votes Yet</h3>
        <p className="text-gray-600 dark:text-gray-400">This poll hasn&apos;t received any votes.</p>
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
            <span className="text-green-800 dark:text-green-200 font-semibold">
              👑 Winner: {winner}
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
                            <span className={`font-medium ${
                              option.is_eliminated 
                                ? 'text-red-700 dark:text-red-300'
                                : option.option_name === winner && roundNumber === totalRounds
                                ? 'text-green-800 dark:text-green-200'
                                : 'text-gray-900 dark:text-white'
                            }`}>
                              {option.option_name}
                            </span>
                            {option.is_eliminated && (
                              <span className="text-xs text-red-600 dark:text-red-400 font-medium">
                                ❌ ELIMINATED
                              </span>
                            )}
                            {option.option_name === winner && roundNumber === totalRounds && (
                              <span className="text-xs text-green-600 dark:text-green-400 font-medium">
                                👑 WINNER
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
                            <span className={`text-xs font-medium ${
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