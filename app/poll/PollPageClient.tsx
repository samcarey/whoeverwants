"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Countdown from "@/components/Countdown";
import UrlCopy from "@/components/UrlCopy";
import SuccessPopup from "@/components/SuccessPopup";
import RankableOptions from "@/components/RankableOptions";
import { Poll, supabase } from "@/lib/supabase";

interface PollPageClientProps {
  poll: Poll;
  createdDate: string;
}

export default function PollPageClient({ poll, createdDate }: PollPageClientProps) {
  const searchParams = useSearchParams();
  const isNewPoll = searchParams.get("new") === "true";
  const [showSuccessPopup, setShowSuccessPopup] = useState(isNewPoll);
  const [pollUrl, setPollUrl] = useState("");
  const [rankedChoices, setRankedChoices] = useState<string[]>([]);
  const [yesNoChoice, setYesNoChoice] = useState<'yes' | 'no' | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasVoted, setHasVoted] = useState(false);
  const [voteError, setVoteError] = useState<string | null>(null);

  const isPollExpired = poll.response_deadline && new Date(poll.response_deadline) <= new Date();

  useEffect(() => {
    // Set the poll URL on the client side to avoid SSR issues
    setPollUrl(`${window.location.origin}/poll?id=${poll.id}`);
    
    // Initialize ranked choices for ranked choice polls
    if (poll.poll_type === 'ranked_choice' && poll.options) {
      setRankedChoices([...poll.options]);
    }
  }, [poll.id, poll.poll_type, poll.options]);

  const handleRankingChange = (newRankedChoices: string[]) => {
    setRankedChoices(newRankedChoices);
  };

  const handleYesNoVote = (choice: 'yes' | 'no') => {
    setYesNoChoice(choice);
  };

  const submitVote = async () => {
    if (isSubmitting || hasVoted || isPollExpired) return;

    setIsSubmitting(true);
    setVoteError(null);

    try {
      let voteData;
      
      if (poll.poll_type === 'yes_no') {
        if (!yesNoChoice) {
          setVoteError("Please select Yes or No");
          return;
        }
        voteData = {
          poll_id: poll.id,
          vote_type: 'yes_no' as const,
          yes_no_choice: yesNoChoice
        };
      } else {
        if (rankedChoices.length === 0) {
          setVoteError("Please rank the options");
          return;
        }
        voteData = {
          poll_id: poll.id,
          vote_type: 'ranked_choice' as const,
          ranked_choices: rankedChoices
        };
      }

      const { error } = await supabase
        .from('votes')
        .insert([voteData]);

      if (error) {
        console.error('Error submitting vote:', error);
        setVoteError("Failed to submit vote. Please try again.");
        return;
      }

      setHasVoted(true);
    } catch (error) {
      console.error('Unexpected error:', error);
      setVoteError("An unexpected error occurred. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <div className="max-w-md mx-auto">
        <div className="bg-white dark:bg-gray-900 rounded-lg shadow-lg p-6">
          <h1 className="text-2xl font-bold mb-4 text-center">{poll.title}</h1>
          
          <Countdown deadline={poll.response_deadline} />
          
          {/* Poll Content Based on Type */}
          {poll.poll_type === 'yes_no' ? (
            <div className="mb-6">
              {hasVoted ? (
                <div className="text-center py-6">
                  <div className="bg-green-100 dark:bg-green-900 border border-green-300 dark:border-green-600 rounded-lg p-4 mb-4">
                    <h3 className="font-semibold text-green-800 dark:text-green-200 mb-2">Vote Submitted!</h3>
                    <p className="text-green-700 dark:text-green-300">Your vote for &ldquo;{yesNoChoice}&rdquo; has been recorded.</p>
                  </div>
                </div>
              ) : isPollExpired ? (
                <div className="text-center py-6">
                  <div className="bg-red-100 dark:bg-red-900 border border-red-300 dark:border-red-600 rounded-lg p-4">
                    <h3 className="font-semibold text-red-800 dark:text-red-200 mb-2">Poll Closed</h3>
                    <p className="text-red-700 dark:text-red-300">This poll has expired and is no longer accepting votes.</p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex gap-3 mb-4">
                    <button 
                      onClick={() => handleYesNoVote('yes')}
                      className={`flex-1 py-3 px-4 rounded-lg font-medium transition-colors ${
                        yesNoChoice === 'yes' 
                          ? 'bg-green-200 dark:bg-green-800 text-green-900 dark:text-green-100 border-2 border-green-400 dark:border-green-600' 
                          : 'bg-green-100 hover:bg-green-200 dark:bg-green-900 dark:hover:bg-green-800 text-green-800 dark:text-green-200 border-2 border-transparent'
                      }`}
                    >
                      Yes
                    </button>
                    <button 
                      onClick={() => handleYesNoVote('no')}
                      className={`flex-1 py-3 px-4 rounded-lg font-medium transition-colors ${
                        yesNoChoice === 'no' 
                          ? 'bg-red-200 dark:bg-red-800 text-red-900 dark:text-red-100 border-2 border-red-400 dark:border-red-600' 
                          : 'bg-red-100 hover:bg-red-200 dark:bg-red-900 dark:hover:bg-red-800 text-red-800 dark:text-red-200 border-2 border-transparent'
                      }`}
                    >
                      No
                    </button>
                  </div>
                  
                  {voteError && (
                    <div className="mb-4 p-3 bg-red-100 dark:bg-red-900 border border-red-300 dark:border-red-600 text-red-700 dark:text-red-300 rounded-md text-sm">
                      {voteError}
                    </div>
                  )}
                  
                  <button
                    onClick={submitVote}
                    disabled={isSubmitting || !yesNoChoice}
                    className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white font-medium rounded-lg transition-colors disabled:cursor-not-allowed"
                  >
                    {isSubmitting ? 'Submitting...' : 'Submit Vote'}
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="mb-6">
              {hasVoted ? (
                <div className="text-center py-6">
                  <div className="bg-green-100 dark:bg-green-900 border border-green-300 dark:border-green-600 rounded-lg p-4 mb-4">
                    <h3 className="font-semibold text-green-800 dark:text-green-200 mb-2">Vote Submitted!</h3>
                    <p className="text-green-700 dark:text-green-300">Your ranked choices have been recorded.</p>
                  </div>
                  <div className="text-left">
                    <h4 className="font-medium mb-2">Your ranking:</h4>
                    <div className="space-y-2">
                      {rankedChoices.map((choice, index) => (
                        <div key={index} className="flex items-center p-2 bg-gray-50 dark:bg-gray-800 rounded">
                          <span className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-medium mr-3">
                            {index + 1}
                          </span>
                          <span>{choice}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : isPollExpired ? (
                <div className="text-center py-6">
                  <div className="bg-red-100 dark:bg-red-900 border border-red-300 dark:border-red-600 rounded-lg p-4 mb-4">
                    <h3 className="font-semibold text-red-800 dark:text-red-200 mb-2">Poll Closed</h3>
                    <p className="text-red-700 dark:text-red-300">This poll has expired and is no longer accepting votes.</p>
                  </div>
                  <div className="text-left">
                    <h4 className="font-medium mb-2">Options were:</h4>
                    <div className="space-y-2">
                      {poll.options?.map((option, index) => (
                        <div key={index} className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                          <span className="font-medium">{index + 1}.</span> {option}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  {poll.options && (
                    <RankableOptions 
                      options={poll.options} 
                      onRankingChange={handleRankingChange}
                      disabled={isSubmitting}
                    />
                  )}
                  
                  {voteError && (
                    <div className="mt-4 p-3 bg-red-100 dark:bg-red-900 border border-red-300 dark:border-red-600 text-red-700 dark:text-red-300 rounded-md text-sm">
                      {voteError}
                    </div>
                  )}
                  
                  <button
                    onClick={submitVote}
                    disabled={isSubmitting || rankedChoices.length === 0}
                    className="w-full mt-4 py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white font-medium rounded-lg transition-colors disabled:cursor-not-allowed"
                  >
                    {isSubmitting ? 'Submitting...' : 'Submit Vote'}
                  </button>
                </>
              )}
            </div>
          )}
          
          {pollUrl && <UrlCopy url={pollUrl} />}
          
          <div className="text-center text-gray-600 dark:text-gray-300 mb-6">
            <p className="text-sm">Created on</p>
            <p className="font-medium">{createdDate}</p>
          </div>

          <div className="text-center">
            <Link
              href="/"
              className="inline-flex items-center rounded-full border border-solid border-gray-300 dark:border-gray-600 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 px-6 py-2 text-sm font-medium"
            >
              <svg
                className="w-4 h-4 mr-2"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12v0"
                />
              </svg>
              Home
            </Link>
          </div>
        </div>
      </div>

      <SuccessPopup 
        show={showSuccessPopup} 
        onClose={() => setShowSuccessPopup(false)} 
      />
    </>
  );
}