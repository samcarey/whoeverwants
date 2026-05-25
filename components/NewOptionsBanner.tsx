// Amber "new options available since you last ranked" alert. Shared by the
// poll detail page's steady-state ("Your Ballot") view (QuestionBallot) and the
// in-edit ranking ballot (RankingSection) so both surfaces stay in lockstep.
// New-options detection lives in QuestionBallot's `newOptions` memo
// (seen-options snapshot from lib/browserQuestionAccess.ts).
//
// When `onClick` is provided the banner is a button ("— tap to rank" + chevron)
// that enters ranking-edit mode; without it the banner is informational.

const WARNING_ICON = (
  <svg className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
  </svg>
);

interface NewOptionsBannerProps {
  count: number;
  className?: string;
  onClick?: () => void;
}

export default function NewOptionsBanner({ count, className = "mb-2", onClick }: NewOptionsBannerProps) {
  if (count <= 0) return null;
  const label = `New option${count > 1 ? "s" : ""} available since you last ranked`;

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${className} w-full px-3 py-2 bg-amber-50 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 rounded-lg flex items-center gap-2 text-left hover:bg-amber-100 dark:hover:bg-amber-900/50 active:opacity-80 transition-colors`}
      >
        {WARNING_ICON}
        <span className="flex-1 text-sm text-amber-800 dark:text-amber-200 font-medium">
          {label} — tap to rank
        </span>
        <svg className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
    );
  }

  return (
    <div className={`${className} px-3 py-2 bg-amber-50 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 rounded-lg flex items-center gap-2`}>
      {WARNING_ICON}
      <span className="text-sm text-amber-800 dark:text-amber-200 font-medium">{label}</span>
    </div>
  );
}
