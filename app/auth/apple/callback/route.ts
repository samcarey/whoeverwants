import { NextResponse } from "next/server";

/**
 * Apple Sign In callback stub for the @capgo/capacitor-social-login plugin.
 *
 * Despite the plugin using ASAuthorizationController (the native Apple ID
 * sheet) to actually authenticate, AFTER getting the id_token from Apple's
 * delegate callback it ALSO POSTs to `redirectUrl` and expects a **302
 * redirect** response (HTTP 300–399). 200 is treated as
 * `Error: Invalid response code: 200.` and rejects the whole sign-in.
 * See `ios/Sources/SocialLoginPlugin/AppleProvider.swift: sendRequest`
 * in the @capgo plugin source — it parses query params from the redirect's
 * Location header to pass back to JS as supplementary data.
 *
 * Our flow doesn't need any supplementary data (the id_token already came
 * via the native delegate), so this handler:
 *   - GET → 200 (the plugin GETs during initialize, just needs 2xx)
 *   - POST → 302 redirect to itself (the plugin's POST sanity check;
 *     query string is empty since we have nothing to pass)
 *
 * Actual id_token verification still happens on `/api/auth/oauth/apple`
 * after the plugin's JS resolves with the token.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ status: "ok" });
}

export async function POST(request: Request) {
  // Redirect back to the same path with no params — the plugin parses
  // the Location's query string into a key/value bag and ignores empty.
  const target = new URL("/auth/apple/callback", request.url);
  return NextResponse.redirect(target, 302);
}
