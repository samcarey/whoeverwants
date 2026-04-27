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
  placeholder?: string;
  category?: QuestionCategory;
  optionsMetadata?: OptionsMetadata;
  onMetadataChange?: (metadata: OptionsMetadata) => void;
  referenceLatitude?: number;
  referenceLongitude?: number;
  searchRadius?: number;
}

export default function OptionsInput({
  options,
  setOptions,
  isLoading = false,
  label,
  placeholder,
  category = 'custom',
  optionsMetadata,
  onMetadataChange,
  referenceLatitude,
  referenceLongitude,
  searchRadius,
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

  const getPlaceholder = (index: number) => {
    if (placeholder) return placeholder;

    const filledOptions = options.filter(opt => opt.trim() !== '');
    const isLastField = index === options.length - 1;

    if (category === 'location') {
      if (isLastField) {
        return filledOptions.length === 0 ? "Search for a location..." : "Add another location...";
      }
      return `Location ${index + 1}`;
    } else if (category === 'movie') {
      if (isLastField) {
        return filledOptions.length === 0 ? "Search for a movie..." : "Add another movie...";
      }
      return `Movie ${index + 1}`;
    } else if (category === 'video_game') {
      if (isLastField) {
        return filledOptions.length === 0 ? "Search for a video game..." : "Add another video game...";
      }
      return `Video game ${index + 1}`;
    } else if (category === 'restaurant') {
      if (isLastField) {
        return filledOptions.length === 0 ? "Search for a restaurant..." : "Add another restaurant...";
      }
      return `Restaurant ${index + 1}`;
    } else {
      if (isLastField) {
        return filledOptions.length === 0 ? "Add an option" : "Add another option...";
      }
      return `Option ${index + 1}`;
    }
  };

  const useAutocomplete = isAutocompleteCategory(category);
  const needsReferenceLocation =
    isLocationLikeCategory(category) &&
    (referenceLatitude === undefined || referenceLongitude === undefined);
  const inputClassName = (isDuplicate: boolean) =>
    `flex-1 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed ${
      isDuplicate
        ? 'bg-red-50 dark:bg-red-900/30 border-red-400 dark:border-red-600 text-red-900 dark:text-red-100'
        : 'border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white'
    }`;

  return (
    <div>
      {label && (
        <label className="block text-sm font-medium mb-1">
          {label}
        </label>
      )}
      {needsReferenceLocation && (
        <p className="mb-2 text-sm text-orange-600 dark:text-orange-400">
          Choose a reference location above to enable search.
        </p>
      )}
      <div className="space-y-2">
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
            <div key={index} className="flex items-start gap-2">
              {useAutocomplete ? (
                <div className="flex-1">
                  <AutocompleteInput
                    value={option}
                    onChange={(value) => updateOption(index, value)}
                    onSelect={handleSelect}
                    category={category as Exclude<QuestionCategory, 'custom'>}
                    disabled={isLoading}
                    maxLength={100}
                    placeholder={getPlaceholder(index)}
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
                  placeholder={getPlaceholder(index)}
                />
              )}
              {isLastField ? (
                // Empty space for alignment on the last field
                <div className="w-9 h-9"></div>
              ) : (
                <button
                  type="button"
                  onClick={() => canDelete ? removeOption(index) : undefined}
                  disabled={isLoading || !canDelete}
                  className={`p-2 transition-colors ${
                    canDelete
                      ? 'text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300'
                      : 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                  aria-label={canDelete ? "Remove option" : "Cannot remove last option"}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
