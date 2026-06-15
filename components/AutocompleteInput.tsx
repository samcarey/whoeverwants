"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { apiSearchLocations, apiSearchMovies, apiSearchVideoGames, apiSearchRestaurants, type SearchResult } from "@/lib/api";
import type { QuestionCategory, OptionMetadataEntry } from "@/lib/types";
import { formatDistance, StarRating } from "./OptionLabel";
import { advanceFormFocus } from "@/lib/formNavigation";
import KeyboardSuggestionPicker from "./KeyboardSuggestionPicker";
import { useKeyboardPrimer } from "@/lib/useKeyboardPrimer";
import { useBodyScrollLock } from "@/lib/useBodyScrollLock";

/** A previously-referenced option surfaced above live search results. */
export interface PriorCategoryOption {
  label: string;
  metadata?: OptionMetadataEntry;
}

const EARTH_RADIUS_MILES = 3958.8;

/** Great-circle distance in miles between two lat/lon points. */
function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_MILES * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Convert a previously-referenced option into a SearchResult so it renders
 *  identically to a fresh search hit. The stored `distance_miles` is dropped
 *  (it was relative to whatever reference existed when first referenced); the
 *  caller recomputes it from the preserved lat/lon against the CURRENT
 *  reference. */
function priorToSearchResult(p: PriorCategoryOption): SearchResult {
  const m = p.metadata ?? {};
  return {
    label: p.label,
    name: m.name,
    address: m.address,
    imageUrl: m.imageUrl,
    infoUrl: m.infoUrl,
    lat: m.lat,
    lon: m.lon,
    rating: m.rating,
    reviewCount: m.reviewCount,
    cuisine: m.cuisine,
    priceLevel: m.priceLevel,
  };
}

interface AutocompleteInputProps {
  value: string;
  onChange: (value: string) => void;
  onSelect?: (result: SearchResult) => void;
  category: Exclude<QuestionCategory, 'custom'>;
  disabled?: boolean;
  placeholder?: string;
  maxLength?: number;
  className?: string;
  inputRef?: React.RefCallback<HTMLInputElement>;
  referenceLatitude?: number;
  referenceLongitude?: number;
  searchRadius?: number;
  /** When the current value has associated metadata from a search selection */
  richImageUrl?: string;
  /** Whether the current value was selected from autocomplete (has metadata) */
  isRichSelection?: boolean;
  /** Called when the user edits/clears a rich selection, so parent can clean up metadata */
  onRichValueCleared?: () => void;
  /** When true, skip API search calls and render a plain inline input (no overlay). */
  searchDisabled?: boolean;
  /** Options previously referenced for this category (group-recency first,
   *  then general), shown above live search results until the typed text
   *  filters them out. Surfaced even when `searchDisabled` (they don't need
   *  live search). */
  priorOptions?: PriorCategoryOption[];
}

const attributionFor = (category: string) =>
  category === 'movie'
    ? 'Data from TMDB. Not endorsed by TMDB.'
    : category === 'video_game'
      ? 'Data from RAWG Video Games Database'
      : 'Data © OpenStreetMap contributors';

/** The rich inner content of one search-result row (name / rating / distance /
 *  cuisine, or label / description). Shared by the overlay rows. */
