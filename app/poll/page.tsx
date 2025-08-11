"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, Suspense } from "react";
import { useRouter } from "next/navigation";

export const dynamic = 'force-dynamic';

function PollRedirect() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const id = searchParams.get('id');
  const isNew = searchParams.get('new');

  useEffect(() => {
    if (id) {
      // Redirect to new URL structure, preserving the 'new' parameter if it exists
      const newUrl = isNew ? `/p/${id}?new=true` : `/p/${id}`;
      router.replace(newUrl);
    } else {
      // If no id, redirect to home
      router.replace('/');
    }
  }, [id, isNew, router]);

  return <div className="min-h-screen flex items-center justify-center">Redirecting...</div>;
}

export default function PollPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading...</div>}>
      <PollRedirect />
    </Suspense>
  );
}