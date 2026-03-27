"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { apiSearchLocations, apiSearchMovies, apiSearchVideoGames, type SearchResult } from "@/lib/api";
import type { PollContentType } from "@/lib/types";

interface AutocompleteInputProps {
  value: string;
  onChange: (value: string) => void;
  onSelect?: (result: SearchResult) => void;
  contentType: Exclude<PollContentType, 'custom'>;
  disabled?: boolean;
  placeholder?: string;
  maxLength?: number;
  className?: string;
  inputRef?: React.RefCallback<HTMLInputElement>;
  referenceLatitude?: number;
  referenceLongitude?: number;
  searchRadius?: number;
}

export default function AutocompleteInput({
  value,
  onChange,
  onSelect,
  contentType,
  disabled = false,
  placeholder,
  maxLength = 35,
  className,
  inputRef,
  referenceLatitude,
  referenceLongitude,
  searchRadius,
}: AutocompleteInputProps) {
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const localInputRef = useRef<HTMLInputElement>(null);

  const lastSuccessfulQueryRef = useRef("");

  const doSearch = useCallback(async (query: string) => {
    if (query.length < 2) {
      setSuggestions([]);
      lastSuccessfulQueryRef.current = "";
      return;
    }
    try {
      let results: SearchResult[];
      if (contentType === 'location') {
        results = await apiSearchLocations(query, referenceLatitude, referenceLongitude, searchRadius);
      } else if (contentType === 'video_game') {
        results = await apiSearchVideoGames(query);
      } else {
        results = await apiSearchMovies(query);
      }
      // If no results and query extends the previous successful query,
      // keep showing old results (typing more should refine, not lose results)
      if (results.length === 0 && lastSuccessfulQueryRef.current && query.startsWith(lastSuccessfulQueryRef.current)) {
        return;
      }
      setSuggestions(results);
      setShowSuggestions(results.length > 0);
      setHighlightedIndex(-1);
      if (results.length > 0) {
        lastSuccessfulQueryRef.current = query;
      }
    } catch {
      // On error, keep existing suggestions
    }
  }, [contentType, referenceLatitude, referenceLongitude, searchRadius]);

  const handleChange = (newValue: string) => {
    onChange(newValue);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(newValue), 300);
  };

  const selectSuggestion = (result: SearchResult) => {
    onChange(result.label);
    onSelect?.(result);
    setSuggestions([]);
    setShowSuggestions(false);
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

  return (
    <div ref={containerRef} className="relative">
      <input
        ref={(el) => {
          localInputRef.current = el;
          if (inputRef) inputRef(el);
        }}
        type="text"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        maxLength={maxLength}
        className={className}
        placeholder={placeholder}
      />
      {showSuggestions && suggestions.length > 0 && (
        <ul className="absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg max-h-60 overflow-y-auto">
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
                  className="w-8 h-12 object-cover rounded flex-shrink-0 mt-0.5"
                />
              )}
              <div className="min-w-0 flex-1">
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
                      {result.distance_miles < 0.1 ? '<0.1' : result.distance_miles} mi
                    </span>
                  )}
                </div>
              </div>
            </li>
          ))}
          <li className="px-3 py-1.5 text-[10px] text-gray-400 dark:text-gray-500 border-t border-gray-100 dark:border-gray-700">
            {contentType === 'movie'
              ? 'Data from TMDB. Not endorsed by TMDB.'
              : contentType === 'video_game'
                ? 'Data from RAWG Video Games Database'
                : 'Data \u00A9 OpenStreetMap contributors'}
          </li>
        </ul>
      )}
    </div>
  );
}
