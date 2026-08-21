"use client";

/**
 * The who-with candidate field on a slot activity's entry card: the groups /
 * people already picked as removable pills, with a search box underneath to
 * add more.
 *
 * Focusing the box opens a suggestion list ABOVE it, filtered by what's typed.
 * Rows are rendered least-relevant-first so the most relevant sits at the
 * bottom, nearest the box (the same "best match nearest the bar" convention
 * the new-poll search box uses) — the caller supplies `options` already in
 * that order. Selection-only: typing filters, it never creates a new name.
 */

import { useEffect, useMemo, useRef, useState } from "react";

export interface Candidate {
  /** Matches the wire field the name belongs to on a who-with entry. */
  kind: "groups" | "people";
  name: string;
}

export const candidateKey = (c: Candidate) => `${c.kind}:${c.name.trim().toLowerCase()}`;

/** Same "people" glyph as GroupsIcon, at pill/row size in currentColor —
 *  the only thing distinguishing a group from a person here. */
function GroupGlyph({ className = "w-4 h-4 shrink-0" }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
      />
    </svg>
  );
}

interface CandidatePickerProps {
  /** Already picked, rendered as pills (each with an ✕). */
  selected: Candidate[];
  /** Everything pickable, ordered LEAST relevant first (most relevant last). */
  options: Candidate[];
  onAdd: (c: Candidate) => void;
  onRemove: (c: Candidate) => void;
}

export default function CandidatePicker({ selected, options, onAdd, onRemove }: CandidatePickerProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const selectedKeys = useMemo(() => new Set(selected.map(candidateKey)), [selected]);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return options.filter(
      (c) => !selectedKeys.has(candidateKey(c)) && (!q || c.name.toLowerCase().includes(q)),
    );
  }, [options, selectedKeys, query]);

  // The list is bottom-anchored in spirit: when it overflows its max height,
  // keep the most-relevant end (the bottom, nearest the box) in view.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [open, matches.length]);

  // The list opens ABOVE the box (pushing it down) and the sheet around us
  // shrinks to the visual viewport as the keyboard animates in — both move the
  // box, and the keyboard's resize lands well after focus. Re-assert on every
  // visual-viewport resize while open (NOT `scroll`, which also fires while
  // the user pans and would fight them).
  useEffect(() => {
    if (!open) return;
    const reveal = () => inputRef.current?.scrollIntoView({ block: "center" });
    const raf = requestAnimationFrame(reveal);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", reveal);
    return () => {
      cancelAnimationFrame(raf);
      vv?.removeEventListener("resize", reveal);
    };
  }, [open]);

  const pick = (c: Candidate) => {
    onAdd(c);
    setQuery("");
    // Keep the box focused so several can be added in a row.
    inputRef.current?.focus();
  };

  return (
    <div>
      {selected.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {selected.map((c) => (
            <span
              key={candidateKey(c)}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-blue-500 bg-blue-100 py-1.5 pl-3 pr-1.5 text-sm text-blue-700 dark:border-blue-500 dark:bg-blue-900/40 dark:text-blue-300"
            >
              {c.kind === "groups" && <GroupGlyph />}
              <span className="truncate">{c.name}</span>
              <button
                type="button"
                onClick={() => onRemove(c)}
                aria-label={`Remove ${c.name}`}
                className="shrink-0 rounded-full p-0.5 text-blue-500 hover:bg-blue-200/70 dark:text-blue-300 dark:hover:bg-blue-800/60"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}

      {open && matches.length > 0 && (
        <div
          ref={listRef}
          className="mb-2 max-h-52 overflow-y-auto overscroll-contain rounded-2xl border border-gray-200 dark:border-gray-700"
        >
          {matches.map((c) => (
            <button
              key={candidateKey(c)}
              type="button"
              // Commit before the input blurs (blur would close the list first).
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(c)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              {c.kind === "groups" && <GroupGlyph />}
              <span className="truncate">{c.name}</span>
            </button>
          ))}
        </div>
      )}

      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          setQuery("");
        }}
        onKeyDown={(e) => {
          // Enter takes the most-relevant match — the row nearest the box.
          if (e.key === "Enter" && matches.length > 0) {
            e.preventDefault();
            pick(matches[matches.length - 1]);
          }
        }}
        placeholder={selected.length > 0 ? "Add another" : "Anyone — add a group or person"}
        aria-label="Add a group or person"
        className="w-full rounded-full border border-gray-300 bg-white px-3 py-1.5 text-sm outline-none placeholder:text-gray-400 focus:border-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:placeholder:text-gray-500"
      />
    </div>
  );
}
