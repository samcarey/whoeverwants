"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { apiSearchLocations, apiSearchMovies, apiSearchVideoGames, apiSearchRestaurants, type SearchResult } from "@/lib/api";
import type { PollCategory } from "@/lib/types";
import { formatDistance, StarRating } from "./OptionLabel";

interface AutocompleteInputProps {
  value: string;
  onChange: (value: string) => void;
  onSelect?: (result: SearchResult) => void;
  category: Exclude<PollCategory, 'custom'>;
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
}: AutocompleteInputProps) {
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const localInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLUListElement>(null);

  const lastSuccessfulQueryRef = useRef("");
  const lastResultsRef = useRef<SearchResult[]>([]);

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
      setShowSuggestions(results.length > 0);
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
    // If the user edits a rich selection, clear its metadata
    if (isRichSelection) {
      onRichValueCleared?.();
    }
    onChange(newValue);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(newValue), 300);
  };

  const selectSuggestion = (result: SearchResult) => {
    onChange(result.label);
    onSelect?.(result);
    setSuggestions([]);
    setShowSuggestions(false);
    // Select all text so backspace or any keystroke replaces the whole value
    requestAnimationFrame(() => {
      localInputRef.current?.select();
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions || suggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex(i => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && highlightedIndex >= 0) {
      e.preventDefault();
      selectSuggestion(suggestions[highlightedIndex]);
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Stop touch events on the dropdown from bubbling to the modal's
  // drag-to-dismiss handler, so scrolling inside the dropdown works.
  useEffect(() => {
    const el = dropdownRef.current;
    if (!el) return;
    const stop = (e: TouchEvent) => e.stopPropagation();
    el.addEventListener('touchstart', stop, { passive: true });
    el.addEventListener('touchmove', stop, { passive: true });
    return () => {
      el.removeEventListener('touchstart', stop);
      el.removeEventListener('touchmove', stop);
    };
  }, [showSuggestions, suggestions.length]);

  const showIcon = isRichSelection && !!richImageUrl;

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        {showIcon && (
          <img
            src={richImageUrl}
            alt=""
            draggable={false}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded object-cover pointer-events-none z-10"
          />
        )}
        <input
          ref={(el) => {
            localInputRef.current = el;
            if (inputRef) inputRef(el);
          }}
          type="text"
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onBlur={(e) => {
            const trimmed = e.target.value.trim();
            if (trimmed !== value) onChange(trimmed);
          }}
          onFocus={() => {
            if (suggestions.length > 0) setShowSuggestions(true);
            // Select all text on focus so backspace/typing replaces the whole chip
            if (isRichSelection) localInputRef.current?.select();
          }}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          maxLength={maxLength}
          className={className}
          placeholder={placeholder}
          style={{
            ...(showIcon ? { paddingLeft: '2rem' } : {}),
            ...(isRichSelection ? { textDecoration: 'underline', textDecorationColor: 'rgba(59, 130, 246, 0.5)', textUnderlineOffset: '2px' } : {}),
          }}
        />
      </div>
      {showSuggestions && suggestions.length > 0 && (
        <ul ref={dropdownRef} className="absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {suggestions.map((result, index) => (
            <li
              key={index}
              onMouseDown={(e) => { e.preventDefault(); selectSuggestion(result); }}
              onMouseEnter={() => setHighlightedIndex(index)}
              className={`px-3 py-2 cursor-pointer flex items-start gap-2 ${
                index === highlightedIndex
                  ? 'bg-blue-50 dark:bg-blue-900/30'
                  : 'hover:bg-gray-50 dark:hover:bg-gray-700'
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
            </li>
          ))}
          <li className="px-3 py-1.5 text-[10px] text-gray-400 dark:text-gray-500 border-t border-gray-100 dark:border-gray-700">
            {category === 'restaurant'
              ? 'Data \u00A9 OpenStreetMap contributors'
              : category === 'movie'
                ? 'Data from TMDB. Not endorsed by TMDB.'
                : category === 'video_game'
                  ? 'Data from RAWG Video Games Database'
                  : 'Data \u00A9 OpenStreetMap contributors'}
          </li>
        </ul>
      )}
    </div>
  );
}
