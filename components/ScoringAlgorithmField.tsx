'use client';

/**
 * Scoring-algorithm picker for ranked-choice polls. One-row field (h-12,
 * matching every other bottom-card setting): label left, the selected
 * option shown as two stacked lines on the right (main label + the
 * algorithm name under it), with an invisible native <select> overlaid
 * for the actual dropdown — same pattern as VotingCutoffField.
 *
 * 'favorite'  -> Instant-Runoff (most first-choice support).
 * 'consensus' -> Borda score (broadest acceptance). Default.
 */

export type WinnerMethod = 'favorite' | 'consensus';

const OPTIONS: { value: WinnerMethod; label: string; sub: string }[] = [
  { value: 'favorite', label: 'Favorite', sub: 'Ranked Choice' },
  { value: 'consensus', label: 'Consensus', sub: 'Borda Score' },
];

interface ScoringAlgorithmFieldProps {
  value: WinnerMethod;
  setValue: (value: WinnerMethod) => void;
  disabled?: boolean;
}

export default function ScoringAlgorithmField({
  value,
  setValue,
  disabled = false,
}: ScoringAlgorithmFieldProps) {
  const selected = OPTIONS.find((o) => o.value === value) ?? OPTIONS[1];
  return (
    <label className="flex items-center justify-between gap-3 h-12 cursor-pointer">
      <span className="text-base font-normal">Scoring Algorithm</span>
      <span className="relative inline-flex">
        <span className="flex flex-col items-end leading-tight text-right">
          <span className="text-base font-normal text-gray-500 dark:text-gray-500">
            {selected.label}
          </span>
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {selected.sub}
          </span>
        </span>
        <select
          value={value}
          onChange={(e) => setValue(e.target.value as WinnerMethod)}
          disabled={disabled}
          className="absolute inset-0 opacity-0 cursor-pointer"
          aria-label="Scoring algorithm"
        >
          {OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {`${opt.label} (${opt.sub})`}
            </option>
          ))}
        </select>
      </span>
    </label>
  );
}
