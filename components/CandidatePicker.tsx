"use client";

/**
 * One "who with" / "without" field inside the slot activity's settings card:
 * a standard `h-12` label/value row (the create-poll card idiom) that expands
 * on tap into a search box + suggestion list, with the picked groups/people
 * shown as removable pills below the row.
 *
 * Expanding scrolls the row to the TOP of its scroller and puts the box right
 * under it, so the suggestions — not the thing you're typing into — are what
 * the soft keyboard can cover.
 *
 * Suggestions are ordered most-relevant FIRST (nearest the box above them);
 * the caller supplies `options` least-relevant-first and this reverses.
 * Selection-only: typing filters, it never creates a new name.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useKeyboardPrimer } from "@/lib/useKeyboardPrimer";

export interface Candidate {
  /** Matches the wire field the ref belongs to on a who-with entry. */
  kind: "groups" | "people";
  /** The real group / account id, or null for a name-only reference (a legacy
   *  pick, or one whose id the server couldn't resolve). */
  id: string | null;
  name: string;
}

/** Identity first, so two same-named contacts are two candidates and a renamed
 *  group stays the same one. Name-only refs fall back to the name. */
export const candidateKey = (c: Candidate) =>
  c.id ? `${c.kind}:${c.id}` : `${c.kind}:name:${c.name.trim().toLowerCase()}`;

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
  /** Row label ("With" / "Without"). */
  label: string;
  /** Right-side value while nothing is picked ("Anyone" / "No one"). */
  emptyValue: string;
  /** Already picked, rendered as pills (each with an ✕). */
  selected: Candidate[];
  /** Everything pickable, ordered LEAST relevant first (most relevant last). */
  options: Candidate[];
  onAdd: (c: Candidate) => void;
  onRemove: (c: Candidate) => void;
}

export default function CandidatePicker({
  label,
  emptyValue,
  selected,
  options,
  onAdd,
  onRemove,
}: CandidatePickerProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { prime, focusOnMount, cancel } = useKeyboardPrimer();

  const selectedKeys = useMemo(() => new Set(selected.map(candidateKey)), [selected]);
  // Unpicked + matching the query, MOST relevant first (the caller's order,
  // reversed) so the best match sits directly under the box.
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return options
      .filter((c) => !selectedKeys.has(candidateKey(c)) && (!q || c.name.toLowerCase().includes(q)))
      .reverse();
  }, [options, selectedKeys, query]);

  // Bring the field to the top of the sheet's scroller so the list below it
  // has the most room before the keyboard starts covering things.
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() =>
      rowRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }),
    );
    return () => cancelAnimationFrame(raf);
  }, [open]);

  const expand = () => {
    // Synchronous, inside the tap: claims the keyboard for the input that
    // mounts a commit later (see useKeyboardPrimer).
    prime();
    setQuery("");
    setOpen(true);
  };
  const collapse = () => {
    cancel();
    setQuery("");
    setOpen(false);
  };
  const pick = (c: Candidate) => {
    onAdd(c);
    setQuery("");
    inputRef.current?.focus();
  };

  return (
    <div ref={rowRef} className="py-1">
      <button
        type="button"
        onClick={open ? collapse : expand}
        className="flex h-12 w-full items-center justify-between gap-3 text-left"
      >
        <span className="text-base">{label}</span>
        <span className="truncate text-base text-gray-500 dark:text-gray-500">
          {open ? "Select" : selected.length > 0 ? "" : emptyValue}
        </span>
      </button>

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

      {open && (
        <div className="mb-2">
          <input
            ref={(node) => {
              inputRef.current = node;
              focusOnMount(node);
            }}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onBlur={collapse}
            onKeyDown={(e) => {
              // Enter takes the top row — the most relevant match.
              if (e.key === "Enter" && rows.length > 0) {
                e.preventDefault();
                pick(rows[0]);
              } else if (e.key === "Escape") {
                collapse();
              }
            }}
            placeholder="Search groups and people"
            aria-label={`${label} — add a group or person`}
            // text-base (16px) — anything smaller triggers iOS focus-zoom.
            className="w-full rounded-full border border-gray-300 bg-white px-3 py-1.5 text-base outline-none placeholder:text-gray-400 dark:border-gray-600 dark:bg-gray-900 dark:placeholder:text-gray-500"
          />
          <div className="mt-2 max-h-64 overflow-y-auto overscroll-contain rounded-2xl border border-gray-200 dark:border-gray-700">
            {rows.length === 0 ? (
              <p className="px-3 py-2 text-sm text-gray-400 dark:text-gray-500">
                {options.length === 0 ? "No groups or contacts to pick from yet." : "No matches."}
              </p>
            ) : (
              rows.map((c) => (
                <button
                  key={candidateKey(c)}
                  type="button"
                  // Commit before the input blurs (blur would collapse first).
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(c)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-base text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                  {c.kind === "groups" && <GroupGlyph />}
                  <span className="truncate">{c.name}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
