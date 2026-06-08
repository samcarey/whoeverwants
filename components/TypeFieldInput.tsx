"use client";

import { useState, useRef, useEffect } from "react";

export interface BuiltInType {
  value: string;
  label: string;
  icon: string;
  // Curated alias terms used ONLY to widen the new-poll search box's category
  // matching beyond the literal label — e.g. typing "Movie" surfaces "Showtime"
  // because `showtime` lists "movie" here. These are a SEMANTIC layer, not the
  // displayed label; keep each list tight (terms a user might genuinely type
  // for this category) to avoid false positives. Adding a related-term is a
  // one-line edit here — no matching logic changes. See `categoryMatchesQuery`.
  keywords?: string[];
}

export const BUILT_IN_TYPES: BuiltInType[] = [
  { value: "yes_no", label: "Yes / No", icon: "👍", keywords: ["yes", "no", "vote", "decide", "approve", "poll"] },
  { value: "time", label: "Time", icon: "📅", keywords: ["when", "schedule", "date", "day", "availability", "available", "calendar", "meeting", "meet"] },
  { value: "restaurant", label: "Restaurant", icon: "🍽️", keywords: ["dinner", "lunch", "food", "eat", "dining", "brunch", "cuisine", "meal", "takeout"] },
  { value: "location", label: "Place", icon: "📍", keywords: ["location", "where", "spot", "venue", "destination", "address", "bar", "park", "trip"] },
  { value: "movie", label: "Movie", icon: "🎬", keywords: ["film", "cinema", "showtime", "watch", "flick", "screening"] },
  { value: "video_game", label: "Video Game", icon: "🎮", keywords: ["game", "gaming", "videogame", "play", "console", "esports"] },
  { value: "limited_supply", label: "Limited Supply", icon: "🎟️", keywords: ["ticket", "tickets", "spot", "spots", "slot", "claim", "rsvp", "signup", "seat"] },
  { value: "showtime", label: "Showtime", icon: "🎬", keywords: ["movie", "film", "cinema", "theater", "theatre", "showtimes", "screening", "tickets"] },
];

// Lowercase word tokens a search query is matched against for a category: the
// `label` words alone, and the `search` words (label PLUS curated alias
// keywords). Split on whitespace, commas, and slashes so "Yes / No" and "Video
// Game" yield clean tokens. Computed once per category object (the BUILT_IN_TYPES
// entries are static singletons) and cached — the picker re-derives these on
// every keystroke, but the underlying data never changes.
const CATEGORY_WORDS = new WeakMap<BuiltInType, { label: string[]; search: string[] }>();
function categoryWords(type: BuiltInType): { label: string[]; search: string[] } {
  let words = CATEGORY_WORDS.get(type);
  if (!words) {
    const split = (s: string) => s.toLowerCase().split(/[\s,/]+/).filter(Boolean);
    words = {
      label: split(type.label),
      search: split(`${type.label} ${(type.keywords ?? []).join(" ")}`),
    };
    CATEGORY_WORDS.set(type, words);
  }
  return words;
}

function matchTokens(words: string[], tokens: string[]): boolean {
  if (!tokens.length) return true;
  return tokens.every((t) => words.some((w) => w.startsWith(t)));
}

/**
 * Does this category match the typed search tokens, considering label + alias
 * keywords? Every token must prefix-match some word (matches the new-poll
 * search box's existing token semantics). Empty token list matches everything.
 */
export function categoryMatchesQuery(type: BuiltInType | undefined, tokens: string[]): boolean {
  if (!type) return false;
  return matchTokens(categoryWords(type).search, tokens);
}

/**
 * Does this category's LABEL alone match (ignoring alias keywords)? Used to rank
 * exact-label hits ahead of alias-only hits, so typing "Movie" still puts the
 * Movie row nearest the bar with Showtime (an alias match) just above it.
 */
export function categoryLabelMatchesQuery(type: BuiltInType | undefined, tokens: string[]): boolean {
  if (!type) return false;
  return matchTokens(categoryWords(type).label, tokens);
}

