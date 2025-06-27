"use client";

import { useState, useEffect, useRef } from "react";
import { PollResults, RankedChoiceRound, getRankedChoiceRounds } from "@/lib/supabase";

interface CompactRankedChoiceResultsProps {
  results: PollResults;
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
}

export default function CompactRankedChoiceResults({ results }: CompactRankedChoiceResultsProps) {
  const [roundVisualizations, setRoundVisualizations] = useState<RoundVisualization[]>([]);
  const [currentRoundIndex, setCurrentRoundIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);

  useEffect(() => {
    async function fetchAndProcessData() {
      try {
        const roundData = await getRankedChoiceRounds(results.poll_id);
        
        // Group rounds by round number
        const roundsByNumber = roundData.reduce((acc, round) => {
          if (!acc[round.round_number]) acc[round.round_number] = [];
          acc[round.round_number].push(round);
          return acc;
        }, {} as Record<number, RankedChoiceRound[]>);

        const totalRounds = Math.max(...roundData.map(r => r.round_number));
        const visualizations: RoundVisualization[] = [];
        
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
            .sort((a, b) => b.vote_count - a.vote_count)
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
                percentage: Math.round((round.vote_count / results.total_votes) * 100),
                previousVotes: roundNum > 1 ? previousVotes : undefined,
                donatedVotes: donatedVotes > 0 ? donatedVotes : undefined,
                isEliminated: isEliminated,
                position: index + 1
              };
            });
          
          const eliminatedCandidates = eliminatedInThisRound;
          
          visualizations.push({
            roundNumber: roundNum,
            title: roundNum === totalRounds ? 'Final Rankings' : `Round ${roundNum}`,
            candidates,
            eliminatedCandidates
          });
        }
        
        setRoundVisualizations(visualizations);
        // Start at the final round (last index)
        setCurrentRoundIndex(visualizations.length - 1);
      } catch (error) {
        console.error('Error processing ranked choice data:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchAndProcessData();
  }, [results.poll_id, results.total_votes, results.winner]);

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
      if (newIndex < 0) {
        return roundVisualizations.length - 1; // Loop to end
      } else if (newIndex >= roundVisualizations.length) {
        return 0; // Loop to beginning
      }
      return newIndex;
    });
  };

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

  if (roundVisualizations.length === 0) {
    return (
      <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-6 text-center">
        <p className="text-gray-600 dark:text-gray-400">Unable to load round data.</p>
      </div>
    );
  }

  const currentRound = roundVisualizations[currentRoundIndex];

  return (
    <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-6 relative">
      {/* Navigation buttons for desktop */}
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
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {currentRoundIndex + 1} of {roundVisualizations.length}
          </p>
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

      {/* Swipeable content area */}
      <div 
        ref={containerRef}
        className="overflow-hidden touch-pan-y"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className="space-y-2">
          {currentRound.candidates.map((candidate) => {
            // Find the highest vote count in the current round
            const highestVotes = Math.max(...currentRound.candidates.map(c => c.votes));
            const candidatesWithHighestVotes = currentRound.candidates.filter(c => c.votes === highestVotes);
            const isTieByVotes = candidatesWithHighestVotes.length > 1;
            
            const isTiedCandidate = currentRound.roundNumber === roundVisualizations.length &&
                                  (results.winner === 'tie' || isTieByVotes) &&
                                  candidate.votes === highestVotes;
            
            return (
            <div key={candidate.name} className={`border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 transition-all ${
              isTiedCandidate
                ? 'bg-green-100 dark:bg-green-900 border-green-300 dark:border-green-600'
                : candidate.isEliminated && !isTiedCandidate
                ? 'bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800 opacity-75'
                : results.winner === candidate.name && currentRound.roundNumber === roundVisualizations.length
                ? 'bg-green-100 dark:bg-green-900 border-green-300 dark:border-green-600' 
                : 'bg-white dark:bg-gray-700'
            }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  {/* Position number */}
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                    isTiedCandidate
                      ? 'bg-green-400 text-green-900'
                      : candidate.position === 1 && !candidate.isEliminated
                      ? 'bg-yellow-400 text-yellow-900' 
                      : candidate.position === 2 && !candidate.isEliminated
                      ? 'bg-gray-300 text-gray-700'
                      : candidate.position === 3 && !candidate.isEliminated
                      ? 'bg-orange-300 text-orange-800'
                      : candidate.isEliminated && !isTiedCandidate
                      ? 'bg-red-200 text-red-700'
                      : 'bg-gray-200 text-gray-600'
                  }`}>
                    {isTiedCandidate ? 'T' : candidate.position}
                  </div>
                  
                  {/* Candidate name */}
                  <div className={`font-semibold ${
                    isTiedCandidate
                      ? 'text-green-800 dark:text-green-200'
                      : candidate.isEliminated && !isTiedCandidate
                      ? 'text-red-700 dark:text-red-300 line-through'
                      : results.winner === candidate.name && currentRound.roundNumber === roundVisualizations.length
                      ? 'text-green-800 dark:text-green-200'
                      : 'text-gray-900 dark:text-white'
                  }`}>
                    {candidate.name}
                    {results.winner === candidate.name && currentRound.roundNumber === roundVisualizations.length && !isTiedCandidate && (
                      <span className="ml-2 text-sm">👑 Winner</span>
                    )}
                    {isTiedCandidate && (
                      <span className="ml-2 text-sm">🤝 Tied</span>
                    )}
                  </div>
                </div>

                {/* Vote count and percentage */}
                <div className="text-right">
                  <div className={`text-lg font-bold ${
                    isTiedCandidate
                      ? 'text-green-800 dark:text-green-200'
                      : candidate.isEliminated && !isTiedCandidate
                      ? 'text-red-700 dark:text-red-300'
                      : results.winner === candidate.name && currentRound.roundNumber === roundVisualizations.length
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
              </div>
            </div>
          );
          })}
        </div>
      </div>
      
      
      {/* Swipe hint */}
      <div className="text-center mt-4 text-xs text-gray-500 dark:text-gray-400">
        Swipe left/right or use buttons to navigate rounds
      </div>
    </div>
  );
}