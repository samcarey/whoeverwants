import { NextRequest, NextResponse } from "next/server";

// Links to the site frequently get pasted with accidental trailing asterisks —
// e.g. a Markdown-bolded URL `**https://whoeverwants.com/g/~6/p/D**` leaks the
// closing `**` onto the end of the real URL. Strip any trailing asterisks
// (literal `*` or percent-encoded `%2A`) and redirect to the clean URL. No real
// route ends in an asterisk (short_ids are base62 + `~`), so this is safe.
const TRAILING_ASTERISKS = /(?:\*|%2[Aa])+$/;

export function middleware(request: NextRequest) {
  // The junk always lands at the very end of the URL — on the query string when
  // one is present, otherwise on the path — so a single test on the full href
  // covers both cases.
  const { href } = request.nextUrl;
  if (!TRAILING_ASTERISKS.test(href)) {
    return NextResponse.next();
  }
  return NextResponse.redirect(href.replace(TRAILING_ASTERISKS, ""), 308);
}

export const config = {
  // Run on page routes only — skip API (proxied via rewrites), Next.js
  // internals, and static asset files. The function itself is a cheap regex
  // test, so the broad matcher is fine.
  matcher: ["/((?!api/|_next/|favicon.ico|.*\\.[^/]+$).*)"],
};
