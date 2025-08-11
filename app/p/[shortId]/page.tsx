"use client";

import { supabase, Poll, getPollByShortId, getPollById } from "@/lib/supabase";
import { useEffect, useState, Suspense } from "react";
import { useRouter } from "next/navigation";
import { useParams, useSearchParams } from "next/navigation";
import PollPageClient from "./PollPageClient";

export const dynamic = 'force-dynamic';

function PollContent() {
  const [poll, setPoll] = useState<Poll | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [pollId, setPollId] = useState<string | null>(null);
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();

  useEffect(() => {
    const shortId = params.shortId as string;
    
    if (!shortId) {
      router.replace('/');
      return;
    }

    async function fetchPoll() {
      try {
        // First try to fetch by short_id
        let pollData: Poll;
        try {
          pollData = await getPollByShortId(shortId);
        } catch (shortIdError) {
          // If short_id fails, try as UUID (backward compatibility)
          try {
            pollData = await getPollById(shortId);
          } catch (uuidError) {
            setError(true);
            return;
          }
        }

        setPoll(pollData);
        setPollId(pollData.id);
      } catch (err) {
        setError(true);
      } finally {
        setLoading(false);
      }
    }

    fetchPoll();
  }, [params.shortId, router]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  if (error || !poll) {
    return <div className="min-h-screen flex items-center justify-center">Poll not found</div>;
  }

  const createdDate = new Date(poll.created_at).toLocaleDateString("en-US", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });

  return <PollPageClient poll={poll} createdDate={createdDate} pollId={pollId} />;
}

export default function PollPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading...</div>}>
      <PollContent />
    </Suspense>
  );
}