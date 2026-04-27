"use client";

import { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import ModalPortal from "@/components/ModalPortal";
import { apiCreateMultipoll } from "@/lib/api";
import { generateCreatorSecret, recordPollCreation } from "@/lib/browserPollAccess";
import { getUserName } from "@/lib/userProfile";

interface VoteOnItModalProps {
  isOpen: boolean;
  pollId: string;
  pollTitle: string;
  suggestions: string[];
  onClose: () => void;
}

const DEADLINE_OPTIONS = [
  { value: "5min", label: "5 minutes", minutes: 5 },
  { value: "10min", label: "10 minutes", minutes: 10 },
  { value: "15min", label: "15 minutes", minutes: 15 },
  { value: "30min", label: "30 minutes", minutes: 30 },
  { value: "1hr", label: "1 hour", minutes: 60 },
  { value: "2hr", label: "2 hours", minutes: 120 },
  { value: "4hr", label: "4 hours", minutes: 240 },
];

export default function VoteOnItModal({ isOpen, pollId, pollTitle, suggestions, onClose }: VoteOnItModalProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [deadlineOption, setDeadlineOption] = useState("10min");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setDeadlineOption("10min");
      setIsSubmitting(false);
      setError(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCreate = async () => {
    setIsSubmitting(true);
    setError(null);

    try {
      const option = DEADLINE_OPTIONS.find(opt => opt.value === deadlineOption);
      const deadline = new Date(Date.now() + (option?.minutes ?? 10) * 60 * 1000);

      const creatorSecret = generateCreatorSecret();
      const creatorName = getUserName() || undefined;

      const multipoll = await apiCreateMultipoll({
        creator_secret: creatorSecret,
        creator_name: creatorName,
        response_deadline: deadline.toISOString(),
        follow_up_to: pollId,
        sub_polls: [
          {
            poll_type: "ranked_choice",
            options: suggestions,
            category: "custom",
          },
        ],
        title: pollTitle,
      });

      const subPoll = multipoll.sub_polls[0];
      recordPollCreation(subPoll.id, creatorSecret);
      const shortId = multipoll.short_id || subPoll.short_id || subPoll.id;
      router.push(`/p/${shortId}`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create poll");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = () => {
    const voteData = {
      title: pollTitle,
      options: suggestions,
      followUpTo: pollId,
    };
    localStorage.setItem(`vote-from-suggestion-${pollId}`, JSON.stringify(voteData));
    router.push(`${pathname}?create=1&voteFromSuggestion=${pollId}`);
    onClose();
  };

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 bg-black/50 dark:bg-black/70 z-[100] animate-fade-in"
        onClick={onClose}
      />

      <div className="fixed bottom-0 left-0 right-0 z-[110] animate-slide-up">
        <div className="bg-white dark:bg-gray-800 rounded-t-2xl shadow-xl p-6 pb-8 max-h-[80vh] overflow-y-auto">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 text-center">
            Ask for Preferences
          </h3>

          <div className="mb-4">
            <label htmlFor="vote-deadline" className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
              Response Deadline
            </label>
            <select
              id="vote-deadline"
              value={deadlineOption}
              onChange={(e) => setDeadlineOption(e.target.value)}
              disabled={isSubmitting}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {DEADLINE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <div className="mb-3 p-2 bg-red-100 dark:bg-red-900 border border-red-300 dark:border-red-600 text-red-700 dark:text-red-300 rounded-md text-sm">
              {error}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <button
              onClick={handleCreate}
              disabled={isSubmitting}
              className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 active:scale-95 disabled:bg-gray-400 text-white font-medium text-sm rounded-lg transition-all disabled:cursor-not-allowed"
            >
              {isSubmitting ? "Creating..." : "Create Poll"}
            </button>
            <button
              onClick={handleEdit}
              disabled={isSubmitting}
              className="w-full py-3 px-4 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 active:bg-gray-300 dark:active:bg-gray-500 active:scale-95 text-gray-900 dark:text-white font-medium text-sm rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed border border-gray-200 dark:border-gray-600"
            >
              Edit First
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
