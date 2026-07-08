"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import ConfirmationModal from "@/components/ConfirmationModal";
import InitialBubble from "@/components/InitialBubble";
import { renderWithLinks } from "@/components/QuestionDetails";
import {
  ApiError,
  apiCreatePollComment,
  apiDeletePollComment,
  apiGetGroupMembers,
  apiGetPollComments,
  apiTogglePollCommentReaction,
  apiUpdatePollComment,
  type PollComment,
  type PollCommentReaction,
} from "@/lib/api";
import { haptic } from "@/lib/haptics";
import { relativeTime } from "@/lib/questionListUtils";
import { useMyUserImageUrl } from "@/lib/useMyUserImageUrl";
import { useProfileLongPress } from "@/lib/useUserProfile";
import { getUserName } from "@/lib/userProfile";

// Mirror of server/services/comments.py: COMMENT_MAX_CHARS (silent server cap;
// the maxLength here keeps the two in lockstep so users never hit it blind).
const COMMENT_MAX_CHARS = 2000;

// Same cadence as the group page's poll refresh — comments feel live without
// a push channel. Paused while the tab is hidden.
const REFRESH_INTERVAL_MS = 5000;

// Reaction palette (messaging convention). Any emoji a reaction chip already
// shows is also tappable, so the palette is a starting set, not a limit.
const REACTION_PRESETS = ["👍", "❤️", "😂", "😮", "😢", "🎉"];

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Highlight "@Name" occurrences (for this comment's stored mentions) inside
 *  a plain-text segment. */
function highlightMentions(
  text: string,
  names: string[],
  keyBase: string,
): React.ReactNode {
  if (names.length === 0) return text;
  const pattern = new RegExp(
    `@(?:${[...names]
      .sort((a, b) => b.length - a.length)
      .map(escapeRegExp)
      .join("|")})`,
    "gi",
  );
  const parts = text.split(pattern);
  const matches = text.match(pattern);
  if (!matches) return text;
  const out: React.ReactNode[] = [];
  parts.forEach((part, i) => {
    out.push(part);
    if (i < matches.length) {
      out.push(
        <span
          key={`${keyBase}-m${i}`}
          className="text-blue-600 dark:text-blue-400 font-medium"
        >
          {matches[i]}
        </span>,
      );
    }
  });
  return out;
}

/** Comment body = autolinked URLs (shared QuestionDetails linkifier) +
 *  highlighted @mentions in the plain-text segments between them. */
function renderCommentBody(comment: PollComment): React.ReactNode {
  const linked = renderWithLinks(comment.body);
  const names = comment.mentions.map((m) => m.name).filter(Boolean);
  if (names.length === 0) return linked;
  return linked.map((part, i) =>
    typeof part === "string" ? (
      <span key={`t${i}`}>{highlightMentions(part, names, `t${i}`)}</span>
    ) : (
      part
    ),
  );
}

/** One comment row. Split out so the profile long-press hook can run
 *  per-comment (hooks can't be called inside the parent's .map loop). */
function CommentRow({
  comment,
  myImageUrl,
  editing,
  onStartEdit,
  onDelete,
  onToggleReaction,
}: {
  comment: PollComment;
  myImageUrl: string | null;
  /** Non-null when THIS row is in edit mode: the save/cancel UI + draft. */
  editing: {
    draft: string;
    saving: boolean;
    setDraft: (v: string) => void;
    save: () => void;
    cancel: () => void;
  } | null;
  onStartEdit: (comment: PollComment) => void;
  onDelete: (comment: PollComment) => void;
  onToggleReaction: (comment: PollComment, emoji: string) => void;
}) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  // `is_mine` is server-computed + account-aware — the single source of
  // ownership truth here (no isCurrentUserName name-match fallback: a
  // same-named OTHER person would get edit/delete controls that only 404).
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
            {comment.edited_at && (
              <span title={comment.edited_at}> &middot; edited</span>
            )}
          </span>
          {comment.is_mine && !editing && (
            <span className="shrink-0 ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => onStartEdit(comment)}
                className="text-[11px] text-gray-400 hover:text-blue-600 dark:text-gray-500 dark:hover:text-blue-400"
              >
                Edit
              </button>
              <button
                type="button"
                aria-label="Delete comment"
                onClick={() => onDelete(comment)}
                className="px-1 text-xs text-gray-400 hover:text-red-600 dark:text-gray-500 dark:hover:text-red-400"
              >
                ✕
              </button>
            </span>
          )}
        </div>

        {editing ? (
          <div className="mt-1">
            <textarea
              value={editing.draft}
              onChange={(e) => editing.setDraft(e.target.value)}
              maxLength={COMMENT_MAX_CHARS}
              rows={2}
              className="block w-full px-3 py-2 text-base rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 resize-none"
            />
            <div className="mt-1 flex items-center gap-2 justify-end">
              <button
                type="button"
                onClick={editing.cancel}
                className="px-3 py-1 text-xs text-gray-500 dark:text-gray-400 hover:underline"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={editing.save}
                disabled={editing.saving || !editing.draft.trim()}
                className="px-3 py-1 text-xs font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
              >
                {editing.saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-900 dark:text-gray-100 whitespace-pre-wrap break-words">
            {renderCommentBody(comment)}
          </p>
        )}

        {/* Reaction chips + add-reaction palette. Reacting is identity-light
            (no name gate — it's not authored content). */}
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {comment.reactions.map((r) => (
            <button
              key={r.emoji}
              type="button"
              onClick={() => onToggleReaction(comment, r.emoji)}
              aria-pressed={r.mine}
              className={`px-2 py-0.5 rounded-full border text-xs leading-5 ${
                r.mine
                  ? "border-blue-400 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-900/40 dark:text-blue-300"
                  : "border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
              }`}
            >
              {r.emoji} {r.count}
            </button>
          ))}
          <button
            type="button"
            aria-label="Add reaction"
            onClick={() => setPaletteOpen((v) => !v)}
            className="px-1.5 py-0.5 rounded-full text-xs leading-5 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
          >
            {paletteOpen ? "−" : "☺+"}
          </button>
          {paletteOpen &&
            REACTION_PRESETS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => {
                  setPaletteOpen(false);
                  onToggleReaction(comment, emoji);
                }}
                className="px-1.5 py-0.5 rounded-full text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                {emoji}
              </button>
            ))}
        </div>
      </div>
    </li>
  );
}

