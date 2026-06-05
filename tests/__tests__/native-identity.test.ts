/**
 * Phase 2 of docs/siri-integration-plan.md — JS half of the native identity
 * bridge (`lib/nativeIdentity.ts`). The Keychain round-trip itself is
 * device-only (verified on TestFlight); these tests pin the gating + the
 * payload assembled from session / browser-id / display-name storage.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Shared, hoisted so the vi.mock factory can reach them.
const h = vi.hoisted(() => ({
  native: { value: true },
  setIdentity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => h.native.value },
  registerPlugin: () => ({
    setIdentity: h.setIdentity,
    clearIdentity: vi.fn().mockResolvedValue(undefined),
    getIdentity: vi.fn().mockResolvedValue({}),
  }),
}));

import { syncNativeIdentity, _resetNativeIdentityForTests } from "@/lib/nativeIdentity";
import { _resetSessionForTests } from "@/lib/session";
import { _resetBrowserIdForTests } from "@/lib/browserIdentity";

const REAL_UUID = "11111111-2222-4333-8444-555555555555";
const TOKEN = "tok_abcdefabcdef12"; // >= 16 chars so readToken accepts it

describe("syncNativeIdentity", () => {
  beforeEach(() => {
    h.setIdentity.mockClear();
    h.native.value = true;
    localStorage.clear();
    _resetSessionForTests();
    _resetBrowserIdForTests();
    _resetNativeIdentityForTests();
  });

  it("pushes the live token / browserId / trimmed name on native", async () => {
    localStorage.setItem("session_token", TOKEN);
    localStorage.setItem("browser_id", REAL_UUID);
    localStorage.setItem("whoeverwants_user_name", "  Sam  ");
    await syncNativeIdentity();
    expect(h.setIdentity).toHaveBeenCalledWith({
      token: TOKEN,
      browserId: REAL_UUID,
      name: "Sam",
    });
  });

  it("is inert on web / PWA (no native plugin call)", async () => {
    h.native.value = false;
    localStorage.setItem("session_token", TOKEN);
    await syncNativeIdentity();
    expect(h.setIdentity).not.toHaveBeenCalled();
  });

  it("clears the secret on sign-out: null token + null name, keeps browserId", async () => {
    // Signed out: no session token, no saved name, but a persistent browser id.
    localStorage.setItem("browser_id", REAL_UUID);
    await syncNativeIdentity();
    expect(h.setIdentity).toHaveBeenCalledWith({
      token: null,
      browserId: REAL_UUID,
      name: null,
    });
  });

  it("skips the Keychain write when the triple is unchanged", async () => {
    localStorage.setItem("session_token", TOKEN);
    localStorage.setItem("browser_id", REAL_UUID);
    await syncNativeIdentity();
    expect(h.setIdentity).toHaveBeenCalledTimes(1);
    await syncNativeIdentity(); // identical values → no second write
    expect(h.setIdentity).toHaveBeenCalledTimes(1);
  });

  it("tolerates an absent browser id (null) before the first server response", async () => {
    localStorage.setItem("session_token", TOKEN);
    localStorage.setItem("whoeverwants_user_name", "Alex");
    await syncNativeIdentity();
    expect(h.setIdentity).toHaveBeenCalledWith({
      token: TOKEN,
      browserId: null,
      name: "Alex",
    });
  });

  it("logs the first setIdentity outcome once (resolve), without leaking secrets", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    localStorage.setItem("session_token", TOKEN);
    localStorage.setItem("browser_id", REAL_UUID);
    localStorage.setItem("whoeverwants_user_name", "Sam");
    await syncNativeIdentity();
    expect(warn).toHaveBeenCalledTimes(1);
    const msg = warn.mock.calls[0][0] as string;
    expect(msg).toContain("[native-identity] setIdentity resolved");
    expect(msg).not.toContain(TOKEN); // presence flags only, never the value
    // A later changed sync does NOT re-log (one-shot per session).
    localStorage.setItem("whoeverwants_user_name", "Alex");
    await syncNativeIdentity();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("logs a rejected setIdentity (the 'plugin not registered' diagnostic)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.setIdentity.mockRejectedValueOnce(
      new Error('"NativeIdentity" plugin is not implemented on ios'),
    );
    localStorage.setItem("browser_id", REAL_UUID);
    await syncNativeIdentity();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(
      "[native-identity] setIdentity rejected: ",
    );
    warn.mockRestore();
  });
});
