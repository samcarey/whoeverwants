"use client";

import { useRef } from "react";

interface OptionsInputProps {
  options: string[];
  setOptions: (options: string[]) => void;
  isLoading?: boolean;
  pollType?: 'poll' | 'nomination';
  label?: React.ReactNode;
  placeholder?: string;
}

export default function OptionsInput({ 
  options, 
  setOptions, 
  isLoading = false,
  pollType = 'poll',
  label,
  placeholder
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

  const removeOption = (index: number) => {
    const newOptions = options.filter((_, i) => i !== index);
    
    // Ensure we always have at least 1 field
    if (newOptions.length === 0) {
      newOptions.push('');
    }
    
    setOptions(newOptions);
  };

  const getPlaceholder = (index: number) => {
    if (placeholder) return placeholder;
    
    const filledOptions = options.filter(opt => opt.trim() !== '');
    const isLastField = index === options.length - 1;
    
    if (pollType === 'nomination') {
      if (isLastField) {
        return filledOptions.length === 0 ? "Add a nomination" : "Add another nomination...";
      }
      return `Nomination ${index + 1}`;
    } else {
      if (isLastField) {
        return filledOptions.length === 0 ? "Add an option" : "Add another option...";
      }
      return `Option ${index + 1}`;
    }
  };

  return (
    <div>
      {label && (
        <label className="block text-sm font-medium mb-2">
          {label}
        </label>
      )}
      <div className="space-y-2">
        {options.map((option, index) => {
          const isDuplicate = isDuplicateOption(index);
          const filledOptions = options.filter(opt => opt.trim() !== '');
          const isLastField = index === options.length - 1;
          const canDelete = filledOptions.length >= 1;
          
          return (
            <div key={index} className="flex items-center gap-2">
              <input
                ref={(el) => {
                  optionRefs.current[index] = el;
                }}
                type="text"
                value={option}
                onChange={(e) => updateOption(index, e.target.value)}
                disabled={isLoading}
                maxLength={35}
                className={`flex-1 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed ${
                  isDuplicate 
                    ? 'bg-red-50 dark:bg-red-900/30 border-red-400 dark:border-red-600 text-red-900 dark:text-red-100' 
                    : 'border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white'
                }`}
                placeholder={getPlaceholder(index)}
              />
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
        {isDuplicateOption(options.findIndex(opt => isDuplicateOption(options.indexOf(opt)))) && (
          <p className="text-sm text-red-600 dark:text-red-400 mt-1">
            Duplicate options are not allowed.
          </p>
        )}
      </div>
    </div>
  );
}