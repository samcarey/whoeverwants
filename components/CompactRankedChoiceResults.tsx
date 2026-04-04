"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { PollResults, RankedChoiceRound, OptionsMetadata } from "@/lib/types";
import { apiGetVotes, ApiRankedChoiceRound } from "@/lib/api";
import OptionLabel, { isLocationEntry, isRestaurantEntry } from "./OptionLabel";

interface CompactRankedChoiceResultsProps {
  results: PollResults;
  isPollClosed?: boolean;
  userVoteData?: any;
  onFollowUpClick?: () => void;
  optionsMetadata?: OptionsMetadata | null;
}

interface RoundVisualization {
  roundNumber: number;
  title: string;
  candidates: Array<{
    name: string;
    votes: number;
    percentage: number;
    previousVotes?: number;
    donatedVotes?: number;
    isEliminated: boolean;
    position: number;
  }>;
  eliminatedCandidates: string[];
  userPreference?: string;
  roundEntries?: RankedChoiceRound[];
}

export default function CompactRankedChoiceResults({ results, isPollClosed, userVoteData, onFollowUpClick, optionsMetadata }: CompactRankedChoiceResultsProps) {
  const router = useRouter();
  const [roundVisualizations, setRoundVisualizations] = useState<RoundVisualization[]>([]);
  const [currentRoundIndex, setCurrentRoundIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);

  // Function to determine user's preference for a given round
  const getUserPreferenceForRound = useCallback((roundNumber: number, eliminatedSoFar: string[]): string | undefined => {
    if (!userVoteData?.ranked_choices) return undefined;
    
    const userRanking: string[] = userVoteData.ranked_choices;
    
    // Find the first choice in user's ranking that hasn't been eliminated yet
    for (const choice of userRanking) {
      if (!eliminatedSoFar.includes(choice)) {
        return choice;
      }
    }
    
    return undefined;
  }, [userVoteData?.ranked_choices]);

  useEffect(() => {
    async function fetchAndProcessData() {
      try {
        // Get ranked choice rounds from the results object (populated by Python API)
        const apiRounds: ApiRankedChoiceRound[] = (results as any).ranked_choice_rounds || [];

        // If no rounds data, check if all votes are abstains
        if (apiRounds.length === 0) {
          try {
            const allVotes = await apiGetVotes(results.poll_id);
            const rankedVotes = allVotes.filter(v => v.vote_type === 'ranked_choice');
            const hasNonAbstainVotes = rankedVotes.some(vote => !vote.is_abstain);

            if (!hasNonAbstainVotes && rankedVotes.length > 0) {
              setRoundVisualizations([]);
              setLoading(false);
              return;
            }
          } catch (voteError) {
            console.error('Error checking votes:', voteError);
          }

          setRoundVisualizations([]);
          setLoading(false);
          return;
        }

        // Convert API rounds to RankedChoiceRound format for compatibility
        const roundData: RankedChoiceRound[] = apiRounds.map((r, idx) => ({
          id: `${r.round_number}-${r.option_name}`,
          poll_id: results.poll_id,
          round_number: r.round_number,
          option_name: r.option_name,
          vote_count: r.vote_count,
          is_eliminated: r.is_eliminated,
          created_at: '',
          borda_score: r.borda_score ?? undefined,
          tie_broken_by_borda: r.tie_broken_by_borda,
        }));

        // Group rounds by round number
        const roundsByNumber = roundData.reduce((acc, round) => {
          if (!acc[round.round_number]) acc[round.round_number] = [];
          acc[round.round_number].push(round);
          return acc;
        }, {} as Record<number, RankedChoiceRound[]>);

        const totalRounds = Math.max(...roundData.map(r => r.round_number));
        const visualizations: RoundVisualization[] = [];
        
        // Track eliminated candidates cumulatively across rounds
        let eliminatedSoFar: string[] = [];
        
        // Build visualizations for each round
        for (let roundNum = 1; roundNum <= totalRounds; roundNum++) {
          const currentRoundData = roundsByNumber[roundNum] || [];
          const previousRoundData = roundNum > 1 ? roundsByNumber[roundNum - 1] || [] : [];
          const nextRoundData = roundNum < totalRounds ? roundsByNumber[roundNum + 1] || [] : [];
          
          // Create a map of previous votes for comparison
          const previousVotesMap = new Map<string, number>();
          previousRoundData.forEach(round => {
            previousVotesMap.set(round.option_name, round.vote_count);
          });
          
          // Create a map of next round votes to calculate transfers
          const nextVotesMap = new Map<string, number>();
          nextRoundData.forEach(round => {
            nextVotesMap.set(round.option_name, round.vote_count);
          });
          
          // Find who gets eliminated in this round
          const eliminatedInThisRound = currentRoundData
            .filter(round => round.is_eliminated)
            .map(round => round.option_name);
          
          // Get user's preference for this round (before any eliminations in this round)
          const userPreference = getUserPreferenceForRound(roundNum, eliminatedSoFar);
          
          // Check for ties in the final round
          const isFinalRound = roundNum === totalRounds;
          
          // Detect ties by checking if multiple candidates have the same highest vote count
          const sortedByVotes = currentRoundData.sort((a, b) => b.vote_count - a.vote_count);
          const highestVoteCount = sortedByVotes[0]?.vote_count || 0;
          const candidatesWithHighestVotes = sortedByVotes.filter(c => c.vote_count === highestVoteCount);
          const isTieByVotes = isFinalRound && candidatesWithHighestVotes.length > 1;
          
          // Use either database tie detection or our own vote-based detection
          const isTie = isFinalRound && (results.winner === 'tie' || isTieByVotes);
          
          const candidates = currentRoundData
            .sort((a, b) => {
              // If vote counts are different, sort by vote count (highest first)
              if (a.vote_count !== b.vote_count) {
                return b.vote_count - a.vote_count;
              }
              
              // If both have tie_broken_by_borda flag, put eliminated candidate last
              if (a.tie_broken_by_borda && b.tie_broken_by_borda) {
                if (a.is_eliminated !== b.is_eliminated) {
                  return a.is_eliminated ? 1 : -1; // Eliminated goes to bottom
                }
                // If both eliminated or both surviving, sort by Borda score (highest first)
                return (b.borda_score || 0) - (a.borda_score || 0);
              }
              
              // Default: maintain original vote count order
              return b.vote_count - a.vote_count;
            })
            .map((round, index) => {
              const previousVotes = previousVotesMap.get(round.option_name) || 0;
              const nextVotes = nextVotesMap.get(round.option_name) || round.vote_count;
              
              // Show donated votes when someone is eliminated in this round
              // and this candidate will receive votes in the next round
              const willReceiveDonatedVotes = eliminatedInThisRound.length > 0 && 
                                            !round.is_eliminated && 
                                            nextVotes > round.vote_count;
              const donatedVotes = willReceiveDonatedVotes ? nextVotes - round.vote_count : 0;
              
              // In case of a tie, don't show anyone as eliminated if they have the highest vote count
              const hasHighestVotes = round.vote_count === highestVoteCount;
              const isEliminated = isTie && hasHighestVotes ? false : round.is_eliminated;
              
              return {
                name: round.option_name,
                votes: round.vote_count,
                percentage: results.total_votes > 0 ? Math.round((round.vote_count / results.total_votes) * 100) : 0,
                previousVotes: roundNum > 1 ? previousVotes : undefined,
                donatedVotes: donatedVotes > 0 ? donatedVotes : undefined,
                isEliminated: isEliminated,
                position: index + 1
              };
            });
          
          const eliminatedCandidates = eliminatedInThisRound;
          
          visualizations.push({
            roundNumber: roundNum,
            title: roundNum === totalRounds ? 'Final Round' : `Round ${roundNum} of ${totalRounds}`,
            candidates,
            eliminatedCandidates,
            userPreference,
            roundEntries: currentRoundData,
          });
          
          // Update eliminated list for next round
          eliminatedSoFar = [...eliminatedSoFar, ...eliminatedInThisRound];
        }
        
        setRoundVisualizations(visualizations);
        
        // Check if there's a round specified in the URL hash
        const hashMatch = window.location.hash.match(/^#round(\d+)$/);
        let initialRoundIndex = visualizations.length - 1; // Default to final round
        
        if (hashMatch) {
          const roundNumber = parseInt(hashMatch[1], 10);
          const roundIndex = roundNumber - 1; // Convert to 0-based index
          if (roundIndex >= 0 && roundIndex < visualizations.length) {
            initialRoundIndex = roundIndex;
          }
        }
        
        setCurrentRoundIndex(initialRoundIndex);
      } catch (error) {
        console.error('Error processing ranked choice data:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchAndProcessData();
  }, [results.poll_id, results.total_votes, results.winner, userVoteData, getUserPreferenceForRound]);

  // Update URL hash when round index changes
  useEffect(() => {
    if (roundVisualizations.length > 0) {
      const roundNumber = currentRoundIndex + 1;
      window.history.replaceState(null, '', `#round${roundNumber}`);
    }
  }, [currentRoundIndex, roundVisualizations.length]);

  // Touch handlers for swipe functionality
  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    setTouchEnd(e.targetTouches[0].clientX);
  };

  const handleTouchEnd = () => {
    if (!touchStart || !touchEnd) return;
    
    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > 50;
    const isRightSwipe = distance < -50;

    if (isLeftSwipe) {
      navigateRound(1);
    } else if (isRightSwipe) {
      navigateRound(-1);
    }
  };

  const navigateRound = (direction: number) => {
    setCurrentRoundIndex(prevIndex => {
      const newIndex = prevIndex + direction;
      let finalIndex: number;
      
      if (newIndex < 0) {
        finalIndex = roundVisualizations.length - 1; // Loop to end
      } else if (newIndex >= roundVisualizations.length) {
        finalIndex = 0; // Loop to beginning
      } else {
        finalIndex = newIndex;
      }
      
      return finalIndex;
    });
  };

  if (loading) {
    return (
      <div className="text-center">
        <div className="flex justify-center items-center py-4">
          <svg className="animate-spin h-6 w-6 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        </div>
      </div>
    );
  }

  if (roundVisualizations.length === 0) {
    // Check if there are any votes at all
    if (results.total_votes === 0) {
      return (
        <div className="text-center">
          <p className="text-gray-600 dark:text-gray-400">No Voters</p>
        </div>
      );
    } else {
      // There are votes but all abstained
      return (
        <div className="text-center">
          <p className="text-gray-600 dark:text-gray-400">No Votes</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            All voters abstained
          </p>
        </div>
      );
    }
  }

  const currentRound = roundVisualizations[currentRoundIndex];

  return (
    <div className="relative">
      {/* Navigation buttons for desktop - only show if multiple rounds */}
      {roundVisualizations.length > 1 ? (
        <div className="flex justify-between items-center mb-4">
          <button
            onClick={() => navigateRound(-1)}
            className="p-2 rounded-full bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
            aria-label="Previous round"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          
          <div className="text-center">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{currentRound.title}</h3>
          </div>
          
          <button
            onClick={() => navigateRound(1)}
            className="p-2 rounded-full bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
            aria-label="Next round"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      ) : (
        <div className="text-center mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{currentRound.title}</h3>
          {results.total_votes === 0 && results.winner && results.winner !== 'tie' && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Uncontested</p>
          )}
        </div>
      )}

      {/* Swipeable content area */}
      <div 
        ref={containerRef}
        className="overflow-hidden touch-pan-y"
        onTouchStart={roundVisualizations.length > 1 ? handleTouchStart : undefined}
        onTouchMove={roundVisualizations.length > 1 ? handleTouchMove : undefined}
        onTouchEnd={roundVisualizations.length > 1 ? handleTouchEnd : undefined}
      >
        <div className="space-y-2">
          {(() => {
            const highestVotes = Math.max(...currentRound.candidates.map(c => c.votes));
            const isTieByVotes = currentRound.candidates.filter(c => c.votes === highestVotes).length > 1;
            const isFinalRound = currentRound.roundNumber === roundVisualizations.length;

            return currentRound.candidates.map((candidate, index) => {
              const isTiedCandidate = isFinalRound &&
                                  (results.winner === 'tie' || isTieByVotes) &&
                                  candidate.votes === highestVotes;

            // Check if we should show Borda explanation after this candidate
            const isLastEliminatedCandidate = candidate.isEliminated &&
                                            index === currentRound.candidates.length - 1;
            const hasBordaTieBreaking = isLastEliminatedCandidate &&
                                      currentRound.eliminatedCandidates.length > 0;

            const isUserPreference = currentRound.userPreference === candidate.name;

            const getUserChoicePosition = () => {
              if (!isUserPreference || !userVoteData?.ranked_choices) return null;
              const position = userVoteData.ranked_choices.indexOf(candidate.name) + 1;
              if (position === 0) return null;
              const suffix = position === 1 ? 'st' : position === 2 ? 'nd' : position === 3 ? 'rd' : 'th';
              return `Your ${position}${suffix} choice`;
            };

            const userChoiceText = getUserChoicePosition();

            return (
              <React.Fragment key={candidate.name}>
                <div className="flex items-center gap-2">
                  {/* Static position number */}
                  <div className="flex-shrink-0" style={{ width: '32px' }}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                      isUserPreference
                        ? 'bg-blue-500 text-white dark:bg-blue-600 dark:text-white'
                        : 'bg-gray-200 text-gray-600 dark:bg-gray-600 dark:text-gray-200'
                    }`}>
                      {isTiedCandidate ? 'T' : candidate.position}
                    </div>
                  </div>

                  {/* Candidate row */}
                  <div className={`flex-1 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 transition-all ${
                    isTiedCandidate
                      ? 'bg-green-100 dark:bg-green-900 border-green-300 dark:border-green-600'
                      : candidate.isEliminated && !isTiedCandidate
                      ? 'bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800 opacity-75'
                      : results.winner === candidate.name && isFinalRound
                      ? 'bg-green-100 dark:bg-green-900 border-green-300 dark:border-green-600'
                      : 'bg-white dark:bg-gray-700'
                  }`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="min-w-0 overflow-hidden">
                          <div className={`leading-tight ${
                            isLocationEntry(optionsMetadata?.[candidate.name]) || isRestaurantEntry(optionsMetadata?.[candidate.name])
                              ? 'overflow-hidden'
                              : 'line-clamp-2'
                          } ${
                            isTiedCandidate
                              ? 'text-green-900 dark:text-green-100 font-bold'
                              : candidate.isEliminated && !isTiedCandidate
                              ? 'text-gray-500/60 dark:text-gray-400/60 line-through font-medium'
                              : results.winner === candidate.name && isFinalRound
                              ? 'text-green-900 dark:text-green-100 font-bold'
                              : 'text-gray-700/80 dark:text-gray-300/80 font-medium'
                          }`}>
                            <OptionLabel text={candidate.name} metadata={optionsMetadata?.[candidate.name]} />
                          </div>
                          {userChoiceText && (
                            <div className="mt-1">
                              <span className="inline-block px-2 py-1 bg-blue-500 text-white text-xs font-medium rounded-full">
                                {userChoiceText}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      {!(results.total_votes === 0 && currentRound.candidates.length === 1) && (
                        <div className="text-right flex-shrink-0">
                          <div className={`text-lg font-bold ${
                            isTiedCandidate
                              ? 'text-green-800 dark:text-green-200'
                              : candidate.isEliminated && !isTiedCandidate
                              ? 'text-red-700 dark:text-red-300'
                              : results.winner === candidate.name && isFinalRound
                              ? 'text-green-800 dark:text-green-200'
                              : 'text-gray-900 dark:text-white'
                          }`}>
                            {candidate.percentage}%
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center justify-end gap-1">
                            {candidate.donatedVotes && candidate.donatedVotes > 0 && (
                              <span className="bg-blue-500 text-white text-xs px-2 py-0.5 rounded-full font-medium">
                                +{candidate.donatedVotes}
                              </span>
                            )}
                            <span>{candidate.votes} vote{candidate.votes !== 1 ? 's' : ''}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {hasBordaTieBreaking && (
                  <BordaCountExplanation
                    pollId={results.poll_id}
                    roundNumber={currentRound.roundNumber}
                    roundEntries={currentRound.roundEntries}
                  />
                )}
              </React.Fragment>
            );
          });
          })()}
        </div>
      </div>
    </div>
  );
}

// Component to show Borda count explanation when tie-breaking occurs
interface BordaCountExplanationProps {
  pollId: string;
  roundNumber: number;
  roundEntries?: RankedChoiceRound[];
}

function BordaCountExplanation({ pollId, roundNumber, roundEntries }: BordaCountExplanationProps) {
  // Extract Borda data from round entries that have tie_broken_by_borda flag
  const bordaData = (roundEntries || [])
    .filter(r => r.tie_broken_by_borda && r.borda_score !== undefined)
    .map(r => ({
      name: r.option_name,
      borda_score: r.borda_score || 0,
      is_eliminated: r.is_eliminated,
    }));

  if (bordaData.length === 0) return null;

  // Find the eliminated candidate and the survivor(s)
  const eliminatedCandidate = bordaData.find(c => c.is_eliminated);
  const survivors = bordaData.filter(c => !c.is_eliminated);

  if (!eliminatedCandidate || survivors.length === 0) return null;

  // Determine tie-breaking method
  // If any survivor has the same Borda score as the eliminated candidate, it was alphabetical tie-breaking
  const isAlphabeticalTieBreak = survivors.some(s => s.borda_score === eliminatedCandidate.borda_score);

  return (
    <div className="mx-2 my-2 p-3 bg-amber-50 dark:bg-amber-950 border-l-4 border-amber-400 dark:border-amber-600 rounded-r-lg">
      <div className="text-xs text-amber-700 dark:text-amber-300">
        <div className="mb-1">Borda scores:</div>
        <div className="flex flex-wrap gap-2 mb-2">
          {bordaData
            .sort((a, b) => b.borda_score - a.borda_score)
            .map((candidate) => (
              <span 
                key={candidate.name}
                className={`px-2 py-1 rounded font-mono leading-tight line-clamp-1 ${
                  candidate.is_eliminated 
                    ? 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200'
                    : 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
                }`}
              >
                {candidate.name}: {candidate.borda_score}
                {candidate.is_eliminated && ' ❌'}
              </span>
            ))}
        </div>
        <div className="italic">
          Tie broken by {isAlphabeticalTieBreak ? 'alphabetical order' : 'Borda count'}
        </div>
      </div>
    </div>
  );
}