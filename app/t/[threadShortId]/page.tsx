import type { Metadata } from "next";
import { getApiEndpoint } from "@/lib/api/_internal";
import ThreadPage from "./ThreadPage";

const SITE_NAME = "WhoeverWants";

// Server-component shell. The client UI lives in `./ThreadPage.tsx`;
// this file exists only so `generateMetadata` can read `searchParams.p`
// (page-level form sees them, layout-level doesn't), letting the
// link-preview surface the linked poll instead of the thread's latest.
// No og:image / twitter:image: titles dominate messaging previews.
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

  const fallback = buildMetadata(SITE_NAME);
  if (!threadShortId) return fallback;

  try {
    const qs = pollShortId ? `?p=${encodeURIComponent(pollShortId)}` : "";
    const url = `${getApiEndpoint("threads")}/by-route-id/${encodeURIComponent(
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
    return buildMetadata(title, description);
  } catch {
    return fallback;
  }
}

export default function Page() {
  return <ThreadPage />;
}
