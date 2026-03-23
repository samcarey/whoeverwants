"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import ModalPortal from "@/components/ModalPortal";
import { apiFindDuplicatePoll, apiCreatePoll } from "@/lib/api";
import { generateCreatorSecret, recordPollCreation } from "@/lib/browserPollAccess";
import { getUserName } from "@/lib/userProfile";

interface VoteOnItModalProps {
  isOpen: boolean;
  pollId: string;
  pollTitle: string;
  nominations: string[];
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

export default function VoteOnItModal({ isOpen, pollId, pollTitle, nominations, onClose }: VoteOnItModalProps) {
  const router = useRouter();
  const [deadlineOption, setDeadlineOption] = useState("10min");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state when modal opens
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
      // Check for existing duplicate first
      const existing = await apiFindDuplicatePoll(pollTitle, pollId);
      if (existing) {
        // Duplicate exists — navigate to it
        const shortId = existing.short_id || existing.id;
        router.push(`/p/${shortId}`);
        onClose();
        return;
      }

      // No duplicate — create the poll
      const option = DEADLINE_OPTIONS.find(opt => opt.value === deadlineOption);
      const deadline = new Date(Date.now() + (option?.minutes ?? 10) * 60 * 1000);

      const creatorSecret = generateCreatorSecret();
      const creatorName = getUserName() || undefined;

      const poll = await apiCreatePoll({
        title: pollTitle,
        poll_type: "ranked_choice",
        options: nominations,
        response_deadline: deadline.toISOString(),
        creator_secret: creatorSecret,
        creator_name: creatorName,
        follow_up_to: pollId,
      });

      recordPollCreation(poll.id, creatorSecret);
      const shortId = poll.short_id || poll.id;
      router.push(`/p/${shortId}`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create poll");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = () => {
    // Fall back to the existing flow — navigate to create-poll form
    const voteData = {
      title: pollTitle,
      options: nominations,
      followUpTo: pollId,
    };
    localStorage.setItem(`vote-from-nomination-${pollId}`, JSON.stringify(voteData));
    router.push(`/create-poll?voteFromNomination=${pollId}`);
    onClose();
  };

  return (
    <ModalPortal>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 dark:bg-black/70 z-[100] animate-fade-in"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed bottom-0 left-0 right-0 z-[110] animate-slide-up">
        <div className="bg-white dark:bg-gray-800 rounded-t-2xl shadow-xl p-6 pb-8 max-h-[80vh] overflow-y-auto">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 text-center">
            Create Preference Poll
          </h3>

          {/* Title */}
          <div className="mb-3">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Title</label>
            <div className="px-3 py-2 bg-gray-100 dark:bg-gray-700 rounded-lg text-sm text-gray-900 dark:text-white">
              {pollTitle}
            </div>
          </div>

          {/* Options */}
          <div className="mb-3">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Options ({nominations.length})
            </label>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {nominations.map((nom, i) => (
                <div key={i} className="px-3 py-1.5 bg-gray-50 dark:bg-gray-700 rounded text-sm text-gray-800 dark:text-gray-200">
                  {nom}
                </div>
              ))}
            </div>
          </div>

          {/* Deadline picker */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Deadline</label>
            <div className="grid grid-cols-4 gap-1.5">
              {DEADLINE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setDeadlineOption(opt.value)}
                  disabled={isSubmitting}
                  className={`px-2 py-1.5 text-xs font-medium rounded-lg transition-all ${
                    deadlineOption === opt.value
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                  } disabled:opacity-50`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="mb-3 p-2 bg-red-100 dark:bg-red-900 border border-red-300 dark:border-red-600 text-red-700 dark:text-red-300 rounded-md text-sm">
              {error}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-3">
            <button
              onClick={handleCreate}
              disabled={isSubmitting}
              className="flex-1 py-3 px-4 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 active:scale-95 disabled:bg-gray-400 text-white font-medium text-sm rounded-lg transition-all disabled:cursor-not-allowed"
            >
              {isSubmitting ? "Creating..." : "Create Poll"}
            </button>
            <button
              onClick={handleEdit}
              disabled={isSubmitting}
              className="flex-1 py-3 px-4 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 active:bg-gray-300 dark:active:bg-gray-500 active:scale-95 text-gray-900 dark:text-white font-medium text-sm rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed border border-gray-200 dark:border-gray-600"
            >
              Edit First
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
