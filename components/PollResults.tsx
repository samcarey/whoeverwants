"use client";

import { PollResults } from "@/lib/supabase";

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
  // Placeholder for ranked choice results - implementation skipped as requested
  return (
    <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-6 text-center">
      <h3 className="text-lg font-semibold mb-2 text-gray-900 dark:text-white">Ranked Choice Results</h3>
      <p className="text-gray-600 dark:text-gray-400">
        {results.total_votes} total vote{results.total_votes !== 1 ? 's' : ''} received
      </p>
      <p className="text-sm text-gray-500 dark:text-gray-500 mt-2">
        Ranked choice result calculation coming soon...
      </p>
    </div>
  );
}