/**
 * Poll-level comment thread (migrations 146/147), mounted at the bottom of
 * the poll detail page. Flat list, oldest first (chat order), with a composer
 * below. Posting is name-gated via the page's shared `gateOnName`
 * (AccountGateModal) — same policy as voting. Auto-refreshes every 5s while
 * visible (the group page's cadence) so threads feel live.
 */
export default function PollComments({
  pollId,
  groupId,
  gateOnName,
}: {
  pollId: string;
  /** Group route id — resolves the member roster for @-mention autocomplete. */
  groupId?: string;
  /** The detail page's name gate: returns false (and opens the account
   *  modal) when no display name is saved; the retry replays the post. */
  gateOnName?: (retry: () => void) => boolean;
}) {
  const [comments, setComments] = useState<PollComment[] | null>(null);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PollComment | null>(null);
  const [editing, setEditing] = useState<{
    id: string;
    draft: string;
    saving: boolean;
  } | null>(null);
  // @mention autocomplete state: the roster candidates, the "@quer" token
  // currently before the caret (null = closed), and the names picked so far
  // (user_id → name; filtered to names still present in the body at submit).
  const [mentionCandidates, setMentionCandidates] = useState<
    { user_id: string; name: string }[]
  >([]);
  const [mentionQuery, setMentionQuery] = useState<{
    query: string;
    start: number;
  } | null>(null);
  const pendingMentionsRef = useRef<Map<string, string>>(new Map());
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const myImageUrl = useMyUserImageUrl();

  // Busy-state ref so the refresh loop can skip ticks that could race an
  // in-flight optimistic mutation without re-arming the timer.
  const busyRef = useRef(false);
  busyRef.current = submitting || !!pendingDelete || !!editing?.saving;

  useEffect(() => {
    let cancelled = false;

    const signature = (list: PollComment[]) =>
      JSON.stringify(
        list.map((c) => [c.id, c.body, c.edited_at, c.reactions]),
      );

    const load = async () => {
      try {
        const list = await apiGetPollComments(pollId);
        if (cancelled) return;
        setComments((prev) =>
          prev && signature(prev) === signature(list) ? prev : list,
        );
      } catch {
        // Comments are supplementary — a failed load renders the empty state
        // rather than an error card; the next tick retries.
        if (!cancelled) setComments((prev) => prev ?? []);
      }
    };

    void load();

    // Recursive timeout (not setInterval) so a slow network can't pile up
    // overlapping fetches — the group page's refresh pattern.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (cancelled) return;
      if (document.visibilityState === "visible" && !busyRef.current) {
        await load();
      }
      if (!cancelled) timer = setTimeout(() => void tick(), REFRESH_INTERVAL_MS);
    };
    timer = setTimeout(() => void tick(), REFRESH_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pollId]);

  // Roster for @-mention autocomplete (cached + coalesced in the API layer).
  // Only accounts are mentionable — a push needs a user_id to target.
  useEffect(() => {
    if (!groupId) return;
    let cancelled = false;
    apiGetGroupMembers(groupId)
      .then((roster) => {
        if (cancelled) return;
        setMentionCandidates(
          roster.members
            .filter((m) => m.user_id && m.name)
            .map((m) => ({ user_id: m.user_id as string, name: m.name })),
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  const updateMentionQuery = () => {
    const el = textareaRef.current;
    if (!el || mentionCandidates.length === 0) {
      setMentionQuery(null);
      return;
    }
    const caret = el.selectionStart ?? el.value.length;
    const upToCaret = el.value.slice(0, caret);
    const match = /(^|\s)@([^\s@]{0,30})$/.exec(upToCaret);
    if (!match) {
      setMentionQuery(null);
      return;
    }
    setMentionQuery({
      query: match[2],
      start: caret - match[2].length - 1, // index of the "@"
    });
  };

  const mentionMatches = useMemo(() => {
    if (!mentionQuery) return [];
    const q = mentionQuery.query.toLowerCase();
    return mentionCandidates
      .filter((c) => c.name.toLowerCase().startsWith(q))
      .slice(0, 6);
  }, [mentionQuery, mentionCandidates]);

  const pickMention = (candidate: { user_id: string; name: string }) => {
    const el = textareaRef.current;
    if (!el || !mentionQuery) return;
    const caret = el.selectionStart ?? el.value.length;
    const next =
      draft.slice(0, mentionQuery.start) +
      `@${candidate.name} ` +
      draft.slice(caret);
    pendingMentionsRef.current.set(candidate.user_id, candidate.name);
    setDraft(next);
    setMentionQuery(null);
    requestAnimationFrame(() => el.focus());
  };

  const submit = async () => {
    const body = draft.trim();
    if (!body || submitting) return;
    setSubmitting(true);
    setError(null);
    haptic.light();
    // Only mentions whose "@Name" text survived editing are sent.
    const mentionedUserIds = [...pendingMentionsRef.current.entries()]
      .filter(([, name]) => body.toLowerCase().includes(`@${name.toLowerCase()}`))
      .map(([userId]) => userId);
    try {
      const created = await apiCreatePollComment(
        pollId,
        getUserName()?.trim() ?? "",
        body,
        mentionedUserIds,
      );
      setComments((prev) => [...(prev ?? []), created]);
      setDraft("");
      pendingMentionsRef.current.clear();
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

  const saveEdit = async () => {
    if (!editing) return;
    const body = editing.draft.trim();
    if (!body) return;
    setEditing({ ...editing, saving: true });
    try {
      const updated = await apiUpdatePollComment(pollId, editing.id, body);
      setComments((prev) =>
        (prev ?? []).map((c) => (c.id === updated.id ? updated : c)),
      );
      setEditing(null);
    } catch {
      setError("Failed to save edit");
      setEditing((prev) => (prev ? { ...prev, saving: false } : prev));
    }
  };

  const toggleReaction = async (comment: PollComment, emoji: string) => {
    haptic.light();
    try {
      const reactions = await apiTogglePollCommentReaction(
        pollId,
        comment.id,
        emoji,
      );
      setComments((prev) =>
        (prev ?? []).map((c) =>
          c.id === comment.id ? { ...c, reactions } : c,
        ),
      );
    } catch {
      // Reactions are low-stakes; a failed toggle just leaves the chip as-is.
    }
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
              editing={
                editing?.id === c.id
                  ? {
                      draft: editing.draft,
                      saving: editing.saving,
                      setDraft: (v) =>
                        setEditing((prev) =>
                          prev ? { ...prev, draft: v } : prev,
                        ),
                      save: () => void saveEdit(),
                      cancel: () => setEditing(null),
                    }
                  : null
              }
              onStartEdit={(target) =>
                setEditing({ id: target.id, draft: target.body, saving: false })
              }
              onDelete={setPendingDelete}
              onToggleReaction={(target, emoji) =>
                void toggleReaction(target, emoji)
              }
            />
          ))}
        </ul>
      )}

      <div className="relative mt-3">
        {mentionQuery && mentionMatches.length > 0 && (
          <ul className="absolute bottom-full left-0 right-14 mb-1 z-30 max-h-44 overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg">
            {mentionMatches.map((m) => (
              <li key={m.user_id}>
                <button
                  type="button"
                  // onMouseDown + preventDefault so the textarea keeps focus
                  // through the pick (the AutocompleteInput convention).
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pickMention(m);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  <InitialBubble name={m.name} sizeClassName="w-5 h-5" textSizeClassName="text-[9px]" />
                  {m.name}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              requestAnimationFrame(updateMentionQuery);
            }}
            onSelect={updateMentionQuery}
            onBlur={() => {
              setDraft((v) => v.trim());
              setMentionQuery(null);
            }}
            maxLength={COMMENT_MAX_CHARS}
            placeholder={
              mentionCandidates.length > 0
                ? "Add a comment… (@ to mention)"
                : "Add a comment…"
            }
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
