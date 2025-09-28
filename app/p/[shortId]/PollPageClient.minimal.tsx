"use client";

import React from 'react';
import { Poll } from "@/lib/supabase";

interface PollPageClientProps {
  poll: Poll;
  createdDate: string;
  pollId: string | null;
}

export default function PollPageClient({ poll, createdDate, pollId }: PollPageClientProps) {
  return (
    <div>
      <h1>{poll.title}</h1>
      <p>Test component</p>
    </div>
  );
}