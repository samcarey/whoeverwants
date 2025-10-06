"use client";

import { useState, useRef, useEffect, Dispatch, SetStateAction } from "react";
import FollowUpButton from "@/components/FollowUpButton";
import PollResultsDisplay from "@/components/PollResults";
import OptionsInput from "@/components/OptionsInput";
import NominationsList from "@/components/NominationsList";

interface NominationVotingInterfaceProps {
  poll: any;
  existingNominations: string[];
  nominationChoices: string[];
  setNominationChoices: Dispatch<SetStateAction<string[]>>;
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
  setShowFollowUpModal: (show: boolean) => void;
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
  loadExistingNominations,
  setShowFollowUpModal
}: NominationVotingInterfaceProps) {
  const [newNominations, setNewNominations] = useState<string[]>([""]);
  const [filteredExistingNominations, setFilteredExistingNominations] = useState<string[]>([]);

  // Helper function to convert existingNominations to format expected by NominationsList
  const getNominationsWithCounts = () => {
    if (pollResults?.options && pollResults.poll_type === 'nomination') {
      // Use pollResults data when available (shows vote counts)
      // pollResults.options is already in the correct format
      return pollResults.options;
    } else {
      // Fallback to existingNominations without counts
      return existingNominations.map(nomination => ({
        option: nomination,
        count: 0
      }));
    }
  };

  // Initialize edit mode - show user's nominations as editable and others as selectable
  useEffect(() => {
    if (isEditingVote && userVoteData?.nominations && Array.isArray(userVoteData.nominations)) {
      // In edit mode, put ALL user's nominations into text fields for editing
      // This allows them to edit any nomination they made, whether originally created or seconded
      const editableNoms = [...userVoteData.nominations];
      // Add empty field at the end for new nominations
      if (editableNoms.length === 0 || editableNoms[editableNoms.length - 1] !== '') {
        editableNoms.push('');
      }
      setNewNominations(editableNoms);

      // Show ALL existing nominations from others as buttons
      // Filter out the user's own nominations to avoid duplication
      const otherNominations = existingNominations.filter(nom => !userVoteData.nominations.includes(nom));
      setFilteredExistingNominations(otherNominations);

      // Pre-select the user's existing nominations so they can see what they voted for
      setNominationChoices([...userVoteData.nominations]);
    } else {
      // Not in edit mode, show all existing nominations
      setFilteredExistingNominations(existingNominations);
    }
  }, [isEditingVote, userVoteData, existingNominations, setNominationChoices]);

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
    // Filter out duplicates
    const uniqueNewNoms = filledNominations.filter((nom, index, self) =>
      self.indexOf(nom) === index
    );

    // Update choices with new nominations
    setNominationChoices((prevChoices: string[]) => {
      if (isEditingVote) {
        // In edit mode: ONLY use text field nominations + manually selected existing buttons
        // Get manually selected existing nominations (not from text fields)
        const manuallySelectedExisting = prevChoices.filter(n =>
          existingNominations.includes(n) &&
          !uniqueNewNoms.includes(n) && // Not in text fields
          !userVoteData.nominations.includes(n) // Not user's original nominations
        );

        // Combine text field nominations + manually selected buttons
        return [...uniqueNewNoms, ...manuallySelectedExisting];
      } else {
        // Normal mode - don't include nominations that are already in existingNominations
        const newNomsNotInExisting = uniqueNewNoms.filter(nom => !existingNominations.includes(nom));
        // Keep existing selections + new nominations
        const selectedExisting = prevChoices.filter(n => existingNominations.includes(n));
        const newChoices = [...selectedExisting, ...newNomsNotInExisting];
        return newChoices;
      }
    });
  }, [newNominations, existingNominations, setNominationChoices, isEditingVote, userVoteData]);

  // Poll is closed
  if (isPollClosed) {
    return (
      <div className="text-center py-3">
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
          {isLoadingVoteData ? (
            <div className="space-y-2">
              {[1, 2, 3].map((num) => (
                <div key={num} className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-800 rounded animate-pulse">
                  <div className="h-4 bg-gray-300 dark:bg-gray-600 rounded w-24"></div>
                  <div className="w-6 h-6 bg-gray-300 dark:bg-gray-600 rounded-full"></div>
                </div>
              ))}
            </div>
          ) : existingNominations.length > 0 ? (
            <NominationsList
              nominations={getNominationsWithCounts()}
              userNominations={userVoteData?.is_abstain ? [] : (userVoteData?.nominations || [])}
              showVoteCounts={pollResults?.options && Array.isArray(pollResults.options)}
              showUserIndicator={true}
            />
          ) : (
            <p className="text-gray-600 dark:text-gray-400">No suggestions available</p>
          )}
        </div>

        {/* Edit and Follow Up Buttons */}
        {!isPollClosed && !isLoadingVoteData && (
          <div className="mt-4 flex justify-center items-center relative">
            <FollowUpButton onClick={() => setShowFollowUpModal(true)} />
            <button
              onClick={() => setIsEditingVote(true)}
              className="absolute right-0 px-3 py-1 bg-yellow-400 hover:bg-yellow-500 text-yellow-900 font-medium text-sm rounded-md transition-colors"
            >
              Edit
            </button>
          </div>
        )}

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
      </div>
    );
  }

  return (
    <>
      <div className="mt-4 p-3 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg mb-2">
        {/* Existing nominations from other voters */}
        {filteredExistingNominations.length > 0 && (
          <div className="mb-3">
            <h5 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {isEditingVote ? 'Other suggestions (select to second):' : 'Existing suggestions (select to second):'}
            </h5>
            <div className="space-y-2">
              {filteredExistingNominations.map((nomination, index) => {
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
                    disabled={isSubmitting}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                      isSelected
                        ? 'bg-green-100 hover:bg-green-200 dark:bg-green-900/30 dark:hover:bg-green-900/40 text-green-900 dark:text-green-100 font-medium border border-green-300 dark:border-green-700'
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
        <div className={filteredExistingNominations.length > 0 ? "mt-3" : ""}>
          <OptionsInput
            options={newNominations}
            setOptions={setNewNominations}
            isLoading={isSubmitting}
            pollType="nomination"
            label={isEditingVote ? "Your suggestions:" : "Add new suggestions:"}
          />
        </div>


        {voteError && (
          <div className="mt-3 p-3 bg-red-100 dark:bg-red-900 border border-red-300 dark:border-red-600 text-red-700 dark:text-red-300 rounded-md text-sm">
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
        disabled={isSubmitting}
        className={`w-full py-3 px-4 rounded-lg font-medium transition-colors disabled:cursor-not-allowed ${
          nominationChoices.length === 0 && !isSubmitting
            ? 'bg-yellow-100 hover:bg-yellow-200 dark:bg-yellow-900 dark:hover:bg-yellow-800 text-yellow-800 dark:text-yellow-200 border-2 border-yellow-300 dark:border-yellow-700'
            : 'bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white'
        }`}
      >
        {isSubmitting
          ? 'Submitting...'
          : nominationChoices.length === 0
            ? 'Submit (Abstain)'
            : 'Submit Vote'
        }
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