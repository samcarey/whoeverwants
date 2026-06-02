"use client";

import { useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Question } from "@/lib/types";
import {
  apiSubmitPollVotes,
  QUESTION_VOTES_CHANGED_EVENT,
  type ApiVote,
  type PollVoteItem,
} from "@/lib/api";
import { buildPollVoteItem } from "@/components/QuestionBallot/voteDataBuilders";
import { getUserName, saveUserName } from "@/lib/userProfile";
import { invalidateQuestion } from "@/lib/questionCache";
import { clearQuestionDraft } from "@/lib/ballotDraft";
import { haptic } from "@/lib/haptics";
import {
  loadVotedQuestions,
  parseYesNoChoice,
  setStoredVoteId,
  setVotedQuestionFlag,
} from "@/lib/votedQuestionsStorage";
import type { Group } from "@/lib/groupUtils";

export type YesNoChoice = "yes" | "no" | "abstain";

export type UserYesNoVote = {
  choice: YesNoChoice | null;
  voteId: string;
  voterName: string | null;
};

export type WrapperSubmitState = { visible: boolean; label: string };

export type PreparedNonYesNoEntry = {
  questionId: string;
  item: PollVoteItem;
  commit: (vote: ApiVote) => void;
  fail: (errorMessage: string) => void;
};

export type PendingPollSubmit = {
  pollId: string;
  subQuestions: Question[];
  stagedCount: number;
  preparedNonYesNo: PreparedNonYesNoEntry[];
};

interface UseGroupVotingArgs {
  group: Group | null;
  setVotedQuestionIds: Dispatch<SetStateAction<Set<string>>>;
  setAbstainedQuestionIds: Dispatch<SetStateAction<Set<string>>>;
  // "Plus one/more": returns the poll-level plus-ones at submit time — freeform
  // `names` (weighted on the submitter's row) and looked-up `userIds` (each
  // gets its own seeded editable vote). Null when the poll doesn't allow
  // plus-ones. Read at submit time so the latest list wins.
  getPlusOnes?: () => { names: string[]; userIds: string[] } | null;
}

/**
 * Owns every piece of state and every handler involved in submitting or
 * editing a vote from the group page. Pulled out of `app/p/[shortId]/
 * page.tsx` so the page only deals with group layout/expand/scroll concerns
 * while voting flows live in one place.
 *
 * Why setVotedQuestionIds / setAbstainedQuestionIds are passed in: the page owns those
 * sets because they're also seeded synchronously alongside the cached group
 * (and consumed by the awaiting-response sort + golden-border predicate
 * outside the voting flow). The hook calls `loadVotedQuestions()` post-write and
 * pushes the fresh sets back through these setters.
 */
