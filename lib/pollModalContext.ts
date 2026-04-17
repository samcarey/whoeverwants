"use client";

import { createContext, useContext } from "react";

/** DOM id of the portal target rendered in the PollCardModal chrome header.
 *  PollSubmitButton portals its rendered button here when modalMode is true. */
export const POLL_MODAL_SUBMIT_PORTAL_ID = "poll-modal-submit-portal";

/** Context indicating that PollPageClient is rendered inside PollCardModal.
 *  When modalMode is true, submit buttons portal into the modal chrome header
 *  instead of rendering inline, and the modal's X button is used for back. */
export interface PollModalContextValue {
  modalMode: boolean;
  // The DOM element to portal submit buttons into. Null until the modal mounts.
  submitPortalEl: HTMLElement | null;
  // Called by a successful vote to trigger the modal's shrink-back animation.
  onRequestClose?: () => void;
}

export const PollModalContext = createContext<PollModalContextValue>({
  modalMode: false,
  submitPortalEl: null,
});

export const usePollModal = () => useContext(PollModalContext);
