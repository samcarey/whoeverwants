"use client";

import { useState, useRef, useEffect } from "react";
import PollActionsCard from "@/components/PollActionsCard";
import PollResultsDisplay from "@/components/PollResults";

interface NominationVotingInterfaceProps {
  poll: any;
  existingNominations: string[];
  nominationChoices: string[];
  setNominationChoices: (choices: string[]) => void;
  isAbstaining: boolean;
  handleAbstain: () => void;
  voteError: string | null;
  voterName: string;
  setVoterName: (name: string) => void;
  handleVoteClick: () => void;
  isSubmitting: boolean;
  isPollClosed: boolean;
  isCreator: boolean;
  handleCloseClick: () => void;
  isClosingPoll: boolean;
  hasVoted: boolean;
  isEditingVote: boolean;
  setIsEditingVote: (editing: boolean) => void;
  userVoteData: any;
  isLoadingVoteData: boolean;
  pollResults: any;
  loadingResults: boolean;
  loadExistingNominations: () => void;
}

export default function NominationVotingInterface({
  poll,
  existingNominations,
  nominationChoices,
  setNominationChoices,
  isAbstaining,
  handleAbstain,
  voteError,
  voterName,
  setVoterName,
  handleVoteClick,
  isSubmitting,
  isPollClosed,
  isCreator,
  handleCloseClick,
  isClosingPoll,
  hasVoted,
  isEditingVote,
  setIsEditingVote,
  userVoteData,
  isLoadingVoteData,
  pollResults,
  loadingResults,
  loadExistingNominations
}: NominationVotingInterfaceProps) {
  const [newNomination, setNewNomination] = useState("");
  const optionRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Add nomination to choices
  const addNomination = () => {
    if (newNomination.trim() && !nominationChoices.includes(newNomination.trim())) {
      setNominationChoices([...nominationChoices, newNomination.trim()]);
      setNewNomination("");
      // Refresh existing nominations after adding
      loadExistingNominations();
    }
  };

  // Remove nomination from choices
  const removeNomination = (index: number) => {
    setNominationChoices(nominationChoices.filter((_, i) => i !== index));
  };

  // Add existing nomination to choices
  const addExistingNomination = (nomination: string) => {
    if (!nominationChoices.includes(nomination)) {
      setNominationChoices([...nominationChoices, nomination]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addNomination();
    }
  };

  if (isPollClosed) {
    return (
      <div>
        {loadingResults ? (
          <div className="flex justify-center items-center py-8">
            <svg className="animate-spin h-8 w-8 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 714 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </div>
        ) : pollResults ? (
          <>
            {userVoteData?.is_abstain && (
              <div className="mt-4 flex justify-center">
                <div className="inline-flex items-center px-3 py-2 bg-yellow-100 dark:bg-yellow-900 border border-yellow-300 dark:border-yellow-700 rounded-full">
                  <span className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                    You Abstained
                  </span>
                </div>
              </div>
            )}
            
            <PollActionsCard poll={poll} isPollClosed={isPollClosed} />
          </>
        ) : (
          <div className="text-center py-4">
            <p className="text-gray-600 dark:text-gray-400">Unable to load results.</p>
          </div>
        )}
      </div>
    );
  }

  if (hasVoted && !isEditingVote) {
    return (
      <div className="text-center py-3">
        <div className="text-left">
          <div className="flex items-center justify-between mb-2">
            <h4 className="font-medium">Your nominations:</h4>
            {!isLoadingVoteData && !isPollClosed && (
              <button
                onClick={() => setIsEditingVote(true)}
                className="px-3 py-1 bg-yellow-400 hover:bg-yellow-500 text-yellow-900 font-medium text-sm rounded-md transition-colors"
              >
                Edit
              </button>
            )}
          </div>
          {isLoadingVoteData ? (
            <div className="space-y-2">
              {[1, 2, 3].map((num) => (
                <div key={num} className="flex items-center p-2 bg-gray-50 dark:bg-gray-800 rounded animate-pulse">
                  <div className="w-6 h-6 bg-gray-300 dark:bg-gray-600 rounded-full flex items-center justify-center text-sm font-medium mr-3">
                    <svg className="animate-spin h-3 w-3 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 718-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 714 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  </div>
                  <div className="h-4 bg-gray-300 dark:bg-gray-600 rounded w-24"></div>
                </div>
              ))}
              <div className="text-sm text-gray-500 dark:text-gray-400 mt-2">Loading your nominations...</div>
            </div>
          ) : (
            <div className="space-y-2">
              {userVoteData?.is_abstain || isAbstaining ? (
                <div className="flex items-center p-3 bg-yellow-50 dark:bg-yellow-900 border border-yellow-200 dark:border-yellow-700 rounded-lg">
                  <span className="w-8 h-8 bg-yellow-600 text-white rounded-full flex items-center justify-center text-sm font-bold mr-3">
                  </span>
                  <span className="font-medium text-yellow-800 dark:text-yellow-200">Abstained</span>
                </div>
              ) : (
                nominationChoices.map((choice, index) => (
                  <div key={index} className="flex items-center p-2 bg-gray-50 dark:bg-gray-800 rounded">
                    <span className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-medium mr-3">
                      {index + 1}
                    </span>
                    <span>{choice}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
        
        <PollActionsCard poll={poll} isPollClosed={false} />
        
        {!isPollClosed && (isCreator || process.env.NODE_ENV === 'development') && (
          <div className="mt-3 flex justify-center">
            <button
              onClick={handleCloseClick}
              disabled={isClosingPoll}
              className="inline-flex items-center px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white text-sm font-medium rounded-lg transition-colors disabled:cursor-not-allowed"
            >
              {isClosingPoll ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 718-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 714 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Closing Poll...
                </>
              ) : (
                'Close Poll'
              )}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="p-3 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg mb-2">
        <h4 className="text-base font-medium text-gray-900 dark:text-white mb-3">
          Add nominations
        </h4>
        
        {/* Existing nominations from other voters */}
        {existingNominations.length > 0 && (
          <div className="mb-4">
            <h5 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Existing nominations (click to add):
            </h5>
            <div className="flex flex-wrap gap-2">
              {existingNominations.filter(nom => !nominationChoices.includes(nom)).map((nomination, index) => (
                <button
                  key={index}
                  onClick={() => addExistingNomination(nomination)}
                  disabled={isSubmitting || isAbstaining}
                  className="px-3 py-1 bg-blue-100 hover:bg-blue-200 dark:bg-blue-900 dark:hover:bg-blue-800 text-blue-800 dark:text-blue-200 rounded-full text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  + {nomination}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Your nominations */}
        {nominationChoices.length > 0 && (
          <div className="mb-4">
            <h5 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Your nominations:
            </h5>
            <div className="space-y-2">
              {nominationChoices.map((choice, index) => (
                <div key={index} className="flex items-center justify-between p-2 bg-white dark:bg-gray-700 rounded border">
                  <span className="flex-1">{choice}</span>
                  <button
                    onClick={() => removeNomination(index)}
                    disabled={isSubmitting || isAbstaining}
                    className="ml-2 p-1 text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Add new nomination */}
        <div className="mb-4">
          <div className="flex gap-2">
            <input
              type="text"
              value={newNomination}
              onChange={(e) => setNewNomination(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isSubmitting || isAbstaining}
              className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
              placeholder="Add a new nomination..."
              maxLength={35}
            />
            <button
              onClick={addNomination}
              disabled={!newNomination.trim() || isSubmitting || isAbstaining || nominationChoices.includes(newNomination.trim())}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-md transition-colors disabled:cursor-not-allowed"
            >
              Add
            </button>
          </div>
        </div>

        {/* Abstain button */}
        <div className="mb-4">
          <button 
            onClick={handleAbstain}
            disabled={isSubmitting}
            className={`w-full py-3 px-4 rounded-lg font-medium transition-colors disabled:cursor-not-allowed ${
              isAbstaining
                ? 'bg-yellow-200 dark:bg-yellow-800 text-yellow-900 dark:text-yellow-100 border-2 border-yellow-400 dark:border-yellow-600' 
                : 'bg-yellow-100 hover:bg-yellow-200 dark:bg-yellow-900 dark:hover:bg-yellow-800 text-yellow-800 dark:text-yellow-200 border-2 border-transparent'
            }`}
          >
            {isAbstaining ? 'Abstaining (click to cancel)' : 'Abstain from this vote'}
          </button>
        </div>
        
        {voteError && (
          <div className="mb-4 p-3 bg-red-100 dark:bg-red-900 border border-red-300 dark:border-red-600 text-red-700 dark:text-red-300 rounded-md text-sm">
            {voteError}
          </div>
        )}
      </div>

      <div className="mb-4">
        <label htmlFor="voterName" className="block text-sm font-medium mb-2">
          Your Name (optional)
        </label>
        <input
          type="text"
          id="voterName"
          value={voterName}
          onChange={(e) => setVoterName(e.target.value)}
          disabled={isSubmitting}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
          placeholder="Enter your name..."
          maxLength={50}
        />
      </div>
      
      <button
        onClick={handleVoteClick}
        disabled={isSubmitting || (nominationChoices.length === 0 && !isAbstaining)}
        className="w-full rounded-full border border-solid border-transparent transition-colors flex items-center justify-center bg-foreground text-background hover:bg-[#383838] dark:hover:bg-[#ccc] font-medium text-base h-12 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isSubmitting ? 'Submitting...' : 'Submit Vote'}
      </button>
      
      <PollActionsCard poll={poll} isPollClosed={false} />
      
      {!isPollClosed && (isCreator || process.env.NODE_ENV === 'development') && (
        <div className="mt-3 flex justify-center">
          <button
            onClick={handleCloseClick}
            disabled={isClosingPoll}
            className="inline-flex items-center px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white text-sm font-medium rounded-lg transition-colors disabled:cursor-not-allowed"
          >
            {isClosingPoll ? (
              <>
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 718-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 714 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Closing Poll...
              </>
            ) : (
              'Close Poll'
            )}
          </button>
        </div>
      )}
    </>
  );
}