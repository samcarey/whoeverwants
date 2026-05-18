"use client";

import type { ReactNode } from "react";

/**
 * Shared colored action button used by the poll info page. Variants encode
 * the semantic meaning: blue=primary, yellow=destructive-soft, green=resume,
 * red=destructive-hard, amber=time-sensitive cutoff.
 *
 * If FollowUpModal's parallel button stack is ever consolidated, that's the
 * second consumer — see the WIP migration note in CLAUDE.md.
 */
export type PollActionVariant = "blue" | "yellow" | "green" | "red" | "amber";

const VARIANT_CLASSES: Record<PollActionVariant, string> = {
  blue: "bg-blue-600 hover:bg-blue-700 active:bg-blue-800",
  yellow: "bg-yellow-500 hover:bg-yellow-600 active:bg-yellow-700",
  green: "bg-green-600 hover:bg-green-700 active:bg-green-800",
  red: "bg-red-600 hover:bg-red-700 active:bg-red-800",
  amber: "bg-amber-500 hover:bg-amber-600 active:bg-amber-700",
};

const BASE_CLASS =
  "inline-flex items-center justify-center gap-2 px-4 py-3 active:scale-95 text-white font-medium text-sm rounded-lg transition-all duration-200 disabled:opacity-50 disabled:active:scale-100";

export default function PollActionButton({
  variant,
  icon,
  label,
  onClick,
  disabled = false,
  className = "",
}: {
  variant: PollActionVariant;
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${BASE_CLASS} ${VARIANT_CLASSES[variant]} ${className}`}
    >
      {icon}
      {label}
    </button>
  );
}

/** Clock icon shared by Cutoff Suggestions + End Availability Phase. */
export function CutoffIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <circle cx="12" cy="12" r="9" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 2" />
    </svg>
  );
}
