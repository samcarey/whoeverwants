"use client";

import { useRef, useState } from "react";
import { enterAdvancesFocus } from "@/lib/formNavigation";

interface PlusOnesInputProps {
  /** One entry per represented person; "" = an unnamed plus-one. */
  names: string[];
  setNames: (names: string[]) => void;
  /** Contact display names for the lookup dropdown (same source as adding
   *  people to a group). Empty when none / not loaded — the field still works
   *  as freeform text. */
  candidates?: string[];
  disabled?: boolean;
}

const MAX_PLUS_ONES = 50;

/**
 * The "Plus one/more" name list shown when voting on a poll that allows it.
 *
 * Reuses the suggestions/options field-card row visual (one input per row +
 * a red remove button) but with two deliberate differences from `OptionsInput`:
 *  - Adding a person is an explicit "+ Add a person" button, NOT type-to-grow,
 *    so a blank row is a valid *unnamed* plus-one (the name is optional).
 *  - The autocomplete is backed by the caller's contacts (passed in), filtered
 *    client-side — the same "look up a person who might be a user" mechanism as
 *    the invite-members screen, rather than the location/restaurant search the
 *    options field uses.
 */
export default function PlusOnesInput({
  names,
  setNames,
  candidates = [],
  disabled = false,
}: PlusOnesInputProps) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  // Which row's dropdown is open (-1 = none). Tracked per-row so only the
  // focused field shows suggestions.
  const [openRow, setOpenRow] = useState<number>(-1);

  const updateName = (index: number, value: string) => {
    const next = [...names];
    next[index] = value;
    setNames(next);
  };

  const removeRow = (index: number) => {
    setNames(names.filter((_, i) => i !== index));
    setOpenRow(-1);
  };

  const addRow = () => {
    if (names.length >= MAX_PLUS_ONES) return;
    setNames([...names, ""]);
    // Focus the new field on the next paint.
    const newIndex = names.length;
    requestAnimationFrame(() => inputRefs.current[newIndex]?.focus());
  };

  const suggestionsFor = (value: string): string[] => {
    const q = value.trim().toLowerCase();
    const seen = new Set<string>();
    const out: string[] = [];
    for (const c of candidates) {
      const name = (c ?? "").trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      if (q && !key.includes(q)) continue;
      // Don't suggest the exact value already typed.
      if (key === q) continue;
      seen.add(key);
      out.push(name);
      if (out.length >= 6) break;
    }
    return out;
  };

  return (
    <div>
      <div className="space-y-2">
        {names.map((name, index) => {
          const suggestions = openRow === index ? suggestionsFor(name) : [];
          return (
            <div key={index} className="flex items-start gap-2">
              <div className="flex-1 relative">
                <input
                  ref={(el) => {
                    inputRefs.current[index] = el;
                  }}
                  type="text"
                  value={name}
                  placeholder="Name (optional)"
                  onChange={(e) => updateName(index, e.target.value)}
                  onFocus={() => setOpenRow(index)}
                  onBlur={(e) => {
                    const trimmed = e.target.value.trim();
                    if (trimmed !== name) updateName(index, trimmed);
                    // Defer so an option's onMouseDown can fire first.
                    setTimeout(() => setOpenRow((r) => (r === index ? -1 : r)), 120);
                  }}
                  onKeyDown={enterAdvancesFocus}
                  autoCapitalize="words"
                  maxLength={50}
                  disabled={disabled}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                />
                {suggestions.length > 0 && (
                  <ul className="absolute z-20 left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg">
                    {suggestions.map((s) => (
                      <li key={s}>
                        <button
                          type="button"
                          // onMouseDown (not onClick) so it fires before the
                          // input's onBlur closes the dropdown.
                          onMouseDown={(e) => {
                            e.preventDefault();
                            updateName(index, s);
                            setOpenRow(-1);
                          }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
                        >
                          {s}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <button
                type="button"
                onClick={() => removeRow(index)}
                disabled={disabled}
                className="p-2 transition-colors text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="Remove person"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={addRow}
        disabled={disabled || names.length >= MAX_PLUS_ONES}
        className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50 disabled:cursor-not-allowed disabled:no-underline"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        Add a person
      </button>
    </div>
  );
}
