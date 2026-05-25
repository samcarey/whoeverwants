// Amber "new options since you last ranked" note. Shared by the poll detail
// page's steady-state ("Your Ballot") view (QuestionBallot) and the in-edit
// ranking ballot (RankingSection) so both surfaces stay in lockstep.
// New-options detection lives in QuestionBallot's `newOptions` memo
// (seen-options snapshot from lib/browserQuestionAccess.ts).
//
// Informational only — entering edit mode is reached via the edit affordance
// right next to it (the "Edit" button in RankingSection's summary, the
// "Your Ballot" link in QuestionBallot's steady-state view).

const WARNING_ICON = (
  <svg className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
  </svg>
);

interface NewOptionsBannerProps {
  count: number;
  className?: string;
}

export default function NewOptionsBanner({ count, className = "mb-2" }: NewOptionsBannerProps) {
  if (count <= 0) return null;
  const label = `New option${count > 1 ? "s" : ""} since you last ranked`;

  return (
    <div className={`${className} px-3 py-2 bg-amber-50 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 rounded-lg flex items-center gap-2`}>
      {WARNING_ICON}
      <span className="text-sm text-amber-800 dark:text-amber-200 font-medium">{label}</span>
    </div>
  );
}