function ResultRowContent({ result }: { result: SearchResult }) {
  return (
    <div className="min-w-0 flex-1 pointer-events-none select-none">
      {result.name ? (
        <>
          <div className="flex items-baseline gap-1.5">
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
              {result.name}
            </span>
            {result.rating !== undefined && (
              <span className="text-xs flex-shrink-0">
                <StarRating rating={result.rating} />
              </span>
            )}
            {result.distance_miles !== undefined && (
              <span className="text-xs text-blue-600 dark:text-blue-400 whitespace-nowrap flex-shrink-0">
                {formatDistance(result.distance_miles)}
              </span>
            )}
          </div>
          {result.cuisine ? (
            <div className="flex items-baseline gap-1.5">
              <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
                {result.cuisine}
              </span>
              {result.priceLevel && (
                <span className="text-xs text-green-600 dark:text-green-400 whitespace-nowrap flex-shrink-0">
                  {result.priceLevel}
                </span>
              )}
            </div>
          ) : (
            <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
              {result.label.startsWith(result.name + ', ') ? result.label.slice(result.name.length + 2) : result.label}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
            {result.label}
          </div>
          <div className="flex items-center gap-2">
            {result.description && (
              <span className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2">
                {result.description}
              </span>
            )}
            {result.distance_miles !== undefined && (
              <span className="text-xs text-blue-600 dark:text-blue-400 whitespace-nowrap">
                {formatDistance(result.distance_miles)}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default function AutocompleteInput({
  value,
  onChange,
  onSelect,
  category,
  disabled = false,
  placeholder,
  maxLength = 35,
  className,
  inputRef,
  referenceLatitude,
  referenceLongitude,
  searchRadius,
  richImageUrl,
  isRichSelection = false,
  onRichValueCleared,
  searchDisabled = false,
  priorOptions,
}: AutocompleteInputProps) {
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  const lastSuccessfulQueryRef = useRef("");
  const lastResultsRef = useRef<SearchResult[]>([]);

  // Prior options as SearchResults, with distance recomputed from the CURRENT
  // reference point (the stored distance was relative to a different one;
  // coordinates are preserved so the recompute is honest).
  const priorResults = useMemo(
    () =>
      (priorOptions ?? []).map((p) => {
        const r = priorToSearchResult(p);
        const lat = parseFloat(p.metadata?.lat ?? '');
        const lon = parseFloat(p.metadata?.lon ?? '');
        if (
          referenceLatitude !== undefined &&
          referenceLongitude !== undefined &&
          Number.isFinite(lat) &&
          Number.isFinite(lon)
        ) {
          r.distance_miles = haversineMiles(referenceLatitude, referenceLongitude, lat, lon);
        }
        return r;
      }),
    [priorOptions, referenceLatitude, referenceLongitude],
  );

  const { prime, focusOnMount, cancel: cancelPrimer } = useKeyboardPrimer({ selectOnFocus: true });

  // Lock background scroll while the full-screen overlay is up (composes with
  // any outer modal lock — useBodyScrollLock saves/restores nested state).
  useBodyScrollLock(overlayOpen, false);

  const doSearch = useCallback(async (query: string) => {
    if (query.length < 2) {
      setSuggestions([]);
      lastSuccessfulQueryRef.current = "";
      lastResultsRef.current = [];
      return;
    }
    try {
      let results: SearchResult[];
      if (category === 'restaurant') {
        results = await apiSearchRestaurants(query, referenceLatitude, referenceLongitude, searchRadius);
      } else if (category === 'location') {
        results = await apiSearchLocations(query, referenceLatitude, referenceLongitude, searchRadius);
      } else if (category === 'video_game') {
        results = await apiSearchVideoGames(query);
      } else {
        results = await apiSearchMovies(query);
      }
      // When query extends previous, merge API results with client-side
      // filtered cache (handles partial words like "Burger K" where Nominatim
      // returns garbage but cached "Burger" results contain "Burger King")
      if (lastSuccessfulQueryRef.current && query.startsWith(lastSuccessfulQueryRef.current)) {
        const words = query.toLowerCase().split(/\s+/);
        const filtered = lastResultsRef.current.filter(r =>
          words.every(w => r.label.toLowerCase().includes(w))
        );
        const seen = new Set(results.map(r => r.label));
        for (const r of filtered) {
          if (!seen.has(r.label)) {
            results.push(r);
          }
        }
      }
      setSuggestions(results);
      setHighlightedIndex(-1);
      if (results.length > 0) {
        lastSuccessfulQueryRef.current = query;
        lastResultsRef.current = results;
      }
    } catch {
      // On error, keep existing suggestions
    }
  }, [category, referenceLatitude, referenceLongitude, searchRadius]);

  const handleChange = (newValue: string) => {
    if (isRichSelection) onRichValueCleared?.();
    onChange(newValue);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (searchDisabled) return;
    debounceRef.current = setTimeout(() => doSearch(newValue), 300);
  };

  // Open the full-screen overlay. Must run synchronously in the tap so the
  // keyboard primer claims the soft keyboard before the overlay input mounts.
  const openOverlay = useCallback(() => {
    if (disabled) return;
    // When search is disabled (no reference location) the overlay is still
    // useful IF there are prior options to show + filter; otherwise it's a
    // plain inline input (the early return below).
    if (searchDisabled && priorResults.length === 0) return;
    prime();
    setOverlayOpen(true);
    // Surface any results for the existing value immediately (e.g. re-opening
    // a field that already holds a typed query). Skipped when searchDisabled.
    if (!searchDisabled && value.trim().length >= 2) doSearch(value.trim());
  }, [disabled, searchDisabled, priorResults.length, prime, value, doSearch]);

  // Closing unmounts the overlay (and its input), which dismisses the keyboard
  // on its own — no explicit blur(), which would fire onBlur→closeOverlay again
  // and re-read a stale `value`.
  const closeOverlay = useCallback(() => {
    cancelPrimer();
    setOverlayOpen(false);
    const trimmed = value.trim();
    if (trimmed !== value) onChange(trimmed);
  }, [cancelPrimer, value, onChange]);

  // Merge prior-referenced options with live results, then reverse for the
  // bottom-anchored list (most-prominent row sits nearest the input bar).
  // Logical order (most-prominent first): prior options (recency order, text-
  // filtered) then live results (best first). Reversing puts the most-recent
  // prior option closest to the bar, live results stacked above. A live result
  // is dropped when it matches a shown prior option by label (case-insensitive,
  // every category) OR near-equal coordinates (~11m — same place, different
  // label string).
  const { displaySuggestions, naturalCount } = useMemo(() => {
    const tokens = value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const filteredPrior = priorResults.filter((r) => {
      const label = r.label.toLowerCase();
      return tokens.every((t) => label.includes(t));
    });
    const priorLabels = new Set(filteredPrior.map((r) => r.label.toLowerCase()));
    const priorCoords = filteredPrior
      .map((r) => ({ lat: parseFloat(r.lat ?? ''), lon: parseFloat(r.lon ?? '') }))
      .filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lon));
    const COORD_EPS = 1e-4; // ~11m — same place
    const naturalFiltered = suggestions.filter((r) => {
      if (priorLabels.has(r.label.toLowerCase())) return false;
      const lat = parseFloat(r.lat ?? '');
      const lon = parseFloat(r.lon ?? '');
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        if (
          priorCoords.some(
            (c) => Math.abs(c.lat - lat) < COORD_EPS && Math.abs(c.lon - lon) < COORD_EPS,
          )
        ) {
          return false;
        }
      }
      return true;
    });
    return {
      displaySuggestions: [...filteredPrior, ...naturalFiltered].reverse(),
      naturalCount: naturalFiltered.length,
    };
  }, [priorResults, value, suggestions]);

  const selectSuggestion = (result: SearchResult) => {
    onChange(result.label);
    onSelect?.(result);
    setSuggestions([]);
    cancelPrimer();
    // Don't blur here: blur() would fire onBlur→closeOverlay synchronously,
    // which trims the STALE `value` (the onChange above hasn't re-rendered yet)
    // and could clobber the label we just set. Unmounting dismisses the keyboard.
    setOverlayOpen(false);
  };

  const handleOverlayKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeOverlay();
      return;
    }
    if (displaySuggestions.length > 0) {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightedIndex(i => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightedIndex(i => Math.min(i + 1, displaySuggestions.length - 1));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (highlightedIndex >= 0) selectSuggestion(displaySuggestions[highlightedIndex]);
        else closeOverlay();
        return;
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      closeOverlay();
    }
  };

  // Cleanup debounce + primer on unmount.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // When search becomes disabled, drop any pending debounce + cached results
  // and collapse the overlay (a disabled field is a plain inline input).
  useEffect(() => {
    if (!searchDisabled) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSuggestions(prev => (prev.length === 0 ? prev : []));
    setOverlayOpen(prev => (prev ? false : prev));
    lastSuccessfulQueryRef.current = "";
    lastResultsRef.current = [];
  }, [searchDisabled]);

  const showInlineIcon = isRichSelection && !!richImageUrl;
  const richUnderline = isRichSelection ? ' underline decoration-blue-500/50 underline-offset-2' : '';

  // searchDisabled with NO prior options → plain inline input (no overlay,
  // free typing only). With prior options, fall through to the trigger+overlay
  // so the user can still see + filter them (live search stays off).
  if (searchDisabled && priorResults.length === 0) {
    return (
      <div className="relative">
        {showInlineIcon && (
          <img
            src={richImageUrl}
            alt=""
            draggable={false}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded object-cover pointer-events-none z-10"
          />
        )}
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onBlur={(e) => {
            const trimmed = e.target.value.trim();
            if (trimmed !== value) onChange(trimmed);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
              e.preventDefault();
              advanceFormFocus(e.currentTarget);
            }
          }}
          autoCapitalize="sentences"
          disabled={disabled}
          maxLength={maxLength}
          className={`${className}${showInlineIcon ? ' pl-8' : ''}${richUnderline}`}
          placeholder={placeholder}
        />
      </div>
    );
  }

  // Inline trigger: a button styled exactly like the input (text alignment +
  // size inherit from `className`, so the compact variant's `text-right` is
  // preserved). Tapping it primes the keyboard and opens the full-screen
  // overlay, where the real input lives.
  const trigger = (
    <button
      type="button"
      onClick={openOverlay}
      disabled={disabled}
      className={`${className}${showInlineIcon ? ' pl-8' : ''}${richUnderline} relative`}
      aria-label={value ? `Edit: ${value}` : (placeholder || 'Search')}
    >
      {showInlineIcon && (
        <img
          src={richImageUrl}
          alt=""
          draggable={false}
          className="absolute left-2.5 top-0 w-5 h-5 rounded object-cover pointer-events-none"
        />
      )}
      {/* Wrap (break-words) instead of truncating so long restaurant/location
          values stay fully readable and left-justified rather than clipping off
          the right edge. */}
      <span className={`block break-words ${value ? '' : 'text-gray-400 dark:text-gray-500'}`}>
        {/* NBSP keeps the button's height stable when empty (matches an empty input). */}
        {value || placeholder || ' '}
      </span>
    </button>
  );

  const overlay = overlayOpen
    ? createPortal(
        <KeyboardSuggestionPicker
          focused
          zClassName="z-[85]"
          scrollSignal={suggestions}
          rows={
            <>
              {/* Attribution credits the live-search data source; hide it when
                  only prior options are showing (no live results). */}
              {naturalCount > 0 && (
                <div className="px-3 py-1.5 text-[10px] text-gray-400 dark:text-gray-500">
                  {attributionFor(category)}
                </div>
              )}
              {displaySuggestions.map((result, index) => (
                <button
                  key={index}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => selectSuggestion(result)}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  className={`w-full flex items-start gap-2 px-3 py-2.5 text-left ${
                    index === highlightedIndex
                      ? 'bg-blue-50 dark:bg-blue-900/30'
                      : 'active:bg-gray-100 dark:active:bg-gray-800'
                  }`}
                >
                  {result.imageUrl && (
                    <img
                      src={result.imageUrl}
                      alt=""
                      draggable={false}
                      className={`object-cover rounded flex-shrink-0 mt-0.5 pointer-events-none ${
                        result.name ? 'w-5 h-5' : 'w-8 h-12'
                      }`}
                    />
                  )}
                  <ResultRowContent result={result} />
                </button>
              ))}
            </>
          }
        >
          <div className="flex items-center gap-2">
            {/* ✕ closes the overlay (commits the typed text). preventDefault on
                mousedown keeps the input focused through the tap. */}
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={closeOverlay}
              aria-label="Done"
              className="w-[42.24px] h-[42.24px] shrink-0 flex items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800 border-[0.5px] border-gray-500 dark:border-gray-400 shadow-lg active:bg-gray-200 dark:active:bg-gray-700"
            >
              <svg className="w-5 h-5 text-gray-700 dark:text-gray-200" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <div className="flex-1 min-w-0 flex items-center h-[42.24px] rounded-full bg-gray-100 dark:bg-gray-800 border-[0.5px] border-gray-500 dark:border-gray-400 px-4 shadow-lg">
              <input
                ref={(el) => { focusOnMount(el); inputRef?.(el); }}
                type="text"
                value={value}
                onChange={(e) => handleChange(e.target.value)}
                onBlur={closeOverlay}
                onKeyDown={handleOverlayKeyDown}
                autoCapitalize="sentences"
                disabled={disabled}
                maxLength={maxLength}
                placeholder={placeholder || 'Search…'}
                // `line-height: normal` keeps the iOS caret aligned with the
                // text (matching the new-poll search bar input).
                style={{ lineHeight: 'normal' }}
                className={`flex-1 min-w-0 bg-transparent outline-none text-base text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500${richUnderline}`}
              />
            </div>
          </div>
        </KeyboardSuggestionPicker>,
        document.body,
      )
    : null;

  return (
    <>
      {trigger}
      {overlay}
    </>
  );
}
