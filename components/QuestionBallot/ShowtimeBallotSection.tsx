"use client";

import { Dispatch, ReactNode, SetStateAction, useMemo } from "react";
import AbstainLink from "@/components/AbstainLink";
import ShowtimeBubbles, { slotsFromOptions } from "@/components/ShowtimeBubbles";
import type { Question } from "@/lib/types";

export interface ShowtimeBallotSectionProps {
  question: Question;
  isQuestionClosed: boolean;
  userVoteData: {
    liked_slots?: string[] | null;
    disliked_slots?: string[] | null;
    is_abstain?: boolean;
  } | null;
  isLoadingVoteData: boolean;
  hasVoted: boolean;
  isEditingVote: boolean;
  editVoteButton: ReactNode;
  isSubmitting: boolean;
  voteError: string | null;
  isAbstaining: boolean;
  handleAbstain: () => void;
  likedSlots: string[] | null;
  setLikedSlots: Dispatch<SetStateAction<string[] | null>>;
  dislikedSlots: string[] | null;
  setDislikedSlots: Dispatch<SetStateAction<string[] | null>>;
  wrapperHandlesSubmit: boolean;
  handleVoteClick: () => void;
}

export default function ShowtimeBallotSection({
  question,
  isQuestionClosed,
  userVoteData,
  isLoadingVoteData,
  hasVoted,
  isEditingVote,
  editVoteButton,
  isSubmitting,
  voteError,
  isAbstaining,
  handleAbstain,
  likedSlots,
  setLikedSlots,
  dislikedSlots,
  setDislikedSlots,
  wrapperHandlesSubmit,
  handleVoteClick,
}: ShowtimeBallotSectionProps) {
  const slots = useMemo(
    () => slotsFromOptions(question.options, question.options_metadata),
    [question.options, question.options_metadata],
  );

  // Functional updates so a BULK mark (the drag-select toolbar fires onToggle
  // once per selected key in a synchronous loop) composes under React batching —
  // reading `likedSlots`/`dislikedSlots` from the closure would let every call
  // see the same stale array and only the last key would survive.
  const toggle = (key: string, next: "want" | "neutral" | "cant") => {
    setLikedSlots((prev) => {
      const s = new Set(prev ?? []);
      if (next === "want") s.add(key);
      else s.delete(key);
      return Array.from(s);
    });
    setDislikedSlots((prev) => {
      const s = new Set(prev ?? []);
      if (next === "cant") s.add(key);
      else s.delete(key);
      return Array.from(s);
    });
  };

  // Read-only summary: closed, or voted-and-not-editing. Reflect the committed
  // reactions (from userVoteData) greyed out, with an edit affordance.
  const showCommitted = isQuestionClosed || (hasVoted && !isEditingVote);

  if (showCommitted) {
    const committedLiked = userVoteData?.liked_slots ?? [];
    const committedDisliked = userVoteData?.disliked_slots ?? [];
    return (
      <div className="question-content">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400">
            {isQuestionClosed ? "Showtimes" : "Your picks:"}
          </h3>
          {!isQuestionClosed && editVoteButton}
        </div>
        {userVoteData?.is_abstain ? (
          <div className="flex justify-center py-2">
            <span className="inline-flex items-center px-3 py-2 rounded-full bg-yellow-100 dark:bg-yellow-900 border border-yellow-300 dark:border-yellow-700 text-sm font-medium text-yellow-800 dark:text-yellow-200">
              You Abstained
            </span>
          </div>
        ) : (
          <ShowtimeBubbles
            mode="vote"
            slots={slots}
            likedKeys={committedLiked}
            dislikedKeys={committedDisliked}
            onToggle={() => {}}
            disabled
          />
        )}
      </div>
    );
  }

  return (
    <div className="question-content">
      <p className="mb-2 text-center text-sm text-gray-600 dark:text-gray-400">
        Mark each showtime you want or can&apos;t attend.
      </p>
      {isLoadingVoteData ? (
        <div className="flex justify-center py-6">
          <svg className="animate-spin h-6 w-6 text-gray-500" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      ) : (
        <ShowtimeBubbles
          mode="vote"
          slots={slots}
          likedKeys={isAbstaining ? [] : (likedSlots ?? [])}
          dislikedKeys={isAbstaining ? [] : (dislikedSlots ?? [])}
          onToggle={toggle}
          disabled={isAbstaining}
        />
      )}
      <AbstainLink isAbstaining={isAbstaining} onClick={handleAbstain} disabled={isSubmitting} className="mt-3" />
      {voteError && <p className="mt-2 text-center text-sm text-red-600 dark:text-red-400">{voteError}</p>}
      {!wrapperHandlesSubmit && (
        <button
          type="button"
          onClick={handleVoteClick}
          disabled={isSubmitting}
          className="mt-3 w-full py-3 px-4 rounded-lg bg-foreground text-background font-medium text-base transition-all active:scale-95 disabled:opacity-50"
        >
          {isSubmitting ? "Submitting..." : "Submit Vote"}
        </button>
      )}
    </div>
  );
}
