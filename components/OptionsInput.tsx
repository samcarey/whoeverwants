"use client";

import { useRef } from "react";
import type { QuestionCategory, OptionsMetadata } from "@/lib/types";
import type { SearchResult } from "@/lib/api";
import AutocompleteInput from "@/components/AutocompleteInput";
import { isAutocompleteCategory, isLocationLikeCategory } from "@/components/TypeFieldInput";

export type { OptionsMetadata };

interface OptionsInputProps {
  options: string[];
  setOptions: (options: string[]) => void;
  isLoading?: boolean;
  label?: React.ReactNode;
  category?: QuestionCategory;
  optionsMetadata?: OptionsMetadata;
  onMetadataChange?: (metadata: OptionsMetadata) => void;
  referenceLatitude?: number;
  referenceLongitude?: number;
  searchRadius?: number;
  hideReferenceLocationWarning?: boolean;
  /** When 'compact', each option input is rendered borderless with right-
   *  aligned text — for use inside row-style settings lists. */
  variant?: 'default' | 'compact';
}

export default function OptionsInput({
  options,
  setOptions,
  isLoading = false,
  label,
  category = 'custom',
  optionsMetadata,
  onMetadataChange,
  referenceLatitude,
  referenceLongitude,
  searchRadius,
  hideReferenceLocationWarning = false,
  variant = 'default',
}: OptionsInputProps) {
  const optionRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Check if an option is a duplicate
  const isDuplicateOption = (index: number): boolean => {
    const currentOption = options[index]?.trim().toLowerCase();
    if (!currentOption) return false;

    for (let i = 0; i < options.length; i++) {
      if (i !== index && options[i]?.trim().toLowerCase() === currentOption) {
        return true;
      }
    }
    return false;
  };

  const updateOption = (index: number, value: string) => {
    const newOptions = [...options];
    newOptions[index] = value;

    // If typing in the last field and it now has content, add expansion field
    if (index === options.length - 1 && value.trim() !== '') {
      newOptions.push('');
    }

    // Remove trailing empty fields but always keep at least 1 field
    while (newOptions.length > 1) {
      const lastIndex = newOptions.length - 1;
      const secondLastIndex = newOptions.length - 2;

      // Only remove if last two fields are empty
      if (newOptions[lastIndex] === '' && newOptions[secondLastIndex] === '') {
        newOptions.pop();
      } else {
        break;
      }
    }

    // Ensure we always have at least 1 field
    if (newOptions.length === 0) {
      newOptions.push('');
    }

    setOptions(newOptions);
  };

  const handleSelect = (result: SearchResult) => {
    if (!onMetadataChange) return;
    const entry: Record<string, unknown> = {};
    if (result.imageUrl) entry.imageUrl = result.imageUrl;
    if (result.infoUrl) entry.infoUrl = result.infoUrl;
    if (result.name) entry.name = result.name;
    if (result.address) entry.address = result.address;
    if (result.distance_miles !== undefined) entry.distance_miles = result.distance_miles;
    if (result.lat) entry.lat = result.lat;
    if (result.lon) entry.lon = result.lon;
    if (result.rating !== undefined) entry.rating = result.rating;
    if (result.reviewCount !== undefined) entry.reviewCount = result.reviewCount;
    if (result.cuisine) entry.cuisine = result.cuisine;
    if (result.priceLevel) entry.priceLevel = result.priceLevel;
    if (Object.keys(entry).length === 0) return;
    onMetadataChange({ ...optionsMetadata, [result.label]: entry });
  };

  const clearMetadataForOption = (optionLabel: string) => {
    if (onMetadataChange && optionsMetadata?.[optionLabel]) {
      const newMeta = { ...optionsMetadata };
      delete newMeta[optionLabel];
      onMetadataChange(newMeta);
    }
  };

  const removeOption = (index: number) => {
    const removedOption = options[index];
    if (removedOption) clearMetadataForOption(removedOption);

    const newOptions = options.filter((_, i) => i !== index);

    // Ensure we always have at least 1 field
    if (newOptions.length === 0) {
      newOptions.push('');
    }

    if (newOptions[newOptions.length - 1] !== '') {
      newOptions.push('');
    }

    setOptions(newOptions);
  };

  const useAutocomplete = isAutocompleteCategory(category);
  const needsReferenceLocation =
    isLocationLikeCategory(category) &&
    (referenceLatitude === undefined || referenceLongitude === undefined);
  const inputClassName = (isDuplicate: boolean) =>
    variant === 'compact'
      ? `flex-1 min-w-0 bg-transparent text-sm text-right focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed placeholder:text-gray-400 dark:placeholder:text-gray-500 placeholder:italic ${
          isDuplicate
            ? 'text-red-700 dark:text-red-300'
            : 'text-blue-600 dark:text-blue-400'
        }`
      : `flex-1 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed ${
          isDuplicate
            ? 'bg-red-50 dark:bg-red-900/30 border-red-400 dark:border-red-600 text-red-900 dark:text-red-100'
            : 'border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white'
        }`;

  const rowsClassName = variant === 'compact'
    ? "divide-y divide-gray-200 dark:divide-gray-700"
    : "space-y-2";
  const rowItemClassName = variant === 'compact'
    ? "flex items-center gap-2 py-3"
    : "flex items-start gap-2";

  return (
    <div>
      {label && (
        <label className="block text-sm font-medium mb-1">
          {label}
        </label>
      )}
      {needsReferenceLocation && !hideReferenceLocationWarning && (
        <p className="mb-2 text-sm text-orange-600 dark:text-orange-400">
          Choose a reference location above to enable search.
        </p>
      )}
      <div className={rowsClassName}>
        {(() => {
          const filledCount = options.filter(opt => opt.trim() !== '').length;
          const hasDuplicates = options.some((_, idx) => isDuplicateOption(idx));
          return (<>
        {options.map((option, index) => {
          const isDuplicate = isDuplicateOption(index);
          const isLastField = index === options.length - 1;
          const canDelete = filledCount >= 1;
          const optionMeta = optionsMetadata?.[option];

          return (
            <div key={index} className={rowItemClassName}>
              {useAutocomplete ? (
                <div className="flex-1">
                  <AutocompleteInput
                    value={option}
                    onChange={(value) => updateOption(index, value)}
                    onSelect={handleSelect}
                    category={category as Exclude<QuestionCategory, 'custom'>}
                    disabled={isLoading}
                    maxLength={100}
                    className={inputClassName(isDuplicate) + ' w-full'}
                    inputRef={(el) => { optionRefs.current[index] = el; }}
                    referenceLatitude={referenceLatitude}
                    referenceLongitude={referenceLongitude}
                    searchRadius={searchRadius}
                    isRichSelection={!!option && !!optionMeta}
                    richImageUrl={optionMeta?.imageUrl}
                    onRichValueCleared={() => clearMetadataForOption(option)}
                    searchDisabled={needsReferenceLocation}
                  />
                </div>
              ) : (
                <input
                  ref={(el) => {
                    optionRefs.current[index] = el;
                  }}
                  type="text"
                  value={option}
                  onChange={(e) => updateOption(index, e.target.value)}
                  onBlur={(e) => {
                    const trimmed = e.target.value.trim();
                    if (trimmed !== option) updateOption(index, trimmed);
                  }}
                  disabled={isLoading}
                  maxLength={35}
                  className={inputClassName(isDuplicate)}
                />
              )}
              {isLastField ? (
                // Empty space for alignment on the last field. Compact
                // variant uses a 5-unit (20px) placeholder so the row
                // height (py-3 + 20px = 44px) matches the other settings
                // rows; default keeps the legacy 9-unit footprint.
                <div className={variant === 'compact' ? "w-5 h-5 shrink-0" : "w-9 h-9"}></div>
              ) : (
                <button
                  type="button"
                  onClick={() => canDelete ? removeOption(index) : undefined}
                  disabled={isLoading || !canDelete}
                  className={`${variant === 'compact' ? 'shrink-0' : 'p-2'} transition-colors ${
                    canDelete
                      ? 'text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300'
                      : 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                  aria-label={canDelete ? "Remove option" : "Cannot remove last option"}
                >
                  <svg className={variant === 'compact' ? "w-5 h-5" : "w-5 h-5"} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              )}
            </div>
          );
        })}
        {hasDuplicates && (
          <p className="text-sm text-red-600 dark:text-red-400 mt-1">
            Duplicate options are not allowed.
          </p>
        )}
          </>);
        })()}
      </div>
    </div>
  );
}
