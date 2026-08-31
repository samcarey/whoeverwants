import type { Metadata } from "next";
import { getApiEndpoint } from "@/lib/api/_internal";
import { buildMetadata, SITE_NAME } from "@/lib/metadata";
import FriendProfilePage from "./FriendProfilePage";

// Server-component shell (the invite-link pattern): the client UI lives in
// ./FriendProfilePage.tsx; this file only resolves the friend code to a
// name via the identity-free profile endpoint so a shared friend link
// previews as "Add <Name>" in messaging apps.

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}): Promise<Metadata> {
  const { code } = await params;
  const fallback = buildMetadata("Add a friend", `Connect on ${SITE_NAME}`);
  if (!code) return fallback;
  try {
    const url = `${getApiEndpoint("friends")}/profile/${encodeURIComponent(code)}`;
    const res = await fetch(url, { next: { revalidate: 60 } });
    if (!res.ok) return fallback;
    const data = (await res.json()) as { name?: string | null };
    const name = (data.name || "").trim();
    if (!name) return fallback;
    return buildMetadata(`Add ${name}`, `Send ${name} a friend request on ${SITE_NAME}`);
  } catch {
    return fallback;
  }
}

export default function Page() {
  return <FriendProfilePage />;
}
