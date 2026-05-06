"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, Suspense } from "react";
import { useRouter } from "next/navigation";

export const dynamic = 'force-dynamic';

function QuestionRedirect() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const id = searchParams.get('id');
  const isNew = searchParams.get('new');

  useEffect(() => {
    if (id) {
      // Hand off to /t/?id=<id> which resolves the question id to its thread
      // root and redirects to `/t/<root>?p=<pollShortId>`. Preserves the
      // legacy /poll?id=<question-uuid> deep-link form.
      router.replace(`/t/?id=${encodeURIComponent(id)}`);
    } else {
      // If no id, redirect to home
      router.replace('/');
    }
  }, [id, isNew, router]);

  return <div className="min-h-screen flex items-center justify-center">Redirecting...</div>;
}

export default function QuestionPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading...</div>}>
      <QuestionRedirect />
    </Suspense>
  );
}