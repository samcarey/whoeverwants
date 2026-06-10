"use client";

/**
 * Mounts the user-profile modal once at the root layout level and opens it in
 * response to `openUserProfileCard(...)` (USER_PROFILE_OPEN_EVENT). Living in
 * the layout (not a per-route component) keeps the modal alive across the
 * surfaces that trigger it. Ignores opens that target the viewer's own
 * account (belt-and-suspenders — call sites already pass null for self).
 */

import { useEffect, useState } from "react";
import UserProfileModal from "@/components/UserProfileModal";
import {
  USER_PROFILE_OPEN_EVENT,
  type OpenUserProfileDetail,
} from "@/lib/useUserProfile";
import { getCachedSessionUser } from "@/lib/session";

export default function UserProfileModalHost() {
  const [target, setTarget] = useState<OpenUserProfileDetail | null>(null);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<OpenUserProfileDetail>).detail;
      if (!detail?.userId) return;
      // Never open the modal on yourself.
      if (getCachedSessionUser()?.user_id === detail.userId) return;
      setTarget(detail);
    };
    window.addEventListener(USER_PROFILE_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(USER_PROFILE_OPEN_EVENT, onOpen);
  }, []);

  if (!target) return null;
  return (
    <UserProfileModal
      key={target.userId}
      userId={target.userId}
      fallbackName={target.name}
      onClose={() => setTarget(null)}
    />
  );
}
