"use client";

import { useRef, useState } from "react";
import { enterAdvancesFocus } from "@/lib/formNavigation";
import type { PlusOneCandidate } from "@/lib/api";

export interface PlusOneEntry {
  /** Display name. "" = an unnamed plus-one. */
  name: string;
  /** Set when the entry was picked from the contact lookup (a real account).
   *  Those get their own editable vote; freeform entries are weighted. */
  userId?: string;
}

interface PlusOnesInputProps {
  entries: PlusOneEntry[];
  setEntries: (entries: PlusOneEntry[]) => void;
  /** Contacts for the lookup dropdown. `responded` ones are greyed + unselectable. */
  candidates?: PlusOneCandidate[];
  disabled?: boolean;
}

const MAX_PLUS_ONES = 50;

/**
 * The "Plus one/more" name list shown when voting on a poll that allows it.
 *
 * Reuses the suggestions/options field-card row visual (one input per row +
 * a red remove button) with an explicit "+ Add a person" button (so a blank
 * row is a valid *unnamed* plus-one). The autocomplete is backed by the
 * caller's contacts (same "look up a person who might be a user" mechanism as
 * the invite-members screen). Picking a contact attaches their `userId`, which
 * gives them their OWN editable vote later; typing freeform keeps it weighted.
 * Contacts who already responded to the poll are shown greyed with
 * "(responded)" and can't be selected.
 */
export default function PlusOnesInput({
  entries,
  setEntries,
  candidates = [],
  disabled = false,
}: PlusOnesInputProps) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [openRow, setOpenRow] = useState<number>(-1);

  const update = (index: number, next: PlusOneEntry) => {
    const copy = [...entries];
    copy[index] = next;
    setEntries(copy);
  };

  const removeRow = (index: number) => {
    setEntries(entries.filter((_, i) => i !== index));
    setOpenRow(-1);
  };

  const addRow = () => {
    if (entries.length >= MAX_PLUS_ONES) return;
    setEntries([...entries, { name: "" }]);
    const newIndex = entries.length;
    requestAnimationFrame(() => inputRefs.current[newIndex]?.focus());
  };

  const suggestionsFor = (index: number, value: string): PlusOneCandidate[] => {
    const q = value.trim().toLowerCase();
    // Hide accounts already chosen in another row so you can't add them twice.
    const chosen = new Set(
      entries
        .filter((e, i) => i !== index && e.userId)
        .map((e) => e.userId as string),
    );
    const out: PlusOneCandidate[] = [];
    for (const c of candidates) {
      const name = (c.name ?? "").trim();
      if (!name || chosen.has(c.user_id)) continue;
      if (q && !name.toLowerCase().includes(q)) continue;
      out.push(c);
      if (out.length >= 6) break;
    }
    return out;
  };

  return (
    <div>
      <div className="space-y-2">
        {entries.map((entry, index) => {
          const suggestions = openRow === index ? suggestionsFor(index, entry.name) : [];
          return (
            <div key={index} className="flex items-start gap-2">
              <div className="flex-1 relative">
                <input
                  ref={(el) => {
                    inputRefs.current[index] = el;
                  }}
                  type="text"
                  value={entry.name}
                  placeholder="Name (optional)"
                  onChange={(e) =>
                    // Typing detaches any previously-selected account.
                    update(index, { name: e.target.value })
                  }
                  onFocus={() => setOpenRow(index)}
                  onBlur={(e) => {
                    const trimmed = e.target.value.trim();
                    if (trimmed !== entry.name) update(index, { ...entry, name: trimmed });
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
                    {suggestions.map((c) => (
                      <li key={c.user_id}>
                        <button
                          type="button"
                          disabled={c.responded}
                          // onMouseDown (not onClick) so it fires before the
                          // input's onBlur closes the dropdown.
                          onMouseDown={(e) => {
                            e.preventDefault();
                            if (c.responded) return;
                            update(index, { name: c.name ?? "", userId: c.user_id });
                            setOpenRow(-1);
                          }}
                          className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between ${
                            c.responded
                              ? "text-gray-400 dark:text-gray-500 cursor-not-allowed"
                              : "hover:bg-gray-100 dark:hover:bg-gray-700"
                          }`}
                        >
                          <span>{c.name}</span>
                          {c.responded && (
                            <span className="text-xs italic">(responded)</span>
                          )}
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
        disabled={disabled || entries.length >= MAX_PLUS_ONES}
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
