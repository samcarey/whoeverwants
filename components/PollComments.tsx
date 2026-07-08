"use client";

import { useEffect, useState } from "react";

import ConfirmationModal from "@/components/ConfirmationModal";
import InitialBubble from "@/components/InitialBubble";
import {
  ApiError,
  apiCreatePollComment,
  apiDeletePollComment,
  apiGetPollComments,
  type PollComment,
} from "@/lib/api";
import { haptic } from "@/lib/haptics";
import { relativeTime } from "@/lib/questionListUtils";
import { useMyUserImageUrl } from "@/lib/useMyUserImageUrl";
import { useProfileLongPress } from "@/lib/useUserProfile";
import { getUserName } from "@/lib/userProfile";

// Mirror of server/services/comments.py: COMMENT_MAX_CHARS (silent server cap;
// the maxLength here keeps the two in lockstep so users never hit it blind).
const COMMENT_MAX_CHARS = 2000;

/** One comment row. Split out so the profile long-press hook can run
 *  per-comment (hooks can't be called inside the parent's .map loop). */
function CommentRow({
  comment,
  myImageUrl,
  onDelete,
}: {
  comment: PollComment;
  myImageUrl: string | null;
  onDelete: (comment: PollComment) => void;
}) {
  // `is_mine` is server-computed + account-aware — the single source of
  // ownership truth here (no isCurrentUserName name-match fallback: a
  // same-named OTHER person would get a delete ✕ that can only 404).
  const profilePress = useProfileLongPress(
    comment.is_mine ? null : comment.user_id,
    comment.commenter_name,
  );
  return (
    <li className="flex items-start gap-2 px-1">
      <div className="shrink-0 mt-0.5" {...profilePress}>
        <InitialBubble
          name={comment.commenter_name}
          imageUrl={comment.is_mine ? myImageUrl : null}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span
            className="min-w-0 truncate text-xs font-medium text-gray-700 dark:text-gray-300"
            {...profilePress}
          >
            {comment.is_mine
              ? `You (${comment.commenter_name})`
              : comment.commenter_name}
          </span>
          <span
            className="shrink-0 text-[11px] text-gray-400 dark:text-gray-500"
            title={comment.created_at}
          >
            {relativeTime(comment.created_at)}
          </span>
          {comment.is_mine && (
            <button
              type="button"
              aria-label="Delete comment"
              onClick={() => onDelete(comment)}
              className="shrink-0 ml-auto px-1 text-xs text-gray-400 hover:text-red-600 dark:text-gray-500 dark:hover:text-red-400"
            >
              ✕
            </button>
          )}
        </div>
        <p className="text-sm text-gray-900 dark:text-gray-100 whitespace-pre-wrap break-words">
          {comment.body}
        </p>
      </div>
    </li>
  );
}

/**
 * Poll-level comment thread (migration 146), mounted at the bottom of the
 * poll detail page. Flat list, oldest first (chat order), with a composer
 * below. Posting is name-gated via the page's shared `gateOnName`
 * (AccountGateModal) — same policy as voting.
 */
export default function PollComments({
  pollId,
  gateOnName,
}: {
  pollId: string;
  /** The detail page's name gate: returns false (and opens the account
   *  modal) when no display name is saved; the retry replays the post. */
  gateOnName?: (retry: () => void) => boolean;
}) {
  const [comments, setComments] = useState<PollComment[] | null>(null);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PollComment | null>(null);
  const myImageUrl = useMyUserImageUrl();

  useEffect(() => {
    let cancelled = false;
    apiGetPollComments(pollId)
      .then((list) => {
        if (!cancelled) setComments(list);
      })
      .catch(() => {
        // Comments are supplementary — a failed load renders the empty state
        // rather than an error card.
        if (!cancelled) setComments([]);
      });
    return () => {
      cancelled = true;
    };
  }, [pollId]);

  const submit = async () => {
    const body = draft.trim();
    if (!body || submitting) return;
    setSubmitting(true);
    setError(null);
    haptic.light();
    try {
      const created = await apiCreatePollComment(
        pollId,
        getUserName()?.trim() ?? "",
        body,
      );
      setComments((prev) => [...(prev ?? []), created]);
      setDraft("");
    } catch (e) {
      setError(
        e instanceof ApiError && e.message
          ? e.message
          : "Failed to post comment",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handlePost = () => {
    // Empty/submitting guards live in `submit` (the gate's retry target).
    const fire = () => void submit();
    if (gateOnName && !gateOnName(fire)) return;
    fire();
  };

  const confirmDelete = async () => {
    const target = pendingDelete;
    setPendingDelete(null);
    if (!target) return;
    haptic.medium();
    // Optimistic remove; treat 404 as success (goal state reached) and
    // restore on any other failure — the optimistic-remove convention.
    setComments((prev) => (prev ?? []).filter((c) => c.id !== target.id));
    try {
      await apiDeletePollComment(pollId, target.id);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return;
      setComments((prev) => [...(prev ?? []), target]);
      setError("Failed to delete comment");
    }
  };

  return (
    <div className="mt-8">
      <h2 className="px-1 mb-2 text-sm font-semibold text-gray-500 dark:text-gray-400">
        Comments
        {comments && comments.length > 0 ? ` (${comments.length})` : ""}
      </h2>

      {comments === null ? (
        <p className="px-1 text-xs text-gray-400 dark:text-gray-500">
          Loading comments…
        </p>
      ) : comments.length === 0 ? (
        <p className="px-1 text-xs text-gray-400 dark:text-gray-500">
          No comments yet.
        </p>
      ) : (
        <ul className="space-y-3">
          {comments.map((c) => (
            <CommentRow
              key={c.id}
              comment={c}
              myImageUrl={myImageUrl}
              onDelete={setPendingDelete}
            />
          ))}
        </ul>
      )}

      <div className="mt-3 flex items-end gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => setDraft((v) => v.trim())}
          maxLength={COMMENT_MAX_CHARS}
          placeholder="Add a comment…"
          rows={1}
          className="block flex-1 min-w-0 px-3 py-2 text-base rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 resize-none"
          style={{ minHeight: "42px" }}
        />
        <button
          type="button"
          onClick={handlePost}
          disabled={submitting || !draft.trim()}
          className="shrink-0 py-2 px-4 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-sm font-medium rounded-xl transition-all duration-150 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
        >
          {submitting ? "Posting…" : "Post"}
        </button>
      </div>
      {error && (
        <p className="mt-1 px-1 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <ConfirmationModal
        isOpen={!!pendingDelete}
        title="Delete comment?"
        message="Delete this comment?"
        confirmText="Delete"
        cancelText="Cancel"
        confirmButtonClass="bg-red-600 hover:bg-red-700 text-white"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
