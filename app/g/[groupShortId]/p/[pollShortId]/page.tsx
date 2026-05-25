import type { Metadata } from "next";
import { getApiEndpoint } from "@/lib/api/_internal";
import PollDetailPage from "./PollDetailPage";

const SITE_NAME = "WhoeverWants";

// Server-component shell. The client UI lives in `./PollDetailPage.tsx`;
// this file exists only so `generateMetadata` can surface the linked poll's
// title in messaging-app previews. Both ids come from the path (no
// searchParams), so the preview fetch targets `?p=<pollShortId>` directly.
// No og:image / twitter:image: titles dominate messaging previews. Mirrors
// the group route's shell in `app/g/[groupShortId]/page.tsx`.
function buildMetadata(title: string, description?: string): Metadata {
  return {
    title,
    description,
    openGraph: { title, description, type: "website" },
    twitter: { card: "summary", title, description },
  };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ groupShortId: string; pollShortId: string }>;
}): Promise<Metadata> {
  const { groupShortId, pollShortId } = await params;

  const fallback = buildMetadata(SITE_NAME);
  if (!groupShortId) return fallback;

  try {
    const qs = pollShortId ? `?p=${encodeURIComponent(pollShortId)}` : "";
    const url = `${getApiEndpoint("groups")}/by-route-id/${encodeURIComponent(
      groupShortId,
    )}/preview${qs}`;
    const res = await fetch(url, { next: { revalidate: 60 } });
    if (!res.ok) return fallback;

    const data = (await res.json()) as {
      title?: string;
      description?: string | null;
    };
    const title = (data.title || "").trim() || SITE_NAME;
    const description = (data.description || "").trim() || undefined;
    return buildMetadata(title, description);
  } catch {
    return fallback;
  }
}

export default function Page() {
  return <PollDetailPage />;
}
