"use client";

import { LegacyRedirectPage } from "../_legacyRedirect";

export const dynamic = 'force-dynamic';

export default function InfoRedirectPage() {
  return (
    <LegacyRedirectPage
      buildTarget={(rootRouteId) => `/g/${rootRouteId}/info`}
    />
  );
}
