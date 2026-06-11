import type { Metadata } from "next";

export const SITE_NAME = "WhoeverWants";

/**
 * Shared Open Graph / Twitter Card builder for the server-component
 * metadata shells (group root, poll detail, invite landing). No
 * og:image / twitter:image: titles dominate messaging previews.
 */
export function buildMetadata(title: string, description?: string): Metadata {
  return {
    title,
    description,
    openGraph: { title, description, type: "website" },
    twitter: { card: "summary", title, description },
  };
}
