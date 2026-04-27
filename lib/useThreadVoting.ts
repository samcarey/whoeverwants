"use client";

import { useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Poll } from "@/lib/types";
import {
  apiSubmitMultipollVotes,
  POLL_VOTES_CHANGED_EVENT,
  type ApiVote,
  type MultipollVoteItem,
} from "@/lib/api";
import { buildMultipollVoteItem } from "@/components/SubPollBallot/voteDataBuilders";
import { getUserName, saveUserName } from "@/lib/userProfile";
import { invalidatePoll } from "@/lib/pollCache";
import {
  loadVotedPolls,
  parseYesNoChoice,
  setStoredVoteId,
  setVotedPollFlag,
} from "@/lib/votedPollsStorage";
import type { Thread } from "@/lib/threadUtils";

export type YesNoChoice = "yes" | "no" | "abstain";

export type UserYesNoVote = {
  choice: YesNoChoice | null;
  voteId: string;
  voterName: string | null;
};

export type WrapperSubmitState = { visible: boolean; label: string };

export type PreparedNonYesNoEntry = {
  pollId: string;
  item: MultipollVoteItem;
  commit: (vote: ApiVote) => void;
  fail: (errorMessage: string) => void;
};

export type PendingMultipollSubmit = {
  multipollId: string;
  subPolls: Poll[];
  stagedCount: number;
  preparedNonYesNo: PreparedNonYesNoEntry[];
};

interface UseThreadVotingArgs {
  thread: Thread | null;
  setVotedPollIds: Dispatch<SetStateAction<Set<string>>>;
  setAbstainedPollIds: Dispatch<SetStateAction<Set<string>>>;
}

/**
 * Owns every piece of state and every handler involved in submitting or
 * editing a vote from the thread page. Pulled out of `app/thread/[threadId]/
 * page.tsx` so the page only deals with thread layout/expand/scroll concerns
 * while voting flows live in one place.
 *
 * Why setVotedPollIds / setAbstainedPollIds are passed in: the page owns those
 * sets because they're also seeded synchronously alongside the cached thread
 * (and consumed by the awaiting-response sort + golden-border predicate
 * outside the voting flow). The hook calls `loadVotedPolls()` post-write and
 * pushes the fresh sets back through these setters.
 */
