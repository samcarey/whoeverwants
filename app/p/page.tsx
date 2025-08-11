"use client";

import { supabase, Poll } from "@/lib/supabase";
import { useEffect, useState, Suspense } from "react";
import { useRouter } from "next/navigation";
import PollPageClient from "./PollPageClient";

function PollContent() {
  const [poll, setPoll] = useState<Poll | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [pollId, setPollId] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    // Check if we're in the browser
    if (typeof window === 'undefined') {
      return;
    }

    // Extract poll ID from URL search params
    const urlParams = new URLSearchParams(window.location.search);
    let id = urlParams.get('id');
    
    // Backward compatibility: check for hash format and redirect
    if (!id && window.location.hash) {
      const hashId = window.location.hash.substring(1);
      if (hashId) {
        window.location.replace(`/p?id=${hashId}${window.location.search ? '&' + window.location.search.substring(1) : ''}`);
        return;
      }
    }
    
    // Backward compatibility: check for path format (/p/id) and redirect
    if (!id) {
      const pathSegments = window.location.pathname.split('/').filter(Boolean);
      if (pathSegments.length >= 2 && pathSegments[0] === 'p') {
        const pathId = pathSegments[1];
        window.location.replace(`/p?id=${pathId}${window.location.search}`);
        return;
      }
    }
    
    if (!id) {
      // If no ID provided, redirect to home
      router.replace('/');
      return;
    }

    setPollId(id);

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
  }, [router]);

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