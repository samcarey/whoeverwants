"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, Suspense } from "react";

export const dynamic = 'force-dynamic';

// Legacy `/p/` redirect to `/g/` (the canonical empty-group placeholder).
// Forwards any query params (e.g. `?id=<question-uuid>` from the old
// `/p/?id=...` deep-link form, which `/g/` resolves and redirects again).
function PRootRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();
  useEffect(() => {
    const qs = searchParams.toString();
    router.replace(qs ? `/g/?${qs}` : '/g/');
  }, [router, searchParams]);
  return <div className="min-h-screen flex items-center justify-center">Redirecting...</div>;
}

export default function PRootPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading...</div>}>
      <PRootRedirect />
    </Suspense>
  );
}
