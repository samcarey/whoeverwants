"use client";

/**
 * The shareable friend-profile link (/f/<code>): shows the link owner's
 * card and an "Add Friend" button. Tapping it sends the owner a friend
 * request (which they still approve from /contacts). An opener with no
 * account/name first goes through the standard AccountGateModal sign-in /
 * create-account flow, then the tap replays.
 *
 * If the owner already sent the OPENER a request, sending back
 * auto-accepts server-side — the button just reads "Add Friend Back".
 */

import React, { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  apiGetFriendProfile,
  apiSendFriendRequest,
  apiUnblockUser,
  type FriendProfile,
} from "@/lib/api/friends";
import { buildUserImageUrl } from "@/lib/api/users";
import { ApiError } from "@/lib/api/_internal";
import { SESSION_CHANGED_EVENT } from "@/lib/session";
import { getUserName } from "@/lib/userProfile";
import { isValidUserName } from "@/lib/nameValidation";
import { relativeTime } from "@/lib/questionListUtils";
import { usePageReady } from "@/lib/usePageReady";
import { navigateWithTransition } from "@/lib/viewTransitions";
import InitialBubble from "@/components/InitialBubble";
import AccountGateModal from "@/components/AccountGateModal";

export default function FriendProfilePage() {
  const params = useParams<{ code: string }>();
  const code = typeof params?.code === "string" ? params.code : "";
  const router = useRouter();
  const [profile, setProfile] = useState<FriendProfile | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [sentStatus, setSentStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gateOpen, setGateOpen] = useState(false);

  usePageReady(true);

  const load = useCallback(async () => {
    if (!code) return;
    try {
      const p = await apiGetFriendProfile(code);
      setProfile(p);
      setNotFound(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setNotFound(true);
      else setError("Couldn't load this profile. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => {
    void load();
    // The viewer's relationship changes on sign-in (modal completes in place).
    const refetch = () => void load();
    window.addEventListener(SESSION_CHANGED_EVENT, refetch);
    return () => window.removeEventListener(SESSION_CHANGED_EVENT, refetch);
  }, [load]);

  const sendRequest = async () => {
    // Needs a named account — route through the standard sign-in /
    // create-account gate first, then replay.
    if (!isValidUserName(getUserName())) {
      setGateOpen(true);
      return;
    }
    setSending(true);
    setError(null);
    try {
      const { status } = await apiSendFriendRequest({ code });
      setSentStatus(status);
      void load();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setGateOpen(true);
      else setError(err instanceof ApiError && err.message ? err.message : "Couldn't send the request");
    } finally {
      setSending(false);
    }
  };

  const name = profile?.name?.trim() || "Someone";
  const relationship = sentStatus === "friends" ? "friends" : profile?.relationship;

  const actionArea = (() => {
    if (!profile) return null;
    if (relationship === "self") {
      return (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          This is your own friend link — send it to someone else!
        </p>
      );
    }
    if (relationship === "friends") {
      return (
        <span className="inline-flex items-center gap-2 px-5 py-2.5 bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 font-medium rounded-full">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
          Friends
        </span>
      );
    }
    if (relationship === "outgoing" || sentStatus === "requested") {
      return (
        <span className="inline-flex items-center px-5 py-2.5 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 font-medium rounded-full">
          Request sent — waiting for {name} to accept
        </span>
      );
    }
    if (relationship === "blocked") {
      return (
        <button
          type="button"
          onClick={() => {
            void apiUnblockUser(profile.user_id).then(() => load()).catch(() => {});
          }}
          className="inline-flex items-center px-5 py-2.5 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 font-medium rounded-full"
        >
          You blocked {name} — tap to unblock
        </button>
      );
    }
    return (
      <button
        type="button"
        onClick={() => void sendRequest()}
        disabled={sending}
        className="inline-flex items-center px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-full transition-colors"
      >
        {relationship === "incoming" ? "Add Friend Back" : "Add Friend"}
      </button>
    );
  })();

  return (
    <div
      className="max-w-md mx-auto px-4 text-center"
      style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 4rem)" }}
    >
      {loading && (
        <div className="flex justify-center items-center py-12">
          <svg className="animate-spin h-8 w-8 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
        </div>
      )}

      {!loading && notFound && (
        <div className="py-12">
          <h1 className="text-2xl font-bold mb-2">Link not found</h1>
          <p className="text-gray-500 dark:text-gray-400">
            This friend link isn&apos;t valid anymore.
          </p>
        </div>
      )}

      {!loading && profile && (
        <>
          <div className="flex justify-center mb-4">
            <InitialBubble
              name={profile.name?.trim() || null}
              imageUrl={
                profile.image_updated_at
                  ? buildUserImageUrl(profile.user_id, profile.image_updated_at)
                  : null
              }
              sizeClassName="w-28 h-28"
              textSizeClassName="text-4xl"
            />
          </div>
          <h1 className="text-2xl font-bold mb-1">{name}</h1>
          {profile.created_at && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
              Joined {relativeTime(profile.created_at)}
            </p>
          )}
          {relationship === "none" && !sentStatus && (
            <p className="text-gray-600 dark:text-gray-300 mb-6">
              {name} shared this link so you can add them as a friend. They&apos;ll
              approve your request on their side.
            </p>
          )}
          <div className="mb-8">{actionArea}</div>
          {error && (
            <p className="text-sm text-red-600 dark:text-red-400 mb-4">{error}</p>
          )}
        </>
      )}

      {!loading && (
        <button
          type="button"
          onClick={() => navigateWithTransition(router, "/", "forward")}
          className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
        >
          Go to {`Whoever Wants`}
        </button>
      )}

      <AccountGateModal
        isOpen={gateOpen}
        message="to add friends"
        onSubmit={() => {
          setGateOpen(false);
          void sendRequest();
        }}
        onCancel={() => setGateOpen(false)}
      />
    </div>
  );
}
