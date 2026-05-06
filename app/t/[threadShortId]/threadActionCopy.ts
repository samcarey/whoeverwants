/**
 * Copy + button styling for the per-question long-press confirmation modal.
 * Forget / Reopen / Close / End-Availability share one ConfirmationModal
 * driven by the `kind` selector — keeping the messages here makes the
 * thread page render leaner and the strings easier to find.
 */
export type PendingActionKind = 'forget' | 'reopen' | 'close' | 'cutoff-availability';

export const PENDING_ACTION_COPY: Record<PendingActionKind, {
  title: string;
  message: string;
  confirmText: string;
  confirmButtonClass: string;
}> = {
  forget: {
    title: 'Forget poll',
    message: "This will remove the poll from your browser's history. You won't see it in your poll list anymore, and any vote data stored locally will be deleted. You can still access it again with the direct link.",
    confirmText: 'Forget Poll',
    confirmButtonClass: 'bg-yellow-500 hover:bg-yellow-600 text-white',
  },
  reopen: {
    title: 'Reopen Poll',
    message: 'Are you sure you want to reopen this poll? This will allow voting to resume and results will be hidden until the poll is closed again.',
    confirmText: 'Reopen Poll',
    confirmButtonClass: 'bg-green-600 hover:bg-green-700 text-white',
  },
  close: {
    title: 'Close Poll',
    message: 'Are you sure you want to close this poll? This action cannot be undone and voting will end immediately.',
    confirmText: 'Close Poll',
    confirmButtonClass: 'bg-red-600 hover:bg-red-700 text-white',
  },
  'cutoff-availability': {
    title: 'End Availability Phase',
    message: 'Are you sure you want to end the availability phase now? Time slots will be generated and preference ranking will begin immediately.',
    confirmText: 'End Now',
    confirmButtonClass: 'bg-amber-500 hover:bg-amber-600 text-white',
  },
};
