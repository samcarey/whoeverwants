"use client";

import { useState, useRef, useEffect } from "react";

export interface BuiltInType {
  value: string;
  label: string;
  icon: string;
}

// Only types with actual search/autocomplete backends
const BUILT_IN_TYPES: BuiltInType[] = [
  { value: "location", label: "Location", icon: "📍" },
  { value: "movie", label: "Movie", icon: "🎬" },
  { value: "video_game", label: "Video Game", icon: "🎮" },
];

export function getBuiltInType(value: string): BuiltInType | undefined {
  return BUILT_IN_TYPES.find((t) => t.value === value);
}

export function isBuiltInType(value: string): boolean {
  return BUILT_IN_TYPES.some((t) => t.value === value);
}

interface TypeFieldInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export default function TypeFieldInput({ value, onChange, disabled = false }: TypeFieldInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Derive display text from current value
  const builtIn = getBuiltInType(value);
  const displayText = builtIn ? builtIn.label : (value === "custom" ? "" : value);

  // Filter types based on search text
  const filteredTypes = searchText
    ? BUILT_IN_TYPES.filter((t) =>
        t.label.toLowerCase().includes(searchText.toLowerCase())
      )
    : BUILT_IN_TYPES;

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearchText("");
        setHighlightedIndex(-1);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Scroll highlighted item into view
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
    setSearchText("");
    setHighlightedIndex(-1);
  }

  function handleInputChange(text: string) {
    setSearchText(text);
    setHighlightedIndex(-1);
    if (!isOpen) setIsOpen(true);
  }

  function selectType(type: BuiltInType) {
    onChange(type.value);
    setSearchText("");
    setIsOpen(false);
    setHighlightedIndex(-1);
    inputRef.current?.blur();
  }

  function handleBlurCommit() {
    // Called when dropdown closes — commit typed text as custom type
    const trimmed = searchText.trim();
    if (trimmed) {
      // Check if it matches a built-in type label
      const match = BUILT_IN_TYPES.find(
        (t) => t.label.toLowerCase() === trimmed.toLowerCase()
      );
      if (match) {
        onChange(match.value);
      } else {
        onChange(trimmed);
      }
    }
    setSearchText("");
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
        // Commit the search text as-is
        handleBlurCommit();
        setIsOpen(false);
        inputRef.current?.blur();
      }
    } else if (e.key === "Escape") {
      setIsOpen(false);
      setSearchText("");
      setHighlightedIndex(-1);
      inputRef.current?.blur();
    }
  }

  // When dropdown closes (not via selection), commit any typed text
  const prevIsOpen = useRef(isOpen);
  useEffect(() => {
    if (prevIsOpen.current && !isOpen) {
      handleBlurCommit();
    }
    prevIsOpen.current = isOpen;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const isCustomValue = value && value !== "custom" && !builtIn;

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        {/* Icon prefix for built-in types */}
        {builtIn && !isOpen && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-base pointer-events-none">
            {builtIn.icon}
          </span>
        )}
        <input
          ref={inputRef}
          type="text"
          value={isOpen ? searchText : displayText}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={isOpen ? "Search or type custom..." : "Select a type (optional)"}
          className={`w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed text-sm ${
            builtIn && !isOpen ? "pl-9" : ""
          }`}
        />
        {/* Custom badge */}
        {isCustomValue && !isOpen && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-medium bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 rounded-full">
            Custom
          </span>
        )}
        {/* Clear button when a value is set and not open */}
        {value !== "custom" && !isOpen && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onChange("custom");
              setSearchText("");
              inputRef.current?.focus();
            }}
            className={`absolute top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-sm ${
              isCustomValue ? "right-[4.5rem]" : "right-3"
            }`}
          >
            ✕
          </button>
        )}
      </div>

      {/* Dropdown list */}
      {isOpen && (
        <div
          ref={listRef}
          className="absolute z-50 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md shadow-lg max-h-48 overflow-y-auto"
        >
          {filteredTypes.length > 0 ? (
            filteredTypes.map((type, index) => (
              <button
                key={type.value}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault(); // Prevent blur before click registers
                  selectType(type);
                }}
                onMouseEnter={() => setHighlightedIndex(index)}
                className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 ${
                  highlightedIndex === index
                    ? "bg-blue-50 dark:bg-blue-900/30"
                    : "hover:bg-gray-50 dark:hover:bg-gray-700/50"
                } ${
                  value === type.value
                    ? "text-blue-600 dark:text-blue-400 font-medium"
                    : "text-gray-900 dark:text-white"
                }`}
              >
                <span className="text-base">{type.icon}</span>
                <span>{type.label}</span>
              </button>
            ))
          ) : (
            <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
              No matches — press Enter to use &ldquo;{searchText}&rdquo;
            </div>
          )}
        </div>
      )}
    </div>
  );
}
