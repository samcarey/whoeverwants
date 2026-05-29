import React from 'react';

interface AbstainLinkProps {
  isAbstaining: boolean;
  onClick: () => void;
  disabled?: boolean;
  /** Wrapper margin classes (e.g. "mt-2" / "mb-2"). Centering is built in. */
  className?: string;
}

/**
 * The canonical "Abstain" affordance: a small gold-text link (no outline),
 * present-tense "Abstaining" when staged. Shared by every ballot — yes/no,
 * ranked-choice (binary + drag-to-rank), and time (availability + preferences)
 * — so the control looks identical everywhere.
 */
export default function AbstainLink({
  isAbstaining,
  onClick,
  disabled = false,
  className = '',
}: AbstainLinkProps) {
  return (
    <div className={`text-center ${className}`.trim()}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="text-xs text-amber-600 dark:text-amber-400 font-medium hover:underline active:opacity-70 disabled:opacity-50"
      >
        {isAbstaining ? 'Abstaining' : 'Abstain'}
      </button>
    </div>
  );
}
