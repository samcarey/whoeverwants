"use client";

/**
 * Voter-facing ballot for a limited-supply question.
 *
 * A limited-supply question hands out `supplyCount` slots first-come,
 * first-served. The voter either CLAIMS a spot or DECLINES ("No thanks").
 * Tapping submits immediately — speed matters when slots are scarce — so
 * there's no separate Submit button (the parent QuestionBallot wires the
 * tap straight through to submitVote, like yes/no single-question taps).
 *
 * The component is presentational: claim/decline handlers + all vote state
 * are owned by QuestionBallot and passed in.
 */
import { QuestionResults } from "@/lib/types";

interface LimitedSupplyBallotProps {
  supplyCount: number;
  results?: QuestionResults | null;
  hasVoted: boolean;
  /** The committed vote was a decline (is_abstain). Only meaningful when hasVoted. */
  committedDecline: boolean;
  /** created_at of the viewer's own committed vote, used to find their row in
   *  the claims roster so we can show "secured" vs "waitlist". */
  ownVoteCreatedAt?: string | null;
  isClosed: boolean;
  isSubmitting: boolean;
  error?: string | null;
  onClaim: () => void;
  onDecline: () => void;
}

export default function LimitedSupplyBallot({
  supplyCount,
  results,
  hasVoted,
  committedDecline,
  ownVoteCreatedAt,
  isClosed,
  isSubmitting,
  error,
  onClaim,
  onDecline,
}: LimitedSupplyBallotProps) {
  const claims = results?.claims ?? [];
  const securedCount = results?.secured_count ?? claims.filter((c) => c.secured).length;
  const waitlistCount = results?.waitlist_count ?? claims.filter((c) => !c.secured).length;
  const spotsLeft = Math.max(supplyCount - securedCount, 0);
  const isFull = spotsLeft === 0 && supplyCount > 0;

  // The viewer's own claim row (matched by exact created_at), if they claimed.
  const ownClaim =
    hasVoted && !committedDecline && ownVoteCreatedAt
      ? claims.find((c) => c.created_at === ownVoteCreatedAt)
      : undefined;

  const securedClaims = claims.filter((c) => c.secured);
  const waitlistClaims = claims.filter((c) => !c.secured);

  // The signup roster — who's in, who's waiting. Shown to everyone (it's a
  // public signup sheet). The viewer's own row is bolded.
  const roster = claims.length > 0 && (
    <ul className="mt-3 space-y-1 border-t border-gray-200 dark:border-gray-700 pt-2">
      {securedClaims.map((c) => (
        <li key={`s-${c.position}`} className="flex items-center gap-2">
          <span className="text-green-600 dark:text-green-400">✓</span>
          <span className={`truncate ${c === ownClaim ? "font-semibold text-gray-900 dark:text-gray-50" : "text-gray-700 dark:text-gray-200"}`}>
            {c.name || "Someone"}
          </span>
        </li>
      ))}
      {waitlistClaims.length > 0 && (
        <li className="pt-1 text-xs uppercase tracking-wide text-gray-400 dark:text-gray-500">Waitlist</li>
      )}
      {waitlistClaims.map((c, i) => (
        <li key={`w-${c.position}`} className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
          <span className="tabular-nums">{i + 1}.</span>
          <span className={`truncate ${c === ownClaim ? "font-semibold text-gray-800 dark:text-gray-100" : ""}`}>
            {c.name || "Someone"}
          </span>
        </li>
      ))}
    </ul>
  );

  const headline = isFull
    ? `All ${supplyCount} spot${supplyCount === 1 ? "" : "s"} claimed${waitlistCount > 0 ? ` · ${waitlistCount} on the waitlist` : ""}`
    : `${spotsLeft} of ${supplyCount} spot${supplyCount === 1 ? "" : "s"} left`;

  // --- Closed: read-only outcome ---
  if (isClosed) {
    return (
      <div className="text-sm">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-base">🎟️</span>
          <span className="font-semibold text-gray-800 dark:text-gray-100">
            {securedCount} of {supplyCount} claimed
          </span>
        </div>
        {hasVoted && (
          <p className={committedDecline ? "text-gray-500 dark:text-gray-400" : ownClaim?.secured ? "text-green-700 dark:text-green-300 font-medium" : "text-amber-600 dark:text-amber-400 font-medium"}>
            {committedDecline
              ? "You declined a spot."
              : ownClaim
                ? ownClaim.secured
                  ? "✓ You got a spot!"
                  : "You were on the waitlist."
                : "You claimed a spot."}
          </p>
        )}
        {roster}
      </div>
    );
  }

  // --- Open: live status + the voter's outcome / actions ---
  return (
    <div className="text-sm">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-base">🎟️</span>
        <span className="font-semibold text-gray-800 dark:text-gray-100">{headline}</span>
      </div>

      {hasVoted && !committedDecline ? (
        // The voter currently holds a claim.
        <div className="space-y-2">
          {ownClaim ? (
            ownClaim.secured ? (
              <p className="text-green-700 dark:text-green-300 font-medium">
                ✓ You&apos;re in! (spot #{ownClaim.position})
              </p>
            ) : (
              <p className="text-amber-600 dark:text-amber-400 font-medium">
                ⏳ Waitlist #{ownClaim.position - supplyCount} — you&apos;ll get a spot if someone drops out
              </p>
            )
          ) : (
            <p className="text-green-700 dark:text-green-300 font-medium">✓ You claimed a spot</p>
          )}
          <button
            type="button"
            onClick={onDecline}
            disabled={isSubmitting}
            className="text-xs text-amber-600 dark:text-amber-400 font-medium hover:underline active:opacity-70 disabled:opacity-50"
          >
            Give up my spot
          </button>
        </div>
      ) : hasVoted && committedDecline ? (
        // The voter declined; let them change their mind.
        <div className="space-y-2">
          <p className="text-gray-500 dark:text-gray-400">You declined.</p>
          <button
            type="button"
            onClick={onClaim}
            disabled={isSubmitting}
            className="w-full px-4 py-3 rounded-xl bg-green-600 hover:bg-green-700 active:scale-95 text-white font-semibold transition disabled:opacity-50"
          >
            {isFull ? "Join the waitlist" : "Claim a spot"}
          </button>
        </div>
      ) : (
        // Fresh voter: claim or decline.
        <div className="space-y-2">
          <button
            type="button"
            onClick={onClaim}
            disabled={isSubmitting}
            className="w-full px-4 py-3 rounded-xl bg-green-600 hover:bg-green-700 active:scale-95 text-white font-semibold transition disabled:opacity-50"
          >
            {isFull ? "Join the waitlist" : "Claim a spot"}
          </button>
          <div className="text-center">
            <button
              type="button"
              onClick={onDecline}
              disabled={isSubmitting}
              className="text-xs text-amber-600 dark:text-amber-400 font-medium hover:underline active:opacity-70 disabled:opacity-50"
            >
              No thanks
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {roster}
    </div>
  );
}
