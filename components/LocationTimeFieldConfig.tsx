"use client";

import { useState } from "react";
import OptionsInput from "@/components/OptionsInput";

type FieldMode = 'none' | 'set' | 'preferences' | 'suggestions';

interface DeadlineOption {
  value: string;
  label: string;
  minutes: number;
}

interface LocationTimeFieldConfigProps {
  label: string;
  mode: FieldMode;
  onModeChange: (mode: FieldMode) => void;
  value: string;
  onValueChange: (value: string) => void;
  options: string[];
  onOptionsChange: (options: string[]) => void;
  suggestionsDeadline: string;
  onSuggestionsDeadlineChange: (deadline: string) => void;
  preferencesDeadline: string;
  onPreferencesDeadlineChange: (deadline: string) => void;
  deadlineOptions: DeadlineOption[];
  isLoading: boolean;
}

export default function LocationTimeFieldConfig({
  label,
  mode,
  onModeChange,
  value,
  onValueChange,
  options,
  onOptionsChange,
  suggestionsDeadline,
  onSuggestionsDeadlineChange,
  preferencesDeadline,
  onPreferencesDeadlineChange,
  deadlineOptions,
  isLoading,
}: LocationTimeFieldConfigProps) {
  const [showOptionsModal, setShowOptionsModal] = useState(false);
  const validOptionCount = options.filter(o => o.trim()).length;
  const selectClass = "w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed text-sm";
  const filteredDeadlineOptions = deadlineOptions.filter(o => o.value !== 'custom');

  const renderDeadlineSelect = (dlLabel: string, dlValue: string, onChange: (v: string) => void) => (
    <div>
      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{dlLabel}</label>
      <select value={dlValue} onChange={(e) => onChange(e.target.value)} disabled={isLoading} className={selectClass}>
        {filteredDeadlineOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );

  return (
    <>
      <div>
        <label className="block text-sm font-medium mb-1">
          {label}{' '}
          <span className="text-gray-500 font-normal">(optional)</span>
        </label>
        <select
          value={mode}
          onChange={(e) => onModeChange(e.target.value as FieldMode)}
          disabled={isLoading}
          className={selectClass}
        >
          <option value="none">None</option>
          <option value="suggestions">Ask for Suggestions</option>
          <option value="preferences">
            Ask for Preferences{validOptionCount >= 2 ? ` (${validOptionCount})` : ''}
          </option>
          <option value="set">Set</option>
        </select>

        {mode === 'set' && (
          <input
            type="text"
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            disabled={isLoading}
            placeholder={`Enter ${label.toLowerCase()}...`}
            className="w-full mt-2 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed text-sm"
          />
        )}

        {mode === 'preferences' && (
          <div className="mt-2 space-y-2">
            <button
              type="button"
              onClick={() => setShowOptionsModal(true)}
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
            >
              Edit options ({validOptionCount})
            </button>
            {renderDeadlineSelect("Preferences deadline", preferencesDeadline, onPreferencesDeadlineChange)}
          </div>
        )}

        {mode === 'suggestions' && (
          <div className="mt-2 space-y-2">
            {renderDeadlineSelect("Suggestions phase deadline", suggestionsDeadline, onSuggestionsDeadlineChange)}
            {renderDeadlineSelect("Preferences phase deadline", preferencesDeadline, onPreferencesDeadlineChange)}
          </div>
        )}
      </div>

      {showOptionsModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowOptionsModal(false)}>
          <div className="bg-white dark:bg-gray-900 rounded-lg p-4 w-full max-w-md max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-medium mb-3">{label} Options</h3>
            <OptionsInput
              options={options}
              setOptions={onOptionsChange}
              isLoading={isLoading}
              placeholder={`Add a ${label.toLowerCase()} option...`}
            />
            <button type="button" onClick={() => setShowOptionsModal(false)} className="mt-3 w-full py-2 bg-gray-100 dark:bg-gray-800 rounded-md text-sm hover:bg-gray-200 dark:hover:bg-gray-700">
              Done
            </button>
          </div>
        </div>
      )}
    </>
  );
}
