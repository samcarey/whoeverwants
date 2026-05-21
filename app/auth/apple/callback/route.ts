import { NextResponse } from "next/server";

/**
 * Apple Sign In callback stub for the @capgo/capacitor-social-login plugin.
 *
 * The plugin authenticates via ASAuthorizationController (native Apple ID
 * sheet) and gets the id_token via delegate callback. It THEN POSTs to
 * `redirectUrl` and requires a strict response contract — failing each
 * sub-requirement aborts the whole sign-in with a distinct error.
 *
 * Reverse-engineered from `ios/Sources/SocialLoginPlugin/AppleProvider.swift`:
 *
 *   - GET (during `initialize()`): must return 2xx. We return 200 JSON.
 *
 *   - POST (during `login()` after Apple's delegate fires): must return
 *     a 302 redirect (status 300–399). The Location URL must parse as a
 *     URL with `queryItems`, including:
 *       - `success=true` (required)
 *       - PLUS one of: (a) `code` + `client_secret`, (b) `access_token`
 *         + `refresh_token` + `id_token`, (c) `ios_no_code` flag.
 *     For our flow the JWT already came via the native delegate, so we
 *     use `ios_no_code=1` to tell the plugin "no server-side exchange,
 *     reuse the JWT you have." The plugin then resolves with that JWT
 *     and the FE POSTs it to `/api/auth/oauth/apple` for real
 *     verification.
 *
 * Past failures (Path of Discovery):
 *   - 404: redirectUrl was a nonexistent path (`/auth/verify` on prod)
 *   - 405: redirectUrl was the bare origin (POST not allowed on `/`)
 *   - "Invalid response code: 200": route returned 200 instead of 302
 *   - "Path components not found": 302 had no `success=true` query param
 */

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ status: "ok" });
}

export async function POST(request: Request) {
  const target = new URL("/auth/apple/callback", request.url);
  target.searchParams.set("success", "true");
  // Tell the plugin to reuse the JWT it already received from the
  // ASAuthorizationController delegate — no server-side code exchange.
  target.searchParams.set("ios_no_code", "1");
  return NextResponse.redirect(target, 302);
}
