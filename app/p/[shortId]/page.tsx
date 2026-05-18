"use client";

import { LegacyRedirectPage } from "./_legacyRedirect";

export const dynamic = 'force-dynamic';

// Legacy `/p/<shortId>` → `/g/<root>/p/<pollShort>` redirect. The shortId
// can be a poll short_id, a poll uuid, or a question uuid; resolution is
// shared with the /info and /edit-title sub-routes via _legacyRedirect.
export default function PollRedirectPage() {
  return (
    <LegacyRedirectPage
      buildTarget={(rootRouteId, pollShortId) => `/g/${rootRouteId}/p/${pollShortId}`}
      allowQuestionUuid
    />
  );
}
