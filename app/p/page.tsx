"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, Suspense } from "react";
import { apiGetQuestionById, apiGetPollById } from "@/lib/api";

export const dynamic = 'force-dynamic';

function QuestionRedirect() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const id = searchParams.get('id');
  const isNew = searchParams.get('new');

  useEffect(() => {
    async function handleRedirect() {
      if (id) {
        try {
          // Phase 5b: short_id lives on the poll wrapper. Walk the
          // question → poll path to resolve the friendly URL.
          const question = await apiGetQuestionById(id);
          const pollId = question?.poll_id;
          const wrapper = pollId ? await apiGetPollById(pollId).catch(() => null) : null;
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

export default function QuestionPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading...</div>}>
      <QuestionRedirect />
    </Suspense>
  );
}
