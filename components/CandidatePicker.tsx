"use client";

/**
 * The who-with candidate field on a slot activity's entry card: the groups /
 * people already picked as removable pills, with a box to add more.
 *
 * Tapping the box opens a FULL-SCREEN picker with the field pinned to the TOP
 * of the screen and the suggestions flowing DOWN from it — so the soft
 * keyboard (and its accessory bar) can only ever cover the tail of the list,
 * never the thing you're typing into. That's why this doesn't try to measure
 * the keyboard: an earlier visual-viewport-sized version put the box behind
 * the accessory bar on a real device.
 *
 * Rows are ordered most-relevant FIRST here (nearest the box, which is above
 * them) — the caller supplies `options` least-relevant-first, and the overlay
 * reverses. Selection-only: typing filters, it never creates a new name.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import ModalPortal from "@/components/ModalPortal";
import { useKeyboardPrimer } from "@/lib/useKeyboardPrimer";

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

const BOX_CLASS =
  "w-full rounded-full border border-gray-300 bg-white px-3 py-1.5 text-left text-sm dark:border-gray-600 dark:bg-gray-900";

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

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const openOverlay = () => {
    // Synchronous, inside the tap: claims the keyboard for the input that
    // mounts a commit later (see useKeyboardPrimer).
    prime();
    setQuery("");
    setOpen(true);
  };
  const closeOverlay = () => {
    cancel();
    setQuery("");
    setOpen(false);
  };
  const pick = (c: Candidate) => {
    onAdd(c);
    setQuery("");
    inputRef.current?.focus();
  };

  const pill = (c: Candidate) => (
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
  );

  const placeholder = selected.length > 0 ? "Add another" : "Anyone — add a group or person";

  return (
    <div>
      {selected.length > 0 && <div className="mb-2 flex flex-wrap gap-2">{selected.map(pill)}</div>}
      {/* A button, not an input: the real one lives in the overlay (the
          documented trigger + primer pattern). */}
      <button type="button" onClick={openOverlay} className={`${BOX_CLASS} text-gray-400 dark:text-gray-500`}>
        {placeholder}
      </button>

      {open && (
        <ModalPortal>
          <div
            className="fixed inset-0 z-[85] flex flex-col bg-background"
            style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
            role="dialog"
            aria-modal="true"
            aria-label="Add a group or person"
          >
            {/* The field, pinned to the top of the screen: picked pills and
                the caret share one wrapping row. */}
            <div className="shrink-0 flex items-start gap-2 border-b border-gray-200 px-3 py-2 dark:border-gray-700">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                {selected.map(pill)}
                <input
                  ref={(node) => {
                    inputRef.current = node;
                    focusOnMount(node);
                  }}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter takes the top row — the most relevant match.
                    if (e.key === "Enter" && rows.length > 0) {
                      e.preventDefault();
                      pick(rows[0]);
                    }
                  }}
                  placeholder={placeholder}
                  aria-label="Add a group or person"
                  // text-base (16px) — anything smaller triggers iOS focus-zoom.
                  className="min-w-[8rem] flex-1 bg-transparent py-1 text-base outline-none placeholder:text-gray-400 dark:placeholder:text-gray-500"
                />
              </div>
              <button
                type="button"
                onClick={closeOverlay}
                className="shrink-0 rounded-full px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/30"
              >
                Done
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {rows.length === 0 ? (
                <p className="px-4 py-3 text-sm text-gray-400 dark:text-gray-500">
                  {options.length === 0
                    ? "No groups or contacts to pick from yet."
                    : "No matches."}
                </p>
              ) : (
                rows.map((c) => (
                  <button
                    key={candidateKey(c)}
                    type="button"
                    // Commit before the input blurs.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(c)}
                    className="flex w-full items-center gap-2 border-b border-gray-100 px-4 py-3 text-left text-base text-gray-700 hover:bg-gray-100 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-800"
                  >
                    {c.kind === "groups" && <GroupGlyph className="w-5 h-5 shrink-0" />}
                    <span className="truncate">{c.name}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
}
