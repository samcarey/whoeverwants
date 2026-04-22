"use client";

import { useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import ModalPortal from "@/components/ModalPortal";
import FollowUpHeader from "@/components/FollowUpHeader";
import { Poll } from "@/lib/types";
import { buildPollSnapshot } from "@/lib/pollCreator";
import { formatShortDateTime } from "@/lib/timeUtils";

interface FollowUpModalProps {
  isOpen: boolean;
  poll: Poll;
  onClose: () => void;
  totalVotes?: number;
  showForkButton?: boolean;
  // When provided, renders a Forget button alongside the others. The parent is
  // responsible for confirmation + actually removing the poll.
  onDelete?: () => void;
  // When provided, renders a Reopen button on a new row. Only shown when the
  // poll is closed AND the caller deems reopening possible (e.g., creator in
  // dev mode).
  onReopen?: () => void;
}

export default function FollowUpModal({ isOpen, poll, onClose, totalVotes, showForkButton = true, onDelete, onReopen }: FollowUpModalProps) {
  const router = useRouter();
  const pathname = usePathname();
  // Ignore the synthetic click that fires immediately after the long-press
  // touch release — otherwise it lands on the full-viewport backdrop and
  // closes the modal on the same gesture that opened it.
  const openedAtRef = useRef(0);
  useEffect(() => {
    if (isOpen) openedAtRef.current = Date.now();
  }, [isOpen]);

  if (!isOpen) return null;

  const handleBackdropClick = () => {
    if (Date.now() - openedAtRef.current < 400) return;
    onClose();
  };

  const pollSnapshot = {
    ...buildPollSnapshot(poll),
    total_votes: totalVotes,
  };

  const deadline = poll.response_deadline ? new Date(poll.response_deadline) : null;
  const expiredText = deadline && deadline <= new Date()
    ? `Expired on ${formatShortDateTime(deadline)}`
    : null;

  const totalVotesText = typeof totalVotes === 'number' && totalVotes > 0
    ? `${totalVotes} total vote${totalVotes !== 1 ? 's' : ''}`
    : null;

  return (
    <ModalPortal>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 dark:bg-black/70 z-[100] animate-fade-in"
        onClick={handleBackdropClick}
      />

      {/* Modal */}
      <div className="fixed bottom-0 left-0 right-0 z-[110] animate-slide-up">
        <div className="bg-white dark:bg-gray-800 rounded-t-2xl shadow-xl p-6 pb-8">
          {(expiredText || totalVotesText) && (
            <div className="mb-4 text-center space-y-0.5">
              {expiredText && (
                <div>
                  <span className="text-sm font-bold text-red-700 dark:text-red-300">
                    {expiredText}
                  </span>
                </div>
              )}
              {totalVotesText && (
                <div>
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    {totalVotesText}
                  </span>
                </div>
              )}
            </div>
          )}
          <div className="flex gap-3">
            <button
              onClick={() => {
                localStorage.setItem(`duplicate-data-${poll.id}`, JSON.stringify(pollSnapshot));
                router.push(`${pathname}?create=1&duplicate=${poll.id}`);
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

            {showForkButton && (
              <button
                onClick={() => {
                  localStorage.setItem(`fork-data-${poll.id}`, JSON.stringify(pollSnapshot));
                  router.push(`${pathname}?create=1&fork=${poll.id}`);
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
            )}

            {onDelete && (
              <button
                onClick={() => {
                  onDelete();
                  onClose();
                }}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 bg-yellow-500 hover:bg-yellow-600 active:bg-yellow-700 active:scale-95 text-white font-medium text-sm rounded-lg transition-all duration-200"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                </svg>
                Forget
              </button>
            )}
          </div>

          {onReopen && (
            <div className="flex gap-3 mt-3">
              <button
                onClick={() => {
                  onReopen();
                  onClose();
                }}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 bg-green-600 hover:bg-green-700 active:bg-green-800 active:scale-95 text-white font-medium text-sm rounded-lg transition-all duration-200"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v6h6" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20 20v-6h-6" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5.5 9.5A7 7 0 0119 12" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18.5 14.5A7 7 0 015 12" />
                </svg>
                Reopen
              </button>
            </div>
          )}

          {/* Follow-up link — shown at the bottom of the modal when this poll
               follows up on another. Tapping the parent name navigates to that
               poll (which opens the containing thread with that card expanded). */}
          {poll.follow_up_to && (
            <div className="mt-4">
              <FollowUpHeader followUpToPollId={poll.follow_up_to} />
            </div>
          )}
        </div>
      </div>
    </ModalPortal>
  );
}
