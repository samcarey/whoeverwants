"use client";

import { useState, useRef, useEffect } from "react";

export interface BuiltInType {
  value: string;
  label: string;
  icon: string;
}

const BUILT_IN_TYPES: BuiltInType[] = [
  { value: "yes_no", label: "Yes / No", icon: "👍" },
  { value: "location", label: "Location", icon: "📍" },
  { value: "restaurant", label: "Restaurant", icon: "🍽️" },
  { value: "movie", label: "Movie", icon: "🎬" },
  { value: "video_game", label: "Video Game", icon: "🎮" },
];

export function getBuiltInType(value: string): BuiltInType | undefined {
  return BUILT_IN_TYPES.find((t) => t.value === value);
}

/** Categories that use location-based search (proximity, reference location, radius). */
export function isLocationLikeCategory(category: string): boolean {
  return category === 'location' || category === 'restaurant';
}

/** Categories that use autocomplete search (any built-in type except yes_no). */
export function isAutocompleteCategory(category: string): boolean {
  return category !== 'yes_no' && BUILT_IN_TYPES.some((t) => t.value === category);
}

interface TypeFieldInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export default function TypeFieldInput({ value, onChange, disabled = false }: TypeFieldInputProps) {
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
          placeholder="Built-in or custom category"
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
                  ? "text-blue-600 dark:text-blue-400 font-medium"
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
