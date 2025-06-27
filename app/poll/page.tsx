"use client";

import { supabase, Poll } from "@/lib/supabase";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, Suspense } from "react";
import PollPageClient from "./PollPageClient";

function PollContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get('id');
  const [poll, setPoll] = useState<Poll | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!id) {
      setError(true);
      setLoading(false);
      return;
    }

    async function fetchPoll() {
      try {
        const { data, error } = await supabase
          .from("polls")
          .select("*")
          .eq("id", id)
          .single();

        if (error || !data) {
          setError(true);
        } else {
          setPoll(data);
        }
      } catch (err) {
        setError(true);
      } finally {
        setLoading(false);
      }
    }

    fetchPoll();
  }, [id]);

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

  const handlePollUpdate = (updatedPoll: Poll) => {
    setPoll(updatedPoll);
  };

  return <PollPageClient poll={poll} createdDate={createdDate} onPollUpdate={handlePollUpdate} />;
}

export default function PollPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading...</div>}>
      <PollContent />
    </Suspense>
  );
}