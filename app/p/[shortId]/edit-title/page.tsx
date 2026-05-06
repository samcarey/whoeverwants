"use client";

import { LegacyRedirectPage } from "../_legacyRedirect";

export const dynamic = 'force-dynamic';

export default function EditTitleRedirectPage() {
  return (
    <LegacyRedirectPage
      buildTarget={(rootRouteId) => `/t/${rootRouteId}/edit-title`}
    />
  );
}
