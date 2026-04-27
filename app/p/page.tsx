"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, Suspense } from "react";
import { apiGetPollById, apiGetMultipollById } from "@/lib/api";

export const dynamic = 'force-dynamic';

function PollRedirect() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const id = searchParams.get('id');
  const isNew = searchParams.get('new');

  useEffect(() => {
    async function handleRedirect() {
      if (id) {
        try {
          // Phase 5b: short_id lives on the multipoll wrapper. Walk the
          // sub-poll → multipoll path to resolve the friendly URL.
          const poll = await apiGetPollById(id);
          const multipollId = poll?.multipoll_id;
          const wrapper = multipollId ? await apiGetMultipollById(multipollId).catch(() => null) : null;
          if (wrapper?.short_id) {
            router.replace(`/p/${wrapper.short_id}`);
          } else {
            router.replace(`/p/${id}`);
          }
        } catch (error) {
          router.replace(`/p/${id}`);
        }
      } else {
        router.replace('/');
      }
    }

    handleRedirect();
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
