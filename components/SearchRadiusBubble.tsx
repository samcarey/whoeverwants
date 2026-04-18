"use client";

import { useState, useEffect, useRef } from "react";

interface SearchRadiusBubbleProps {
  searchRadius: number;
  onSearchRadiusChange: (radius: number) => void;
}

export default function SearchRadiusBubble({
  searchRadius,
  onSearchRadiusChange,
}: SearchRadiusBubbleProps) {
  const [showRadiusModal, setShowRadiusModal] = useState(false);
  const [radiusInput, setRadiusInput] = useState(String(searchRadius));
  const radiusInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showRadiusModal) {
      setRadiusInput(String(searchRadius));
      setTimeout(() => radiusInputRef.current?.select(), 0);
    }
  }, [showRadiusModal, searchRadius]);

  const applyRadius = () => {
    const val = parseInt(radiusInput, 10);
    if (val > 0) onSearchRadiusChange(val);
    setShowRadiusModal(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setShowRadiusModal(true)}
        className="shrink-0 px-2 py-0.5 text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded-full hover:bg-blue-200 dark:hover:bg-blue-900/60 transition-colors"
      >
        within {searchRadius} mi
      </button>
      {showRadiusModal && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50"
          onClick={() => setShowRadiusModal(false)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-4 w-56"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-medium mb-3 text-gray-900 dark:text-white">Search Radius</h3>
            <div className="flex items-center gap-2">
              <input
                ref={radiusInputRef}
                type="number"
                min="1"
                max="10000"
                value={radiusInput}
                onChange={(e) => setRadiusInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") applyRadius();
                }}
                className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white text-sm"
              />
              <span className="text-sm text-gray-500 dark:text-gray-400">mi</span>
            </div>
            <button
              type="button"
              onClick={applyRadius}
              className="mt-3 w-full py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm font-medium"
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </>
  );
}
