import type { Metadata } from "next";
import { getApiEndpoint } from "@/lib/api/_internal";
import { buildMetadata, SITE_NAME } from "@/lib/metadata";
import GroupPage from "./GroupPage";

// Server-component shell. The client UI lives in `./GroupPage.tsx`;
// this file exists only so `generateMetadata` can read `searchParams.p`
// (page-level form sees them, layout-level doesn't), letting the
// link-preview surface the linked poll instead of the group's latest.

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ groupShortId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const { groupShortId } = await params;
  const sp = await searchParams;
  const rawP = sp?.p;
  const pollShortId =
    typeof rawP === "string" ? rawP : Array.isArray(rawP) ? rawP[0] : undefined;

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
  return <GroupPage />;
}
