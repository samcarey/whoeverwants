"use client";

import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { Poll, supabase } from "@/lib/supabase";
import ModalPortal from "@/components/ModalPortal";

interface FollowUpModalProps {
  isOpen: boolean;
  poll: Poll;
  onClose: () => void;
}

export default function FollowUpModal({ isOpen, poll, onClose }: FollowUpModalProps) {
  const router = useRouter();
  const [nominations, setNominations] = useState<string[]>([]);
  const [loadingNominations, setLoadingNominations] = useState(false);

  // Fetch actual nominations for nomination polls
  useEffect(() => {
    if (!isOpen || poll.poll_type !== 'nomination') {
      setNominations([]);
      return;
    }

    const fetchNominations = async () => {
      setLoadingNominations(true);
      try {
        const { data: votes, error } = await supabase
          .from('votes')
          .select('nominations')
          .eq('poll_id', poll.id)
          .eq('vote_type', 'nomination')
          .eq('is_abstain', false)
          .not('nominations', 'is', null);

        if (error) {
          console.error('Error fetching nominations:', error);
          setNominations([]);
          return;
        }

        // Collect all unique nominations
        const nominationSet = new Set<string>();
        votes?.forEach(vote => {
          if (vote.nominations && Array.isArray(vote.nominations)) {
            vote.nominations.forEach((nom: any) => {
              const nomString = typeof nom === 'string' ? nom : nom?.option || nom?.toString() || '';
              if (nomString) {
                nominationSet.add(nomString);
              }
            });
          }
        });

        setNominations(Array.from(nominationSet));
      } catch (error) {
        console.error('Error loading nominations:', error);
        setNominations([]);
      } finally {
        setLoadingNominations(false);
      }
    };

    fetchNominations();
  }, [isOpen, poll.poll_type, poll.id]);

  const handleVoteClick = () => {
    // Use the fetched nominations for the new preference poll
    const nominatedOptions = nominations;

    // Store data for the new preference poll
    const voteData = {
      title: poll.title,
      options: nominatedOptions,
      followUpTo: poll.id
    };
    localStorage.setItem(`vote-from-nomination-${poll.id}`, JSON.stringify(voteData));

    // Navigate to create-poll page with vote parameter
    router.push(`/create-poll?voteFromNomination=${poll.id}`);
    onClose();
  };

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
          {poll.poll_type === 'nomination' && nominations.length >= 2 && (
            <div className="mb-4">
              <button
                onClick={handleVoteClick}
                disabled={loadingNominations}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-green-600 to-blue-600 hover:from-green-700 hover:to-blue-700 text-white font-semibold text-lg rounded-lg transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loadingNominations ? (
                  <>
                    <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Loading...
                  </>
                ) : (
                  <>Vote on it</>
                )}
              </button>
            </div>
          )}

          <div className="flex gap-3 mb-4">
            <button
              onClick={() => {
                router.push(`/create-poll?followUpTo=${poll.id}`);
                onClose();
              }}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 bg-green-600 hover:bg-green-700 text-white font-medium text-sm rounded-lg transition-colors duration-200"
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
                  pollType: poll.poll_type,
                  options: poll.options,
                  responseDeadline: poll.response_deadline,
                  closeAutomatically: poll.is_closed
                };
                localStorage.setItem(`duplicate-data-${poll.id}`, JSON.stringify(duplicateData));
                router.push(`/create-poll?duplicate=${poll.id}`);
                onClose();
              }}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm rounded-lg transition-colors duration-200"
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
                  pollType: poll.poll_type,
                  options: poll.options,
                  responseDeadline: poll.response_deadline,
                  closeAutomatically: poll.is_closed
                };
                localStorage.setItem(`fork-data-${poll.id}`, JSON.stringify(forkData));
                router.push(`/create-poll?fork=${poll.id}`);
                onClose();
              }}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 bg-purple-600 hover:bg-purple-700 text-white font-medium text-sm rounded-lg transition-colors duration-200"
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