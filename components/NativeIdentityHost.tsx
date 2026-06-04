"use client";

import { useEffect } from "react";

import { installNativeIdentitySync } from "@/lib/nativeIdentity";

/**
 * Phase 2 of docs/siri-integration-plan.md — keeps the iOS Keychain identity
 * bridge in sync with the WebView's session for the app's lifetime. Inert on
 * web / PWA (the install helper short-circuits on `!isNativePlatform()`).
 *
 * Mounted from `app/layout.tsx` (not template) so the subscription installs
 * once per page load and survives client-side navigation — same rationale as
 * PushAutoRegister / UniversalLinksHandler.
 */
export function NativeIdentityHost() {
  useEffect(() => {
    installNativeIdentitySync();
  }, []);
  return null;
}
