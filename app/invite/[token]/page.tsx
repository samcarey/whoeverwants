/**
 * Phase G: invite redemption landing page (`/invite/<token>`).
 *
 * The URL minted by `POST /api/groups/<id>/invites` resolves here.
 * Flow:
 *   1. Page mounts → reads `token` from URL params.
 *   2. If anonymous → show "Sign in to join this group" + SignInModal.
 *      Signing in fires SESSION_CHANGED_EVENT → effect re-fires →
 *      auto-redeem.
 *   3. If signed in → POST /api/auth/invites/<token>/redeem.
 *      - 200 → router.replace to `/g/<group_short_id>` (or
 *        `/g/<group_short_id>/p/<poll_short_id>` when the invite has
 *        a target_poll_id).
 *      - 404 → "This invite link is invalid or expired."
 *      - 401 (token expired mid-tap) → silently re-trigger sign-in.
 *
 * We deliberately don't surface group info BEFORE redemption (no
 * "preview the group title" call). Phase E's privacy rule says
 * private groups shouldn't leak metadata to non-members; the invite
 * URL is the leak channel that DOES leak (intentionally), but only
 * the title — and we'd rather just navigate the user into the group
 * after they redeem than surface a "preview, click again to redeem"
 * step.
 */

"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import {
  ApiError,
  apiRedeemInvite,
  type InviteRedeemResult,
} from "@/lib/api";
import SignInModal from "@/components/SignInModal";
import { GroupLoading } from "@/components/GroupLoadState";
import {
  getCachedSessionUser,
  SESSION_CHANGED_EVENT,
  type SessionUser,
} from "@/lib/session";

function buildDestinationUrl(result: InviteRedeemResult): string {
  const groupRoute = result.group_short_id || result.group_id;
  if (result.target_poll_short_id) {
    return `/g/${groupRoute}/p/${result.target_poll_short_id}`;
  }
  return `/g/${groupRoute}`;
}

function InviteRedeemView({ token }: { token: string }) {
  const router = useRouter();
  const [session, setSession] = useState<SessionUser | null>(null);
  const [phase, setPhase] = useState<
    "loading" | "anonymous" | "redeeming" | "error"
  >("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [signInOpen, setSignInOpen] = useState(false);

  // Track the latest session via the same pattern other surfaces use
  // — initial read on mount + SESSION_CHANGED_EVENT subscription so
  // signing in via the modal triggers redemption without a remount.
  useEffect(() => {
    setSession(getCachedSessionUser());
    const update = () => setSession(getCachedSessionUser());
    window.addEventListener(SESSION_CHANGED_EVENT, update);
    return () => window.removeEventListener(SESSION_CHANGED_EVENT, update);
  }, []);

  // Auto-redeem whenever we have a session. Re-fires on session
  // changes (so the post-sign-in flow lands here). Closes the
  // SignInModal too — once the user signs in, the modal's purpose is
  // done and the redemption flow takes over.
  useEffect(() => {
    if (!session) {
      setPhase("anonymous");
      return;
    }
    setPhase("redeeming");
    setSignInOpen(false);
    setErrorMessage(null);
    let cancelled = false;
    apiRedeemInvite(token)
      .then((result) => {
        if (cancelled) return;
        router.replace(buildDestinationUrl(result));
      })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 401) {
          // Session expired between the cache read and the POST. The
          // fetch wrapper has already cleared local session state, so
          // SESSION_CHANGED_EVENT fires and this effect re-runs into
          // the anonymous branch — which surfaces the sign-in CTA.
          setPhase("anonymous");
          return;
        }
        const msg =
          e instanceof ApiError && e.status === 404
            ? "This invite link is invalid or expired."
            : e instanceof ApiError
            ? e.message
            : "Could not redeem invite. Please try again.";
        setErrorMessage(msg);
        setPhase("error");
      });
    return () => {
      cancelled = true;
    };
  }, [session, token, router]);

  if (phase === "loading" || phase === "redeeming") {
    return <GroupLoading label="Joining group..." />;
  }

  if (phase === "error") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center max-w-sm px-6">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
            Couldn&apos;t redeem invite
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            {errorMessage ?? "This invite link is invalid or expired."}
          </p>
          <button
            onClick={() => router.replace("/")}
            className="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
          >
            Go Home
          </button>
        </div>
      </div>
    );
  }

  // Anonymous branch
  return (
    <>
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center max-w-sm px-6">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
            You&apos;ve been invited
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            Sign in to join the group.
          </p>
          <button
            onClick={() => setSignInOpen(true)}
            className="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
          >
            Sign in to continue
          </button>
        </div>
      </div>
      <SignInModal
        isOpen={signInOpen}
        onClose={() => setSignInOpen(false)}
      />
    </>
  );
}

function InviteRedeemInner() {
  const params = useParams();
  const token = params.token as string;
  return <InviteRedeemView token={token} />;
}

export default function InviteRedeemPage() {
  return (
    <Suspense fallback={<GroupLoading label="Joining group..." />}>
      <InviteRedeemInner />
    </Suspense>
  );
}
