import type { Metadata } from "next";
import { getServerApiBaseUrl } from "@/lib/serverApi";

const SITE_NAME = "WhoeverWants";
const DEFAULT_DESCRIPTION = "Anonymous polling for group decisions.";
// Next.js merges metadata field-by-field but REPLACES nested objects
// like `openGraph` / `twitter` when a child route redefines them, so
// child layouts must restate any fields they want to inherit (in
// particular the og/twitter image). Keep this in sync with
// `app/layout.tsx`.
const PREVIEW_IMAGE = {
  url: "/icon-512x512.png",
  width: 512,
  height: 512,
  alt: SITE_NAME,
};

/**
 * Server-side `generateMetadata` for the canonical thread route.
 *
 * Fetches a tiny public preview payload (`{title, description}`) from
 * `/api/threads/by-route-id/<id>/preview` and feeds it into Next.js's
 * Metadata API so link-preview crawlers (Slack, iMessage, Twitter, etc.)
 * see the actual poll title — not the static "WhoeverWants" fallback.
 *
 * The preview endpoint is intentionally unauthenticated: the URL itself
 * is the share token. It returns ONLY title + description, never vote
 * data or question contents — visibility-gated reads still go through
 * the existing `/api/threads/by-route-id/<id>` endpoint.
 *
 * Layout-level `generateMetadata` doesn't see `searchParams`, so the
 * `?p=<pollShortId>` deep-link form falls back to the thread's most
 * recently created poll. That's the right call most of the time
 * (latest poll = most relevant) and the per-poll fidelity isn't worth
 * the cost of refactoring the 2k-line client `page.tsx` into a server-
 * component shell. If finer fidelity is wanted later, do that refactor
 * and add `searchParams` to a page-level `generateMetadata`.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ threadShortId: string }>;
}): Promise<Metadata> {
  const { threadShortId } = await params;
  const fallback: Metadata = {
    title: SITE_NAME,
    description: DEFAULT_DESCRIPTION,
    openGraph: {
      title: SITE_NAME,
      description: DEFAULT_DESCRIPTION,
      siteName: SITE_NAME,
      type: "website",
      images: [PREVIEW_IMAGE],
    },
    twitter: {
      card: "summary",
      title: SITE_NAME,
      description: DEFAULT_DESCRIPTION,
      images: [PREVIEW_IMAGE.url],
    },
  };

  if (!threadShortId) return fallback;

  try {
    const apiBase = getServerApiBaseUrl();
    const url = `${apiBase}/api/threads/by-route-id/${encodeURIComponent(
      threadShortId,
    )}/preview`;
    const res = await fetch(url, {
      // Cache lightly so repeated crawls don't hammer the API but
      // edits to `thread_title` show up within a minute.
      next: { revalidate: 60 },
    });
    if (!res.ok) return fallback;

    const data = (await res.json()) as { title?: string; description?: string | null };
    const title = (data.title || "").trim() || SITE_NAME;
    const description = (data.description || "").trim() || DEFAULT_DESCRIPTION;

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        siteName: SITE_NAME,
        type: "website",
        images: [PREVIEW_IMAGE],
      },
      twitter: {
        card: "summary",
        title,
        description,
        images: [PREVIEW_IMAGE.url],
      },
    };
  } catch {
    return fallback;
  }
}

export default function ThreadLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
