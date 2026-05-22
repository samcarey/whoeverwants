/**
 * Phase D — WebAuthn / Passkey browser API wrapper.
 *
 * `navigator.credentials.create()` / `.get()` work with binary
 * (ArrayBuffer / Uint8Array) but the wire format we share with the
 * server is base64url JSON. These helpers convert between the two
 * shapes and drive the two-step ceremonies end-to-end.
 *
 * Two public entry points: `registerPasskey({name})` for adding a
 * passkey to a signed-in account, and `signInWithPasskey()` for
 * verifying an existing one. Each handles the full options→credential
 * round-trip + posts the result to the API helpers in `lib/api/auth`.
 *
 * Capability check: `passkeySupported()` returns true only when the
 * browser exposes PublicKeyCredential AND the platform appears to
 * support a user-verifying authenticator (best-effort — the real
 * proof is the ceremony succeeding). Native Capacitor iOS WebView
 * supports passkeys via the system authenticator since iOS 16; older
 * iOS surfaces still return false.
 */

import {
  apiPasskeyAuthenticationOptions,
  apiPasskeyAuthenticationVerify,
  apiPasskeyRegistrationOptions,
  apiPasskeyRegistrationVerify,
  type PasskeyRegistrationResult,
  type SessionResponse,
} from "@/lib/api";

// ---------------------------------------------------------------------------
// base64url <-> ArrayBuffer
// ---------------------------------------------------------------------------

function b64urlToBuffer(value: string): ArrayBuffer {
  // Decode tolerantly: tolerate base64 (+/) in case the server ever
  // sends standard base64 by accident; tolerate missing padding.
  // Returns ArrayBuffer (not Uint8Array) so the WebAuthn DOM types
  // (`BufferSource`) accept it without a cast — under modern TS,
  // `Uint8Array<ArrayBufferLike>` (the default Uint8Array's underlying
  // buffer might be SharedArrayBuffer) is not assignable to
  // BufferSource.
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function bytesToB64url(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// ---------------------------------------------------------------------------
// Options decoders — WebAuthn API wants the binary fields as
// BufferSource. The server hands them as base64url strings inside the
// options JSON. Walk the structure and swap.
// ---------------------------------------------------------------------------

interface ServerRegistrationOptions {
  rp: { id: string; name: string };
  user: { id: string; name: string; displayName: string };
  challenge: string;
  pubKeyCredParams: Array<{ alg: number; type: string }>;
  timeout?: number;
  excludeCredentials?: Array<{
    id: string;
    type: string;
    transports?: string[];
  }>;
  authenticatorSelection?: {
    residentKey?: ResidentKeyRequirement;
    requireResidentKey?: boolean;
    userVerification?: UserVerificationRequirement;
    authenticatorAttachment?: AuthenticatorAttachment;
  };
  attestation?: AttestationConveyancePreference;
}

interface ServerAuthenticationOptions {
  challenge: string;
  timeout?: number;
  rpId: string;
  allowCredentials?: Array<{
    id: string;
    type: string;
    transports?: string[];
  }>;
  userVerification?: UserVerificationRequirement;
}

function decodeRegistrationOptions(
  opts: ServerRegistrationOptions,
): PublicKeyCredentialCreationOptions {
  return {
    rp: opts.rp,
    user: {
      id: b64urlToBuffer(opts.user.id),
      name: opts.user.name,
      displayName: opts.user.displayName,
    },
    challenge: b64urlToBuffer(opts.challenge),
    pubKeyCredParams: opts.pubKeyCredParams as PublicKeyCredentialParameters[],
    timeout: opts.timeout,
    excludeCredentials: opts.excludeCredentials?.map((c) => ({
      id: b64urlToBuffer(c.id),
      type: c.type as PublicKeyCredentialType,
      transports: c.transports as AuthenticatorTransport[] | undefined,
    })),
    authenticatorSelection: opts.authenticatorSelection,
    attestation: opts.attestation,
  };
}

function decodeAuthenticationOptions(
  opts: ServerAuthenticationOptions,
): PublicKeyCredentialRequestOptions {
  return {
    challenge: b64urlToBuffer(opts.challenge),
    timeout: opts.timeout,
    rpId: opts.rpId,
    allowCredentials: opts.allowCredentials?.map((c) => ({
      id: b64urlToBuffer(c.id),
      type: c.type as PublicKeyCredentialType,
      transports: c.transports as AuthenticatorTransport[] | undefined,
    })),
    userVerification: opts.userVerification,
  };
}

// ---------------------------------------------------------------------------
// Credential serializers — go the OTHER way: WebAuthn returns an object
// with ArrayBuffer fields; we encode for the wire.
// ---------------------------------------------------------------------------

interface SerializedRegistrationCredential {
  id: string;
  rawId: string;
  type: "public-key";
  response: {
    clientDataJSON: string;
    attestationObject: string;
    transports?: string[];
  };
  authenticatorAttachment?: string | null;
  clientExtensionResults?: AuthenticationExtensionsClientOutputs;
}

interface SerializedAuthenticationCredential {
  id: string;
  rawId: string;
  type: "public-key";
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle: string | null;
  };
  authenticatorAttachment?: string | null;
  clientExtensionResults?: AuthenticationExtensionsClientOutputs;
}

function serializeRegistrationCredential(
  credential: PublicKeyCredential,
): SerializedRegistrationCredential {
  const response = credential.response as AuthenticatorAttestationResponse;
  // `getTransports()` is the modern way to read transports off the
  // attestation response; older Safari may not implement it.
  const transports =
    typeof response.getTransports === "function" ? response.getTransports() : undefined;
  return {
    id: credential.id,
    rawId: bytesToB64url(credential.rawId),
    type: "public-key",
    response: {
      clientDataJSON: bytesToB64url(response.clientDataJSON),
      attestationObject: bytesToB64url(response.attestationObject),
      transports,
    },
    authenticatorAttachment: credential.authenticatorAttachment,
    clientExtensionResults: credential.getClientExtensionResults(),
  };
}

function serializeAuthenticationCredential(
  credential: PublicKeyCredential,
): SerializedAuthenticationCredential {
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    id: credential.id,
    rawId: bytesToB64url(credential.rawId),
    type: "public-key",
    response: {
      clientDataJSON: bytesToB64url(response.clientDataJSON),
      authenticatorData: bytesToB64url(response.authenticatorData),
      signature: bytesToB64url(response.signature),
      userHandle: response.userHandle
        ? bytesToB64url(response.userHandle)
        : null,
    },
    authenticatorAttachment: credential.authenticatorAttachment,
    clientExtensionResults: credential.getClientExtensionResults(),
  };
}