export function useThreadVoting({
  thread,
  setVotedPollIds,
  setAbstainedPollIds,
}: UseThreadVotingArgs) {
  const [userVoteMap, setUserVoteMap] = useState<Map<string, UserYesNoVote>>(
    () => new Map(),
  );

  const [pendingVoteChange, setPendingVoteChange] = useState<
    { pollId: string; newChoice: YesNoChoice } | null
  >(null);
  const [voteChangeSubmitting, setVoteChangeSubmitting] = useState(false);

  const [pendingMultipollChoices, setPendingMultipollChoices] = useState<
    Map<string, YesNoChoice>
  >(() => new Map());
  const [multipollVoterNames, setMultipollVoterNames] = useState<Map<string, string>>(
    () => new Map(),
  );
  // Same-value guard avoids no-op re-renders when both the all-yes_no Submit
  // row and the wrapper Submit row write the identical name on each keystroke.
  const setMultipollVoterName = useRef((id: string, name: string) => {
    setMultipollVoterNames((prev) =>
      prev.get(id) === name ? prev : new Map(prev).set(id, name),
    );
  }).current;

  const [pendingMultipollSubmit, setPendingMultipollSubmit] =
    useState<PendingMultipollSubmit | null>(null);
  const [multipollSubmitting, setMultipollSubmitting] = useState<Set<string>>(
    () => new Set(),
  );
  const [multipollSubmitError, setMultipollSubmitError] = useState<Map<string, string>>(
    () => new Map(),
  );

  const [wrapperSubmitState, setWrapperSubmitState] = useState<
    Map<string, WrapperSubmitState>
  >(() => new Map());
  const handleWrapperSubmitStateChange = useRef(
    (pollId: string, state: WrapperSubmitState) => {
      setWrapperSubmitState((prev) => {
        const cur = prev.get(pollId);
        if (cur && cur.visible === state.visible && cur.label === state.label) return prev;
        const next = new Map(prev);
        next.set(pollId, state);
        return next;
      });
    },
  ).current;

  const buildYesNoMultipollItems = (subPolls: Poll[]): MultipollVoteItem[] => {
    const items: MultipollVoteItem[] = [];
    for (const sp of subPolls) {
      if (sp.poll_type !== "yes_no") continue;
      const staged = pendingMultipollChoices.get(sp.id);
      if (!staged) continue;
      const existing = userVoteMap.get(sp.id);
      const voteData = {
        vote_type: "yes_no" as const,
        yes_no_choice: staged === "abstain" ? null : staged,
        is_abstain: staged === "abstain",
      };
      items.push(
        buildMultipollVoteItem(voteData, sp.id, existing?.voteId ?? null, {
          pollType: "yes_no",
          canSubmitSuggestions: false,
          isEditing: !!existing?.voteId,
        }),
      );
    }
    return items;
  };

  // Atomic on the server: any item failure rolls back the whole batch.
  const confirmMultipollSubmit = async (
    multipollId: string,
    subPolls: Poll[],
    preparedNonYesNo: PreparedNonYesNoEntry[],
  ) => {
    setMultipollSubmitting((prev) => {
      if (prev.has(multipollId)) return prev;
      const next = new Set(prev);
      next.add(multipollId);
      return next;
    });
    setMultipollSubmitError((prev) => {
      if (!prev.has(multipollId)) return prev;
      const next = new Map(prev);
      next.delete(multipollId);
      return next;
    });
    try {
      const yesNoItems = buildYesNoMultipollItems(subPolls);
      const nonYesNoItems = preparedNonYesNo.map((p) => p.item);
      const items: MultipollVoteItem[] = [...yesNoItems, ...nonYesNoItems];
      if (items.length === 0) {
        setPendingMultipollSubmit(null);
        return;
      }
      const voterNameRaw = multipollVoterNames.get(multipollId) ?? getUserName() ?? "";
      const voter_name = voterNameRaw.trim() || null;
      const returnedVotes = await apiSubmitMultipollVotes(multipollId, {
        voter_name,
        items,
      });

      const subPollById = new Map(subPolls.map((sp) => [sp.id, sp]));
      setUserVoteMap((prev) => {
        const next = new Map(prev);
        for (const v of returnedVotes) {
          const sp = subPollById.get(v.poll_id);
          if (!sp || sp.poll_type !== "yes_no") continue;
          next.set(sp.id, {
            choice: parseYesNoChoice(v),
            voteId: v.id,
            voterName: v.voter_name ?? null,
          });
        }
        return next;
      });

      const returnedByPollId = new Map(returnedVotes.map((v) => [v.poll_id, v]));
      for (const prepared of preparedNonYesNo) {
        const v = returnedByPollId.get(prepared.pollId);
        if (v) prepared.commit(v);
      }

      for (const v of returnedVotes) {
        setStoredVoteId(v.poll_id, v.id);
        setVotedPollFlag(v.poll_id, v.is_abstain ? "abstained" : true);
      }
      const fresh = loadVotedPolls();
      setVotedPollIds(fresh.votedPollIds);
      setAbstainedPollIds(fresh.abstainedPollIds);

      setPendingMultipollChoices((prev) => {
        let mutated = false;
        for (const sp of subPolls) {
          if (prev.has(sp.id)) {
            mutated = true;
            break;
          }
        }
        if (!mutated) return prev;
        const next = new Map(prev);
        for (const sp of subPolls) next.delete(sp.id);
        return next;
      });

      if (voter_name) saveUserName(voter_name);

      for (const v of returnedVotes) {
        window.dispatchEvent(
          new CustomEvent(POLL_VOTES_CHANGED_EVENT, { detail: { pollId: v.poll_id } }),
        );
      }

      setPendingMultipollSubmit(null);
    } catch (err: unknown) {
      console.error("Multipoll vote submit failed:", err);
      const message = err instanceof Error ? err.message : "Submit failed.";
      for (const prepared of preparedNonYesNo) prepared.fail(message);
      setMultipollSubmitError((prev) => {
        const next = new Map(prev);
        next.set(multipollId, message);
        return next;
      });
    } finally {
      setMultipollSubmitting((prev) => {
        if (!prev.has(multipollId)) return prev;
        const next = new Set(prev);
        next.delete(multipollId);
        return next;
      });
    }
  };

  const confirmVoteChange = async () => {
    if (!pendingVoteChange) return;
    const { pollId, newChoice } = pendingVoteChange;
    const current = userVoteMap.get(pollId);
    const subPoll = thread?.polls.find((p) => p.id === pollId);
    const multipollId = subPoll?.multipoll_id ?? null;
    if (!multipollId) {
      // Phase 5: every poll has a multipoll wrapper, so this branch is dead.
      // Surface as a runtime error rather than silently dropping the vote.
      console.error("confirmVoteChange called for poll without multipoll_id");
      return;
    }
    setVoteChangeSubmitting(true);
    try {
      // Route every yes_no tap-to-change through the unified multipoll endpoint
      // as a single-item batch. Matches the architectural "vote submission is
      // always atomic across the multipoll" rule (see CLAUDE.md → Multipoll
      // System), even when the multipoll has only one sub-poll.
      const voter_name = current
        ? current.voterName
        : (getUserName()?.trim() || null);
      const voteData = {
        vote_type: "yes_no" as const,
        yes_no_choice: newChoice === "abstain" ? null : newChoice,
        is_abstain: newChoice === "abstain",
      };
      const item = buildMultipollVoteItem(voteData, pollId, current?.voteId ?? null, {
        pollType: "yes_no",
        canSubmitSuggestions: false,
        isEditing: !!current?.voteId,
      });
      const returned = await apiSubmitMultipollVotes(multipollId, {
        voter_name,
        items: [item],
      });
      const v = returned.find((r) => r.poll_id === pollId);
      if (!v) throw new Error("Vote response missing for sub-poll");
      const resultVoteId = v.id;
      const resultVoterName = v.voter_name ?? null;
      if (!current) setStoredVoteId(pollId, resultVoteId);
      if (voter_name) saveUserName(voter_name);
      invalidatePoll(pollId);
      setUserVoteMap((prev) => {
        const next = new Map(prev);
        next.set(pollId, {
          choice: newChoice,
          voteId: resultVoteId,
          voterName: resultVoterName,
        });
        return next;
      });
      setVotedPollFlag(pollId, newChoice === "abstain" ? "abstained" : true);
      const fresh = loadVotedPolls();
      setVotedPollIds(fresh.votedPollIds);
      setAbstainedPollIds(fresh.abstainedPollIds);
      window.dispatchEvent(
        new CustomEvent(POLL_VOTES_CHANGED_EVENT, { detail: { pollId } }),
      );
      setPendingVoteChange(null);
    } catch (err) {
      console.error("Vote submit/change failed:", err);
    } finally {
      setVoteChangeSubmitting(false);
    }
  };

  return {
    userVoteMap,
    setUserVoteMap,
    pendingVoteChange,
    setPendingVoteChange,
    voteChangeSubmitting,
    pendingMultipollChoices,
    setPendingMultipollChoices,
    multipollVoterNames,
    setMultipollVoterName,
    pendingMultipollSubmit,
    setPendingMultipollSubmit,
    multipollSubmitting,
    multipollSubmitError,
    wrapperSubmitState,
    handleWrapperSubmitStateChange,
    confirmMultipollSubmit,
    confirmVoteChange,
  };
}
