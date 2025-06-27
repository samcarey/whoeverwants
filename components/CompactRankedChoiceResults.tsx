"use client";

import { useState, useEffect } from "react";
import { PollResults, RankedChoiceRound, getRankedChoiceRounds } from "@/lib/supabase";

interface CompactRankedChoiceResultsProps {
  results: PollResults;
}

interface CandidateResult {
  name: string;
  position: number;
  lastRoundParticipated: number;
  lastRoundVotes: number;
  lastRoundPercentage: number;
  eliminatedInRound?: number;
  isWinner: boolean;
}

export default function CompactRankedChoiceResults({ results }: CompactRankedChoiceResultsProps) {
  const [rounds, setRounds] = useState<RankedChoiceRound[]>([]);
  const [candidates, setCandidates] = useState<CandidateResult[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchAndProcessData() {
      try {
        const roundData = await getRankedChoiceRounds(results.poll_id);
        setRounds(roundData);
        
        // Process rounds to create candidate rankings
        const candidateMap = new Map<string, CandidateResult>();
        const roundsByNumber = roundData.reduce((acc, round) => {
          if (!acc[round.round_number]) acc[round.round_number] = [];
          acc[round.round_number].push(round);
          return acc;
        }, {} as Record<number, RankedChoiceRound[]>);

        const totalRounds = Math.max(...roundData.map(r => r.round_number));
        
        // Build candidate results
        Object.entries(roundsByNumber).forEach(([roundNumStr, roundRounds]) => {
          const roundNum = parseInt(roundNumStr);
          
          roundRounds.forEach(round => {
            if (!candidateMap.has(round.option_name)) {
              candidateMap.set(round.option_name, {
                name: round.option_name,
                position: 0, // Will be calculated later
                lastRoundParticipated: roundNum,
                lastRoundVotes: round.vote_count,
                lastRoundPercentage: Math.round((round.vote_count / results.total_votes) * 100),
                isWinner: round.option_name === results.winner
              });
            }
            
            const candidate = candidateMap.get(round.option_name)!;
            
            // Update last round info
            if (roundNum > candidate.lastRoundParticipated) {
              candidate.lastRoundParticipated = roundNum;
              candidate.lastRoundVotes = round.vote_count;
              candidate.lastRoundPercentage = Math.round((round.vote_count / results.total_votes) * 100);
            }
            
            // Record elimination
            if (round.is_eliminated) {
              candidate.eliminatedInRound = roundNum;
            }
          });
        });

        // Sort candidates by ranking (winner first, then by last round participated, then by last votes)
        const sortedCandidates = Array.from(candidateMap.values()).sort((a, b) => {
          if (a.isWinner) return -1;
          if (b.isWinner) return 1;
          
          // Sort by last round participated (higher = lasted longer)
          if (a.lastRoundParticipated !== b.lastRoundParticipated) {
            return b.lastRoundParticipated - a.lastRoundParticipated;
          }
          
          // If same round, sort by votes in that round
          return b.lastRoundVotes - a.lastRoundVotes;
        });

        // Assign positions
        sortedCandidates.forEach((candidate, index) => {
          candidate.position = index + 1;
        });

        setCandidates(sortedCandidates);
      } catch (error) {
        console.error('Error processing ranked choice data:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchAndProcessData();
  }, [results.poll_id, results.total_votes, results.winner]);

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

  return (
    <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-6">
      <div className="text-center mb-6">
        <h3 className="text-lg font-semibold mb-2 text-gray-900 dark:text-white">Final Rankings</h3>
      </div>

      <div className="space-y-2">
        {candidates.map((candidate) => (
          <div key={candidate.name} className={`border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 ${
            candidate.isWinner 
              ? 'bg-green-100 dark:bg-green-900 border-green-300 dark:border-green-600' 
              : 'bg-white dark:bg-gray-700'
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                {/* Position number */}
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                  candidate.position === 1 
                    ? 'bg-yellow-400 text-yellow-900' 
                    : candidate.position === 2 
                    ? 'bg-gray-300 text-gray-700'
                    : candidate.position === 3
                    ? 'bg-orange-300 text-orange-800'
                    : 'bg-gray-200 text-gray-600'
                }`}>
                  {candidate.position}
                </div>
                
                {/* Candidate name */}
                <div className={`font-semibold ${
                  candidate.isWinner 
                    ? 'text-green-800 dark:text-green-200' 
                    : 'text-gray-900 dark:text-white'
                }`}>
                  {candidate.name}
                  {candidate.isWinner && <span className="ml-2 text-sm">👑 Winner</span>}
                </div>
              </div>

              {/* Final percentage */}
              <div className="text-right">
                <div className={`text-lg font-bold ${
                  candidate.isWinner 
                    ? 'text-green-800 dark:text-green-200' 
                    : 'text-gray-900 dark:text-white'
                }`}>
                  {candidate.lastRoundPercentage}%
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {candidate.lastRoundVotes} vote{candidate.lastRoundVotes !== 1 ? 's' : ''}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}