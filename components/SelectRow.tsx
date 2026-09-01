'use client';

/**
 * A one-row settings dropdown: label left, the selected option's label right
 * in the faded value font, with an invisible native <select> overlaid for the
 * actual picker. The h-12 label/value row every settings card uses.
 *
 * This is the generic form of the pattern VotingCutoffField and
 * ScoringAlgorithmField each spell out inline — both keep their own copies
 * (VotingCutoffField expands into custom date/time inputs; ScoringAlgorithm's
 * options carry a parenthesised sub-label), so reach for this one when the
 * field is nothing more than "pick a value from a list".
 */

export interface SelectRowOption {
  value: string;
  label: string;
}

interface SelectRowProps {
  label: string;
  value: string;
  options: SelectRowOption[];
  onChange: (value: string) => void;
  /** Defaults to `label` — override when the visible text is ambiguous alone. */
  ariaLabel?: string;
  disabled?: boolean;
}

export default function SelectRow({
  label,
  value,
  options,
  onChange,
  ariaLabel,
  disabled = false,
}: SelectRowProps) {
  const selected = options.find((o) => o.value === value) ?? options[0];
  return (
    <label className="flex items-center justify-between gap-3 h-12 cursor-pointer">
      <span className="text-base font-normal shrink-0">{label}</span>
      <span className="relative inline-flex min-w-0">
        <span className="min-w-0 truncate text-base font-normal text-gray-500 dark:text-gray-500 text-right">
          {selected?.label ?? ""}
        </span>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="absolute inset-0 opacity-0 cursor-pointer"
          aria-label={ariaLabel ?? label}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </span>
    </label>
  );
}
