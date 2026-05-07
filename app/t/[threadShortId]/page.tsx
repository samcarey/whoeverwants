import type { Metadata } from "next";
import { getServerApiBaseUrl } from "@/lib/serverApi";
import ThreadPage from "./ThreadPage";

const SITE_NAME = "WhoeverWants";

/**
 * Server-component shell for the canonical thread route. The actual UI
 * (and its `"use client"` directive) lives in `./ThreadPage.tsx`. The
 * shell exists so we can export `generateMetadata`, which a Client
 * Component can't do.
 *
 * The whole reason this file is a server component is to access
 * `searchParams.p` — `/t/<thread>?p=<pollShortId>` is the canonical
 * share URL for a specific poll in a thread, and the OG/Twitter
 * preview MUST surface that exact poll's title (not the thread's
 * latest poll). Layout-level `generateMetadata` doesn't see
 * `searchParams`; only page-level `generateMetadata` does.
 *
 * No og:image / twitter:image: deliberate. The user wants the title
 * to take all the space in messaging-app previews — a logo thumbnail
 * crowds it out for no informational gain.
 */
export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ threadShortId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const { threadShortId } = await params;
  const sp = await searchParams;
  const rawP = sp?.p;
  const pollShortId =
    typeof rawP === "string" ? rawP : Array.isArray(rawP) ? rawP[0] : undefined;

  const fallback: Metadata = {
    title: SITE_NAME,
    openGraph: { title: SITE_NAME, type: "website" },
  };

  if (!threadShortId) return fallback;

  try {
    const apiBase = getServerApiBaseUrl();
    const qs = pollShortId ? `?p=${encodeURIComponent(pollShortId)}` : "";
    const url = `${apiBase}/api/threads/by-route-id/${encodeURIComponent(
      threadShortId,
    )}/preview${qs}`;
    const res = await fetch(url, { next: { revalidate: 60 } });
    if (!res.ok) return fallback;

    const data = (await res.json()) as {
      title?: string;
      description?: string | null;
    };
    const title = (data.title || "").trim() || SITE_NAME;
    const description = (data.description || "").trim() || undefined;

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        type: "website",
      },
      twitter: {
        card: "summary",
        title,
        description,
      },
    };
  } catch {
    return fallback;
  }
}

export default function Page() {
  return <ThreadPage />;
}
