"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, Suspense } from "react";

export const dynamic = 'force-dynamic';

// Legacy `/p/` redirect to `/t/` (the canonical empty-thread placeholder).
// Forwards any query params (e.g. `?id=<question-uuid>` from the old
// `/p/?id=...` deep-link form, which `/t/` resolves and redirects again).
function PRootRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();
  useEffect(() => {
    const qs = searchParams.toString();
    router.replace(qs ? `/t/?${qs}` : '/t/');
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
