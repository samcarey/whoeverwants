"use client";

import { useRouter } from "next/navigation";
import ModalPortal from "@/components/ModalPortal";
import { Poll } from "@/lib/supabase";

interface FollowUpModalProps {
  isOpen: boolean;
  poll: Poll;
  onClose: () => void;
}

export default function FollowUpModal({ isOpen, poll, onClose }: FollowUpModalProps) {
  const router = useRouter();

  if (!isOpen) return null;

  return (
    <ModalPortal>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 dark:bg-black/70 z-[100] animate-fade-in"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed bottom-0 left-0 right-0 z-[110] animate-slide-up">
        <div className="bg-white dark:bg-gray-800 rounded-t-2xl shadow-xl p-6 pb-8">
          <div className="flex gap-3 mb-4">
            <button
              onClick={() => {
                router.push(`/create-poll?followUpTo=${poll.id}`);
                onClose();
              }}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 bg-green-600 hover:bg-green-700 active:bg-green-800 active:scale-95 text-white font-medium text-sm rounded-lg transition-all duration-200"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <circle cx="12" cy="12" r="10"/>
              </svg>
              Blank
            </button>

            <button
              onClick={() => {
                // Store poll data for duplication
                const duplicateData = {
                  title: poll.title,
                  poll_type: poll.poll_type,
                  options: poll.options,
                  response_deadline: poll.response_deadline,
                  creator_name: poll.creator_name,
                  min_participants: poll.min_participants,
                  max_participants: poll.max_participants
                };
                localStorage.setItem(`duplicate-data-${poll.id}`, JSON.stringify(duplicateData));
                router.push(`/create-poll?duplicate=${poll.id}`);
                onClose();
              }}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 active:scale-95 text-white font-medium text-sm rounded-lg transition-all duration-200"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
              Copy
            </button>

            <button
              onClick={() => {
                // Store poll data for fork
                const forkData = {
                  title: poll.title,
                  poll_type: poll.poll_type,
                  options: poll.options,
                  response_deadline: poll.response_deadline,
                  creator_name: poll.creator_name,
                  min_participants: poll.min_participants,
                  max_participants: poll.max_participants
                };
                localStorage.setItem(`fork-data-${poll.id}`, JSON.stringify(forkData));
                router.push(`/create-poll?fork=${poll.id}`);
                onClose();
              }}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 bg-purple-600 hover:bg-purple-700 active:bg-purple-800 active:scale-95 text-white font-medium text-sm rounded-lg transition-all duration-200"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <circle cx="6" cy="6" r="2"/>
                <circle cx="18" cy="6" r="2"/>
                <circle cx="12" cy="18" r="2"/>
                <path d="M18 8v2a2 2 0 01-2 2H8a2 2 0 01-2-2V8"/>
                <path d="M12 16V12"/>
              </svg>
              Fork
            </button>
          </div>

          <div className="mt-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center justify-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
              </svg>
              Follow up with the same recipients
            </h3>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
