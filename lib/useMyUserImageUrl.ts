"use client";

import { useEffect, useState } from "react";
import { getMyUserImageUrl, USER_PROFILE_CHANGED_EVENT } from "@/lib/api";

/**
 * The current browser's profile image URL (or null when not set).
 *
 * Reads `getMyUserImageUrl()` synchronously on mount so the first
 * paint already has the correct value (no flash from initials →
 * image after hydration). Subscribes to `USER_PROFILE_CHANGED_EVENT`
 * so display surfaces refresh in lockstep when the user
 * uploads/clears their image from the settings page.
 *
 * Note: the URL itself carries an `?v=<image_updated_at>` cache-
 * buster, so a re-upload changes the URL and forces the browser to
 * fetch the new bytes (the previous URL is immutable-cached).
 */
export function useMyUserImageUrl(): string | null {
  const [url, setUrl] = useState<string | null>(() =>
    typeof window === "undefined" ? null : getMyUserImageUrl(),
  );
  useEffect(() => {
    const update = () => setUrl(getMyUserImageUrl());
    window.addEventListener(USER_PROFILE_CHANGED_EVENT, update);
    return () => window.removeEventListener(USER_PROFILE_CHANGED_EVENT, update);
  }, []);
  return url;
}
