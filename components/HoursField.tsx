"use client";

/**
 * "Minimum Hours" / "Maximum Hours" duration picker on a slot activity. One-
 * row field (h-12, the bottom-card settings idiom): label left, the selected
 * value right, with an invisible native <select> overlaid — the
 * PartyCountField / ScoringAlgorithmField pattern.
 *
 * The caller keeps the pair ordered instantly (raising the minimum pushes the
 * maximum up, lowering the maximum pulls the minimum down); the Max field
 * additionally passes `min` so shorter options aren't even offered.
 */

export const HOURS_OPTIONS = [0.5, 1, 1.5, 2, 3, 4, 5, 6, 8] as const;

export function hoursLabel(h: number): string {
  return `${h}h`;
}

interface HoursFieldProps {
  label: string;
  value: number;
  setValue: (value: number) => void;
  /** Shortest selectable duration — "Maximum Hours" passes the current minimum. */
  min?: number;
}

export default function HoursField({ label, value, setValue, min = 0 }: HoursFieldProps) {
  const options = HOURS_OPTIONS.filter((h) => h >= min);
  return (
    <label className="flex items-center justify-between gap-3 h-12 cursor-pointer">
      <span className="text-base font-normal">{label}</span>
      <span className="relative inline-flex">
        <span className="text-base font-normal text-gray-500 dark:text-gray-500 text-right whitespace-nowrap">
          {hoursLabel(value)}
        </span>
        <select
          value={value}
          onChange={(e) => setValue(Number(e.target.value))}
          className="absolute inset-0 opacity-0 cursor-pointer"
          aria-label={label}
        >
          {options.map((h) => (
            <option key={h} value={h}>
              {hoursLabel(h)}
            </option>
          ))}
        </select>
      </span>
    </label>
  );
}