export function useGroupVoting({
  group,
  setVotedQuestionIds,
  setAbstainedQuestionIds,
  getPlusOnes,
}: UseGroupVotingArgs) {
  const [userVoteMap, setUserVoteMap] = useState<Map<string, UserYesNoVote>>(
    () => new Map(),
  );

  const [pendingVoteChange, setPendingVoteChange] = useState<
    { questionId: string; newChoice: YesNoChoice } | null
  >(null);
  const [voteChangeSubmitting, setVoteChangeSubmitting] = useState(false);

  const [pendingPollChoices, setPendingPollChoices] = useState<
    Map<string, YesNoChoice>
  >(() => new Map());

  const [pendingPollSubmit, setPendingPollSubmit] =
    useState<PendingPollSubmit | null>(null);
  const [pollSubmitting, setPollSubmitting] = useState<Set<string>>(
    () => new Set(),
  );
  const [pollSubmitError, setPollSubmitError] = useState<Map<string, string>>(
    () => new Map(),
  );

  const [wrapperSubmitState, setWrapperSubmitState] = useState<
    Map<string, WrapperSubmitState>
  >(() => new Map());
  const handleWrapperSubmitStateChange = useRef(
    (questionId: string, state: WrapperSubmitState) => {
      setWrapperSubmitState((prev) => {
        const cur = prev.get(questionId);
        if (cur && cur.visible === state.visible && cur.label === state.label) return prev;
        const next = new Map(prev);
        next.set(questionId, state);
        return next;
      });
    },
  ).current;

  // Shared post-`apiSubmitPollVotes` sync used by every poll-vote write path.
  // Per CLAUDE.md, localStorage flags must be written BEFORE dispatching
  // QUESTION_VOTES_CHANGED_EVENT — listeners (e.g. the group page's golden
  // border re-evaluator) read localStorage in the handler.
  const syncStateAfterPollVotes = (returnedVotes: ApiVote[], voter_name: string | null) => {
    for (const v of returnedVotes) {
      setStoredVoteId(v.question_id, v.id);
      setVotedQuestionFlag(v.question_id, v.is_abstain ? "abstained" : true);
    }
    const fresh = loadVotedQuestions();
    setVotedQuestionIds(fresh.votedQuestionIds);
    setAbstainedQuestionIds(fresh.abstainedQuestionIds);
    if (voter_name) saveUserName(voter_name);
    for (const v of returnedVotes) {
      window.dispatchEvent(
        new CustomEvent(QUESTION_VOTES_CHANGED_EVENT, { detail: { questionId: v.question_id } }),
      );
    }
  };

  const buildYesNoPollItems = (subQuestions: Question[]): PollVoteItem[] => {
    const items: PollVoteItem[] = [];
    for (const sp of subQuestions) {
      if (sp.question_type !== "yes_no") continue;
      const staged = pendingPollChoices.get(sp.id);
      if (!staged) continue;
      const existing = userVoteMap.get(sp.id);
      const voteData = {
        vote_type: "yes_no" as const,
        yes_no_choice: staged === "abstain" ? null : staged,
        is_abstain: staged === "abstain",
      };
      items.push(
        buildPollVoteItem(voteData, sp.id, existing?.voteId ?? null, {
          questionType: "yes_no",
          canSubmitSuggestions: false,
          isEditing: !!existing?.voteId,
        }),
      );
    }
    return items;
  };

  // Atomic on the server: any item failure rolls back the whole batch.
  const confirmPollSubmit = async (
    pollId: string,
    subQuestions: Question[],
    preparedNonYesNo: PreparedNonYesNoEntry[],
  ) => {
    haptic.success();
    setPollSubmitting((prev) => {
      if (prev.has(pollId)) return prev;
      const next = new Set(prev);
      next.add(pollId);
      return next;
    });
    setPollSubmitError((prev) => {
      if (!prev.has(pollId)) return prev;
      const next = new Map(prev);
      next.delete(pollId);
      return next;
    });
    try {
      const yesNoItems = buildYesNoPollItems(subQuestions);
      const nonYesNoItems = preparedNonYesNo.map((p) => p.item);
      const items: PollVoteItem[] = [...yesNoItems, ...nonYesNoItems];
      if (items.length === 0) {
        setPendingPollSubmit(null);
        return;
      }
      const voter_name = (getUserName() ?? "").trim() || null;
      const plusOnes = getPlusOnes?.() ?? null;
      const returnedVotes = await apiSubmitPollVotes(pollId, {
        voter_name,
        plus_one_names: plusOnes?.names ?? null,
        plus_one_user_ids: plusOnes?.userIds ?? null,
        items,
      });

      const subQuestionById = new Map(subQuestions.map((sp) => [sp.id, sp]));
      setUserVoteMap((prev) => {
        const next = new Map(prev);
        for (const v of returnedVotes) {
          const sp = subQuestionById.get(v.question_id);
          if (!sp || sp.question_type !== "yes_no") continue;
          next.set(sp.id, {
            choice: parseYesNoChoice(v),
            voteId: v.id,
            voterName: v.voter_name ?? null,
          });
        }
        return next;
      });

      const returnedByQuestionId = new Map(returnedVotes.map((v) => [v.question_id, v]));
      for (const prepared of preparedNonYesNo) {
        const v = returnedByQuestionId.get(prepared.questionId);
        if (v) prepared.commit(v);
      }

      setPendingPollChoices((prev) => {
        let mutated = false;
        for (const sp of subQuestions) {
          if (prev.has(sp.id)) {
            mutated = true;
            break;
          }
        }
        if (!mutated) return prev;
        const next = new Map(prev);
        for (const sp of subQuestions) next.delete(sp.id);
        return next;
      });

      // Staged yes/no choices are persisted per-poll (PollDetailPage) so they
      // survive a refresh before submitting; clear them now that they're saved.
      for (const sp of subQuestions) {
        if (sp.question_type === "yes_no" && sp.poll_id) {
          clearQuestionDraft(sp.poll_id, sp.id);
        }
      }

      syncStateAfterPollVotes(returnedVotes, voter_name);
      setPendingPollSubmit(null);
    } catch (err: unknown) {
      console.error("Poll vote submit failed:", err);
      const message = err instanceof Error ? err.message : "Submit failed.";
      for (const prepared of preparedNonYesNo) prepared.fail(message);
      setPollSubmitError((prev) => {
        const next = new Map(prev);
        next.set(pollId, message);
        return next;
      });
    } finally {
      setPollSubmitting((prev) => {
        if (!prev.has(pollId)) return prev;
        const next = new Set(prev);
        next.delete(pollId);
        return next;
      });
    }
  };

  // Always routes through the unified poll endpoint as a single-item batch,
  // matching the "vote submission is always atomic across the poll" rule
  // even for single-question polls.
  const submitYesNoChoice = async (
    questionId: string,
    newChoice: YesNoChoice,
  ) => {
    const current = userVoteMap.get(questionId);
    const subQuestion = group?.questions.find((p) => p.id === questionId);
    const pollId = subQuestion?.poll_id ?? null;
    if (!pollId) {
      // Phase 5: every question has a poll wrapper, so this branch is dead.
      // Surface as a runtime error rather than silently dropping the vote.
      console.error("submitYesNoChoice called for question without poll_id");
      return;
    }
    haptic.success();
    setVoteChangeSubmitting(true);
    try {
      const voter_name = current
        ? current.voterName
        : (getUserName()?.trim() || null);
      const voteData = {
        vote_type: "yes_no" as const,
        yes_no_choice: newChoice === "abstain" ? null : newChoice,
        is_abstain: newChoice === "abstain",
      };
      const item = buildPollVoteItem(voteData, questionId, current?.voteId ?? null, {
        questionType: "yes_no",
        canSubmitSuggestions: false,
        isEditing: !!current?.voteId,
      });
      const plusOnes = getPlusOnes?.() ?? null;
      const returned = await apiSubmitPollVotes(pollId, {
        voter_name,
        plus_one_names: plusOnes?.names ?? null,
        plus_one_user_ids: plusOnes?.userIds ?? null,
        items: [item],
      });
      const v = returned.find((r) => r.question_id === questionId);
      if (!v) throw new Error("Vote response missing for question");
      const resultVoteId = v.id;
      const resultVoterName = v.voter_name ?? null;
      if (!current) setStoredVoteId(questionId, resultVoteId);
      if (voter_name) saveUserName(voter_name);
      invalidateQuestion(questionId);
      setUserVoteMap((prev) => {
        const next = new Map(prev);
        next.set(questionId, {
          choice: newChoice,
          voteId: resultVoteId,
          voterName: resultVoterName,
        });
        return next;
      });
      setVotedQuestionFlag(questionId, newChoice === "abstain" ? "abstained" : true);
      const fresh = loadVotedQuestions();
      setVotedQuestionIds(fresh.votedQuestionIds);
      setAbstainedQuestionIds(fresh.abstainedQuestionIds);
      window.dispatchEvent(
        new CustomEvent(QUESTION_VOTES_CHANGED_EVENT, { detail: { questionId } }),
      );
      setPendingVoteChange(null);
    } catch (err) {
      console.error("Vote submit/change failed:", err);
    } finally {
      setVoteChangeSubmitting(false);
    }
  };

  const confirmVoteChange = async () => {
    if (!pendingVoteChange) return;
    await submitYesNoChoice(pendingVoteChange.questionId, pendingVoteChange.newChoice);
  };

  return {
    userVoteMap,
    setUserVoteMap,
    pendingVoteChange,
    setPendingVoteChange,
    voteChangeSubmitting,
    pendingPollChoices,
    setPendingPollChoices,
    pendingPollSubmit,
    setPendingPollSubmit,
    pollSubmitting,
    pollSubmitError,
    wrapperSubmitState,
    handleWrapperSubmitStateChange,
    confirmPollSubmit,
    confirmVoteChange,
    submitYesNoChoice,
  };
}
