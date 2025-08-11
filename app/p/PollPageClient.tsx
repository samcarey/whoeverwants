"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Countdown from "@/components/Countdown";
import UrlCopy from "@/components/UrlCopy";
import SuccessPopup from "@/components/SuccessPopup";
import RankableOptions from "@/components/RankableOptions";
import PollResultsDisplay from "@/components/PollResults";
import { Poll, supabase, PollResults, getPollResults, closePoll } from "@/lib/supabase";
import { isCreatedByThisDevice, getPollCreatorSecret } from "@/lib/pollCreator";

interface PollPageClientProps {
  poll: Poll;
  createdDate: string;
  pollId: string | null;
}

export default function PollPageClient({ poll, createdDate, pollId }: PollPageClientProps) {
  const searchParams = useSearchParams();
  const isNewPoll = searchParams.get("new") === "true";
  const [showSuccessPopup, setShowSuccessPopup] = useState(isNewPoll);
  const [pollUrl, setPollUrl] = useState("");
  const [rankedChoices, setRankedChoices] = useState<string[]>([]);
  const [yesNoChoice, setYesNoChoice] = useState<'yes' | 'no' | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasVoted, setHasVoted] = useState(false);
  const [voteError, setVoteError] = useState<string | null>(null);
  const [pollResults, setPollResults] = useState<PollResults | null>(null);
  const [loadingResults, setLoadingResults] = useState(false);
  const [isClosingPoll, setIsClosingPoll] = useState(false);
  const [pollClosed, setPollClosed] = useState(poll.is_closed ?? false);
  const [isCreator, setIsCreator] = useState(false);

  const isPollExpired = poll.response_deadline && new Date(poll.response_deadline) <= new Date();
  const isPollClosed = pollClosed || isPollExpired;

  const fetchPollResults = useCallback(async () => {
    setLoadingResults(true);
    try {
      const results = await getPollResults(poll.id);
      setPollResults(results);
    } catch (error) {
      console.error('Error fetching poll results:', error);
    } finally {
      setLoadingResults(false);
    }
  }, [poll.id]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      // Set the poll URL using query parameter format
      setPollUrl(`${window.location.origin}/p?id=${poll.id}`);
    }
    
    // Check if this device created the poll
    setIsCreator(isCreatedByThisDevice(poll.id));
    
    // Initialize ranked choices for ranked choice polls
    if (poll.poll_type === 'ranked_choice' && poll.options) {
      // Parse options if they're stored as JSON string
      const parsedOptions = typeof poll.options === 'string' 
        ? JSON.parse(poll.options) 
        : poll.options;
      setRankedChoices([...parsedOptions]);
    }

    // Fetch results if poll is closed
    if (isPollClosed) {
      fetchPollResults();
    }
  }, [poll.id, poll.poll_type, poll.options, isPollClosed, fetchPollResults]);

  const handleRankingChange = (newRankedChoices: string[]) => {
    setRankedChoices(newRankedChoices);
  };

  const handleYesNoVote = (choice: 'yes' | 'no') => {
    setYesNoChoice(choice);
  };

  const handleClosePoll = async () => {
    if (isClosingPoll || !isCreator) return;
    
    const creatorSecret = getPollCreatorSecret(poll.id);
    if (!creatorSecret) {
      alert('You do not have permission to close this poll.');
      return;
    }
    
    setIsClosingPoll(true);
    try {
      const success = await closePoll(poll.id, creatorSecret);
      if (success) {
        // Refetch the poll data to get the updated is_closed value
        const { data: updatedPoll, error } = await supabase
          .from("polls")
          .select("*")
          .eq("id", poll.id)
          .single();
        
        // Poll updated successfully
        
        setPollClosed(true);
        await fetchPollResults();
      } else {
        alert('Failed to close poll. Please try again.');
      }
    } catch (error) {
      console.error('Error closing poll:', error);
      alert('Failed to close poll. Please try again.');
    } finally {
      setIsClosingPoll(false);
    }
  };

  const submitVote = async () => {
    if (isSubmitting || hasVoted || isPollClosed) return;

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
          <h1 className="text-2xl font-bold mb-4 text-center">{poll.title}</h1>
          
          
          {!isPollClosed && <Countdown deadline={poll.response_deadline || null} />}
          
          {/* Poll Content Based on Type */}
          {poll.poll_type === 'yes_no' ? (
            <div>
              {hasVoted ? (
                <div className="text-center">
                  <div className="bg-green-100 dark:bg-green-900 border border-green-300 dark:border-green-600 rounded-lg p-4 mb-4">
                    <h3 className="font-semibold text-green-800 dark:text-green-200 mb-2">Vote Submitted!</h3>
                    <p className="text-green-700 dark:text-green-300">Your vote for &ldquo;{yesNoChoice}&rdquo; has been recorded.</p>
                  </div>
                </div>
              ) : isPollClosed ? (
                <div className="py-6">
                  {loadingResults ? (
                    <div className="flex justify-center items-center py-8">
                      <svg className="animate-spin h-8 w-8 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                    </div>
                  ) : pollResults ? (
                    <PollResultsDisplay results={pollResults} />
                  ) : (
                    <div className="text-center py-4">
                      <p className="text-gray-600 dark:text-gray-400">Unable to load results.</p>
                    </div>
                  )}
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
            <div>
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
              ) : isPollClosed ? (
                <div>
                  {loadingResults ? (
                    <div className="flex justify-center items-center py-8">
                      <svg className="animate-spin h-8 w-8 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                    </div>
                  ) : pollResults ? (
                    <PollResultsDisplay results={pollResults} />
                  ) : (
                    <div className="text-center py-4">
                      <p className="text-gray-600 dark:text-gray-400">Unable to load results.</p>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {poll.options && (
                    <RankableOptions 
                      options={typeof poll.options === 'string' ? JSON.parse(poll.options) : poll.options} 
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
          
          {/* Close Poll Button for Poll Creators */}
          {!isPollClosed && isCreator && (
            <div className="mt-4 text-center">
              <button
                onClick={handleClosePoll}
                disabled={isClosingPoll}
                className="inline-flex items-center px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white text-sm font-medium rounded-lg transition-colors disabled:cursor-not-allowed"
              >
                {isClosingPoll ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Closing Poll...
                  </>
                ) : (
                  'Close Poll'
                )}
              </button>
            </div>
          )}
          
          {/* Created date line */}
          <div className="text-center text-gray-600 dark:text-gray-300 mt-4 mb-4">
            <p className="text-sm">
              Created {createdDate}
              {isPollClosed && pollResults && (
                <span> • {pollResults.total_votes} vote{pollResults.total_votes !== 1 ? 's' : ''}</span>
              )}
            </p>
          </div>

          {/* Bottom navigation */}
          <div className="flex justify-between items-center mt-1">
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
            
            {pollUrl && <UrlCopy url={pollUrl} />}
          </div>
      </div>

      <SuccessPopup 
        show={showSuccessPopup} 
        onClose={() => setShowSuccessPopup(false)} 
      />
    </>
  );
}