/** Placeholder examples for the "For" field, keyed by category value. */
export const FOR_FIELD_PLACEHOLDERS: Record<string, string> = {
  restaurant: "Dinner, Lunch, etc.",
  location: "Vacation, Day trip, etc.",
  movie: "Movie night, Date night, etc.",
  video_game: "Game night, Tournament, etc.",
  time: "Meeting, Party, etc.",
};

export function getBuiltInType(value: string): BuiltInType | undefined {
  return BUILT_IN_TYPES.find((t) => t.value === value);
}

/** Categories that use location-based search (proximity, reference location, radius). */
export function isLocationLikeCategory(category: string): boolean {
  return category === 'location' || category === 'restaurant';
}

/** Categories that use autocomplete search (any built-in type except yes_no and time). */
export function isAutocompleteCategory(category: string): boolean {
  // showtime's movie picker is catalog-sourced (apiShowtimesNearby), not the
  // per-option Nominatim autocomplete — gate it out.
  return category !== 'yes_no' && category !== 'time' && category !== 'limited_supply' && category !== 'showtime' && BUILT_IN_TYPES.some((t) => t.value === category);
}

interface TypeFieldInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** When true, renders the input borderless with right-aligned text — for
   *  use inside row-style settings lists where the field is the right column
   *  of a `<label>     <value>` layout. The icon (if any) sits next to the
   *  text on the right instead of being absolute-positioned on the left. */
  borderless?: boolean;
}

