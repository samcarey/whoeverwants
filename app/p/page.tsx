"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, Suspense } from "react";
import { supabase } from "@/lib/supabase";

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
          // Try to get the poll to check if it has a short_id
          const { data: poll, error } = await supabase
            .from("polls")
            .select("short_id")
            .eq("id", id)
            .single();

          if (!error && poll?.short_id) {
            // Redirect to new short URL format
            router.replace(`/p/${poll.short_id}`);
          } else {
            // Fallback: redirect to UUID format (backward compatibility)
            router.replace(`/p/${id}`);
          }
        } catch (error) {
          // If we can't fetch the poll, just redirect with the ID
          router.replace(`/p/${id}`);
        }
      } else {
        // If no id, redirect to home
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