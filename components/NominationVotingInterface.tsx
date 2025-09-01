"use client";

import { useState, useRef, useEffect } from "react";
import PollActionsCard from "@/components/PollActionsCard";
import PollResultsDisplay from "@/components/PollResults";
import OptionsInput from "@/components/OptionsInput";

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
  const [newNominations, setNewNominations] = useState<string[]>([""]);

  // Add existing nomination to choices
  const addExistingNomination = (nomination: string) => {
    if (!nominationChoices.includes(nomination)) {
      setNominationChoices([...nominationChoices, nomination]);
    }
  };

  // Remove nomination from choices
  const removeNomination = (nomination: string) => {
    setNominationChoices(nominationChoices.filter(n => n !== nomination));
  };

  // Update nomination choices when new nominations change
  useEffect(() => {
    const filledNominations = newNominations.filter(n => n.trim() !== '');
    // Filter out duplicates and existing nominations
    const uniqueNewNoms = filledNominations.filter((nom, index, self) => 
      self.indexOf(nom) === index && !existingNominations.includes(nom)
    );
    
    // Combine selected existing nominations with new nominations
    const selectedExisting = nominationChoices.filter(n => existingNominations.includes(n));
    const combined = [...selectedExisting, ...uniqueNewNoms];
    
    if (JSON.stringify(combined) !== JSON.stringify(nominationChoices)) {
      setNominationChoices(combined);
    }
  }, [newNominations, existingNominations]);

  // Poll is closed
  if (isPollClosed) {
    return (
      <div className="text-center py-3">
        <h3 className="text-lg font-semibold mb-4">Poll Closed</h3>
        {loadingResults ? (
          <div className="flex justify-center">
            <svg className="animate-spin h-8 w-8 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
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
            </div>
          ) : userVoteData?.is_abstain ? (
            <div className="bg-yellow-100 dark:bg-yellow-900 border border-yellow-300 dark:border-yellow-700 rounded-lg p-3">
              <span className="text-yellow-800 dark:text-yellow-200">You abstained from this vote</span>
            </div>
          ) : userVoteData?.nominations && userVoteData.nominations.length > 0 ? (
            <div className="space-y-2">
              {userVoteData.nominations.map((nomination: string, index: number) => (
                <div key={index} className="flex items-center p-2 bg-gray-50 dark:bg-gray-800 rounded">
                  <div className="w-6 h-6 bg-blue-500 text-white rounded-full flex items-center justify-center text-sm font-medium mr-3">
                    {index + 1}
                  </div>
                  <span>{nomination}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-600 dark:text-gray-400">No nominations recorded</p>
          )}
        </div>
        
        <p className="mt-4 text-gray-600 dark:text-gray-400 italic">
          Thank you for voting! Results will be shown when the poll closes.
        </p>
        
        <PollActionsCard poll={poll} isPollClosed={isPollClosed} />
      </div>
    );
  }

  return (
    <>
      <div className="p-3 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg mb-2">
        {/* Existing nominations from other voters */}
        {existingNominations.length > 0 && (
          <div className="mb-4">
            <h5 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Existing nominations (select to second):
            </h5>
            <div className="space-y-2">
              {existingNominations.map((nomination, index) => {
                const isSelected = nominationChoices.includes(nomination);
                return (
                  <button
                    key={index}
                    onClick={() => {
                      if (isSelected) {
                        removeNomination(nomination);
                      } else {
                        addExistingNomination(nomination);
                      }
                    }}
                    disabled={isSubmitting || isAbstaining}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                      isSelected
                        ? 'bg-green-500 hover:bg-green-600 text-white font-medium'
                        : 'bg-white hover:bg-gray-50 dark:bg-gray-900 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-600'
                    }`}
                  >
                    {nomination}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Add new nominations using shared component */}
        <div className="mb-4">
          <OptionsInput
            options={newNominations}
            setOptions={setNewNominations}
            isLoading={isSubmitting || isAbstaining}
            pollType="nomination"
            label="Add new nominations:"
          />
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
            {isAbstaining ? 'Abstaining (click to cancel)' : 'Abstain'}
          </button>
        </div>
        
        {voteError && (
          <div className="mb-4 p-3 bg-red-100 dark:bg-red-900 border border-red-300 dark:border-red-600 text-red-700 dark:text-red-300 rounded-md text-sm">
            {voteError}
          </div>
        )}
      </div>

      {/* Voter Name Input */}
      <div className="mb-3">
        <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
          Your name (optional)
        </label>
        <input
          type="text"
          value={voterName}
          onChange={(e) => setVoterName(e.target.value)}
          disabled={isSubmitting}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
          placeholder="Enter your name (optional)"
          maxLength={50}
        />
      </div>

      {/* Submit Button */}
      <button 
        onClick={handleVoteClick}
        disabled={isSubmitting || (nominationChoices.length === 0 && !isAbstaining)}
        className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors disabled:cursor-not-allowed"
      >
        {isSubmitting ? 'Submitting...' : 'Submit Vote'}
      </button>

      {/* Close Poll Button for Creator */}
      {isCreator && !isPollClosed && (
        <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={handleCloseClick}
            disabled={isClosingPoll}
            className="w-full py-2 px-4 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white rounded-lg font-medium transition-colors disabled:cursor-not-allowed"
          >
            {isClosingPoll ? 'Closing Poll...' : 'Close Poll'}
          </button>
        </div>
      )}
    </>
  );
}