export default function TypeFieldInput({ value, onChange, disabled = false, borderless = false }: TypeFieldInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [editText, setEditText] = useState<string | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const builtIn = getBuiltInType(value);
  // When editing, show local edit text; otherwise show the committed value
  const inputText = editText !== null ? editText : (builtIn ? builtIn.label : (value === "custom" ? "" : value));

  const filterText = editText !== null ? editText : "";
  const filteredTypes = filterText
    ? BUILT_IN_TYPES.filter((t) =>
        t.label.toLowerCase().includes(filterText.toLowerCase())
      )
    : BUILT_IN_TYPES;

  function closeDropdown() {
    setIsOpen(false);
    setHighlightedIndex(-1);
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        closeDropdown();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (highlightedIndex >= 0 && listRef.current) {
      const items = listRef.current.children;
      if (items[highlightedIndex]) {
        (items[highlightedIndex] as HTMLElement).scrollIntoView({ block: "nearest" });
      }
    }
  }, [highlightedIndex]);

  function handleFocus() {
    setIsOpen(true);
    setHighlightedIndex(-1);
    setEditText("");
  }

  function commitAndClose() {
    if (editText !== null) {
      const trimmed = editText.trim();
      const match = BUILT_IN_TYPES.find(
        (t) => t.label.toLowerCase() === trimmed.toLowerCase()
      );
      if (match) {
        onChange(match.value);
      } else if (trimmed) {
        onChange(trimmed);
      } else {
        onChange("custom");
      }
      setEditText(null);
    }
    closeDropdown();
  }

  function handleBlur(e: React.FocusEvent) {
    if (containerRef.current && !containerRef.current.contains(e.relatedTarget as Node)) {
      commitAndClose();
    }
  }

  function handleInputChange(text: string) {
    setEditText(text);
    setHighlightedIndex(-1);
    if (!isOpen) setIsOpen(true);
  }

  function selectType(type: BuiltInType) {
    onChange(type.value);
    setEditText(null);
    closeDropdown();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!isOpen) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        setIsOpen(true);
        e.preventDefault();
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        prev < filteredTypes.length - 1 ? prev + 1 : prev
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlightedIndex >= 0 && highlightedIndex < filteredTypes.length) {
        selectType(filteredTypes[highlightedIndex]);
      } else {
        commitAndClose();
        inputRef.current?.blur();
      }
    } else if (e.key === "Escape") {
      setEditText(null);
      closeDropdown();
      inputRef.current?.blur();
    }
  }

  const isCustomValue = value !== "" && value !== "custom" && !builtIn;

  // Borderless variant: input has no border/bg/ring, text right-aligned;
  // the built-in icon is rendered as an inline span to the left of the
  // input (in the same flex row) so it visually hugs the text from the
  // left while the whole pair sits at the right edge of its container.
  if (borderless) {
    // Display mode: when value is a built-in AND not currently typing/
    // dropdown-open, render `<icon> <label>` as plain inline text inside
    // a button — keeps the icon and label visually flush together (a
    // text-right <input> with a proportional font leaves empty space on
    // the left which detaches the leading icon). Tapping the button
    // focuses the input, which opens the dropdown. A non-built-in or
    // empty value falls through to the input directly so the user can
    // type immediately.
    const inDisplayMode = !!builtIn && !isOpen && editText === null;
    return (
      <div ref={containerRef} className="relative">
        <div className="flex items-center justify-end gap-1.5">
          {inDisplayMode ? (
            <button
              type="button"
              onClick={() => inputRef.current?.focus()}
              disabled={disabled}
              className="inline-flex items-center gap-1.5 text-base text-gray-500 dark:text-gray-500 disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Change category"
            >
              <span className="text-base leading-none" aria-hidden>{builtIn!.icon}</span>
              <span>{builtIn!.label}</span>
            </button>
          ) : null}
          <input
            ref={inputRef}
            type="text"
            value={inputText}
            onChange={(e) => handleInputChange(e.target.value)}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            tabIndex={inDisplayMode ? -1 : 0}
            aria-hidden={inDisplayMode || undefined}
            className={
              inDisplayMode
                ? "sr-only"
                : "flex-1 min-w-0 bg-transparent text-base text-gray-500 dark:text-gray-500 text-right focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
            }
          />
          {value !== "custom" && !isOpen && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange("custom");
                inputRef.current?.focus();
              }}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-sm shrink-0"
              aria-label="Clear category"
            >
              ✕
            </button>
          )}
        </div>
        {isOpen && filteredTypes.length > 0 && (
          <div
            ref={listRef}
            className="absolute z-50 right-0 mt-1 min-w-[14rem] bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md shadow-lg max-h-48 overflow-y-auto"
          >
            {filteredTypes.map((type, index) => (
              <button
                key={type.value}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectType(type);
                }}
                onMouseEnter={() => setHighlightedIndex(index)}
                className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 ${
                  highlightedIndex === index
                    ? "bg-blue-50 dark:bg-blue-900/30"
                    : "hover:bg-gray-50 dark:hover:bg-gray-700/50"
                } ${
                  value === type.value
                    ? "text-gray-500 dark:text-gray-500 font-medium"
                    : "text-gray-900 dark:text-white"
                }`}
              >
                <span className="text-base">{type.icon}</span>
                <span>{type.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        {builtIn && !isOpen && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-base pointer-events-none">
            {builtIn.icon}
          </span>
        )}
        <input
          ref={inputRef}
          type="text"
          value={inputText}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          className={`w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed ${
            builtIn && !isOpen ? "pl-9" : ""
          } ${
            !isOpen && isCustomValue ? "pr-24" : !isOpen && value !== "custom" ? "pr-8" : ""
          }`}
        />
        {isCustomValue && !isOpen && (
          <span className="absolute right-8 top-1/2 -translate-y-1/2 text-[10px] font-medium bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 rounded-full">
            Custom
          </span>
        )}
        {value !== "custom" && !isOpen && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onChange("custom");
              inputRef.current?.focus();
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-sm"
          >
            ✕
          </button>
        )}
      </div>

      {isOpen && filteredTypes.length > 0 && (
        <div
          ref={listRef}
          className="absolute z-50 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md shadow-lg max-h-48 overflow-y-auto"
        >
          {filteredTypes.map((type, index) => (
            <button
              key={type.value}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                selectType(type);
              }}
              onMouseEnter={() => setHighlightedIndex(index)}
              className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 ${
                highlightedIndex === index
                  ? "bg-blue-50 dark:bg-blue-900/30"
                  : "hover:bg-gray-50 dark:hover:bg-gray-700/50"
              } ${
                value === type.value
                  ? "text-gray-500 dark:text-gray-500 font-medium"
                  : "text-gray-900 dark:text-white"
              }`}
            >
              <span className="text-base">{type.icon}</span>
              <span>{type.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
