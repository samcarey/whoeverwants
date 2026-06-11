import type { Metadata } from "next";
import { getApiEndpoint } from "@/lib/api/_internal";
import InviteRedeemPage from "./InviteRedeemPage";

const SITE_NAME = "WhoeverWants";

// Server-component shell. The client UI lives in `./InviteRedeemPage.tsx`;
// this file exists only so `generateMetadata` can resolve the invite token
// to its group's name via the identity-free
// `GET /api/auth/invites/<token>/preview` endpoint — so a shared invite
// link previews as "Join <Group Name>" in messaging apps instead of the
// generic site title. Same shell split as `app/g/[groupShortId]/page.tsx`.
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
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;

  const fallback = buildMetadata(
    "You're invited",
    `Join a group on ${SITE_NAME}`,
  );
  if (!token) return fallback;

  try {
    const url = `${getApiEndpoint("auth")}/invites/${encodeURIComponent(
      token,
    )}/preview`;
    const res = await fetch(url, { next: { revalidate: 60 } });
    if (!res.ok) return fallback;

    const data = (await res.json()) as { group_name?: string | null };
    const name = (data.group_name || "").trim();
    if (!name) return fallback;
    return buildMetadata(
      `Join ${name}`,
      `You've been invited to "${name}" on ${SITE_NAME}`,
    );
  } catch {
    return fallback;
  }
}

export default function Page() {
  return <InviteRedeemPage />;
}
