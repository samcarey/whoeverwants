"use client";

import React from "react";
import { createPortal } from "react-dom";
import { usePollModal } from "@/lib/pollModalContext";
export { POLL_MODAL_SUBMIT_PORTAL_ID } from "@/lib/pollModalContext";

export interface PollSubmitButtonProps {
  onClick: () => void;
  disabled?: boolean;
  // Full button contents (usually a text label, possibly with dynamic text
  // based on submitting state).
  children: React.ReactNode;
  // Inline styling used when not in modalMode. Preserves the per-call-site
  // button appearance (black, blue, etc.).
  className: string;
  type?: "button" | "submit";
}

/** Submit-style button that:
 *   - When not in modalMode: renders inline with the provided className.
 *   - When in modalMode: renders through the modal chrome submit portal with
 *     a compact iOS-sheet style (pill-shaped blue button).
 *  Label text is extracted from `children` (used verbatim). */
export default function PollSubmitButton({
  onClick,
  disabled = false,
  children,
  className,
  type = "button",
}: PollSubmitButtonProps) {
  const { modalMode, submitPortalEl } = usePollModal();

  if (modalMode) {
    if (!submitPortalEl) return null;
    return createPortal(
      <button
        type={type}
        onClick={onClick}
        disabled={disabled}
        className="h-[43px] px-4 rounded-full bg-blue-500 hover:bg-blue-600 text-white font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
      >
        {children}
      </button>,
      submitPortalEl
    );
  }

  return (
    <button type={type} onClick={onClick} disabled={disabled} className={className}>
      {children}
    </button>
  );
}
