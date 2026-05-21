import { NextResponse } from "next/server";

/**
 * Apple Sign In callback stub for the @capgo/capacitor-social-login plugin.
 *
 * On native iOS the plugin GETs/POSTs this URL during `SocialLogin.initialize`
 * + `SocialLogin.login` as part of its OAuth-flow emulation, then ignores
 * the response body — it just needs a 2xx. Without a tolerant endpoint,
 * `POST /` on the Vercel-served Next.js root returns 405 (the static page
 * only accepts GET) and the plugin rejects the whole sign-in flow with
 * `Error: Invalid response code: 405.` before our app ever sees an
 * id_token.
 *
 * This route accepts both GET and POST and returns 200 so the plugin's
 * sanity check passes. The actual identity token verification happens on
 * `/api/auth/oauth/apple` after the plugin hands the id_token to our JS,
 * not here — this is a no-op acknowledgment.
 */

export const dynamic = "force-dynamic";

function ok() {
  return NextResponse.json({ status: "ok" });
}

export async function GET() {
  return ok();
}

export async function POST() {
  return ok();
}
