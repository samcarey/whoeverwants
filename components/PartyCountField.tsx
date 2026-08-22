"use client";

/**
 * "At Least" / "No More Than" party-size picker on a slot activity. One-row
 * field (h-12, the bottom-card settings idiom): label left, the selected
 * value right, with an invisible native <select> overlaid — same pattern as
 * ScoringAlgorithmField / VotingCutoffField.
 *
 * Values are TOTAL head counts but read as "how many besides me": 1 is "Me",
 * 2 is "+1", … 8 is "+7". The caller keeps the pair ordered (raising the
 * minimum pushes the maximum up, and vice versa).
 */

export const PARTY_MIN = 1;
export const PARTY_MAX = 8;

/** 1 → "Me", 2 → "+1", … (the count is total people including the owner). */
export function partyCountLabel(n: number): string {
  return n <= 1 ? "Me" : `+${n - 1}`;
}

interface PartyCountFieldProps {
  label: string;
  value: number;
  setValue: (value: number) => void;
  /** Lowest selectable count — "No More Than" passes the current minimum. */
  min?: number;
}

export default function PartyCountField({ label, value, setValue, min = PARTY_MIN }: PartyCountFieldProps) {
  const options: number[] = [];
  for (let n = Math.max(PARTY_MIN, min); n <= PARTY_MAX; n++) options.push(n);
  return (
    <label className="flex items-center justify-between gap-3 h-12 cursor-pointer">
      <span className="text-base font-normal">{label}</span>
      <span className="relative inline-flex">
        <span className="text-base font-normal text-gray-500 dark:text-gray-500 text-right whitespace-nowrap">
          {partyCountLabel(value)}
        </span>
        <select
          value={value}
          onChange={(e) => setValue(Number(e.target.value))}
          className="absolute inset-0 opacity-0 cursor-pointer"
          aria-label={label}
        >
          {options.map((n) => (
            <option key={n} value={n}>
              {partyCountLabel(n)}
            </option>
          ))}
        </select>
      </span>
    </label>
  );
}