// ---------------------------------------------------------------------------
// Capability detection
// ---------------------------------------------------------------------------

/**
 * True when the browser appears to support passkeys end-to-end. This is
 * a best-effort check: the real proof is the ceremony succeeding. Used
 * to gate UI visibility (hide buttons when the OS clearly can't perform
 * the ceremony).
 *
 * False on: very old browsers (no `window.PublicKeyCredential`),
 * non-browser contexts (SSR), and any environment where
 * `navigator.credentials.create` isn't exposed.
 */
export function passkeySupported(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof PublicKeyCredential === "undefined") return false;
  if (!window.navigator?.credentials?.create) return false;
  if (!window.navigator?.credentials?.get) return false;
  return true;
}

/**
 * Stronger capability check: ALSO confirms a user-verifying platform
 * authenticator is available (Touch ID, Face ID, Windows Hello,
 * Android device unlock). Returns false on the same conditions as
 * `passkeySupported()`, plus when `isUserVerifyingPlatformAuthenticatorAvailable`
 * returns false. Use this for the registration affordance — "Add
 * passkey" with no platform authenticator just frustrates users.
 *
 * Note: external (cross-platform) authenticators like USB security keys
 * aren't included here. They DO work end-to-end with `passkeySupported()`
 * + ceremony, but most users without a platform authenticator also
 * don't have a YubiKey, so optimizing for the platform case is fine.
 */
export async function platformPasskeySupported(): Promise<boolean> {
  if (!passkeySupported()) return false;
  try {
    const fn = PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable;
    if (typeof fn !== "function") return false;
    return await fn();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Registration + sign-in
// ---------------------------------------------------------------------------

/** Thrown when the user cancels the ceremony. Callers handle this
 *  silently — surfacing an "error" message after the user dismissed
 *  the prompt feels accusatory. */
export class PasskeyCancelledError extends Error {
  constructor() {
    super("Passkey ceremony was cancelled");
    this.name = "PasskeyCancelledError";
  }
}

/** Thrown when the platform doesn't support passkeys at all. */
export class PasskeyUnsupportedError extends Error {
  constructor() {
    super("Passkeys aren't supported on this device");
    this.name = "PasskeyUnsupportedError";
  }
}

function isCancellation(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // Different browsers raise different error names + messages on
  // user-cancel. Match defensively:
  //   - NotAllowedError is the spec'd name for "user dismissed prompt
  //     OR timeout" (browsers don't distinguish the two for privacy).
  //   - AbortError can fire when the page navigates away mid-prompt.
  if (err.name === "NotAllowedError") return true;
  if (err.name === "AbortError") return true;
  return false;
}

/** Run the registration ceremony end-to-end. Requires the user to
 *  already be signed in. The `name` is a user-supplied label
 *  ("MacBook Touch ID") stored alongside the credential. */
export async function registerPasskey(
  name?: string | null,
): Promise<PasskeyRegistrationResult> {
  if (!passkeySupported()) throw new PasskeyUnsupportedError();
  const options = (await apiPasskeyRegistrationOptions()) as ServerRegistrationOptions;
  const decoded = decodeRegistrationOptions(options);
  let credential: PublicKeyCredential | null;
  try {
    credential = (await navigator.credentials.create({
      publicKey: decoded,
    })) as PublicKeyCredential | null;
  } catch (err) {
    if (isCancellation(err)) throw new PasskeyCancelledError();
    throw err;
  }
  if (!credential) throw new PasskeyCancelledError();
  const serialized = serializeRegistrationCredential(credential);
  return apiPasskeyRegistrationVerify(serialized, name ?? null);
}

/** Run the sign-in ceremony end-to-end. Anonymous: the user picks a
 *  passkey from their OS prompt; the server resolves the user_id from
 *  the credential. On success the SessionResponse is persisted into
 *  lib/session so subsequent fetches attach the bearer token. */
export async function signInWithPasskey(): Promise<SessionResponse> {
  if (!passkeySupported()) throw new PasskeyUnsupportedError();
  const options = (await apiPasskeyAuthenticationOptions()) as ServerAuthenticationOptions;
  const decoded = decodeAuthenticationOptions(options);
  let credential: PublicKeyCredential | null;
  try {
    credential = (await navigator.credentials.get({
      publicKey: decoded,
      // `mediation: "optional"` lets the browser surface conditional
      // UI if it wants to, but won't block on it. We don't enable
      // `mediation: "conditional"` (autofill) — that requires extra
      // setup on the FE (a hidden form input with autocomplete tag)
      // and is a separate enhancement.
    })) as PublicKeyCredential | null;
  } catch (err) {
    if (isCancellation(err)) throw new PasskeyCancelledError();
    throw err;
  }
  if (!credential) throw new PasskeyCancelledError();
  const serialized = serializeAuthenticationCredential(credential);
  return apiPasskeyAuthenticationVerify(serialized);
}
