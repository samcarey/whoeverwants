"use client";

import { useState, useEffect, useRef } from "react";
import { getUserLocation, saveUserLocation, type UserLocation } from "@/lib/userProfile";
import { apiGeocode } from "@/lib/api";

interface ReferenceLocationInputProps {
  latitude: number | undefined;
  longitude: number | undefined;
  label: string;
  onLocationChange: (lat: number | undefined, lng: number | undefined, label: string) => void;
  searchRadius: number;
  onSearchRadiusChange: (radius: number) => void;
  disabled?: boolean;
}

export default function ReferenceLocationInput({
  latitude,
  longitude,
  label,
  onLocationChange,
  searchRadius,
  onSearchRadiusChange,
  disabled = false,
}: ReferenceLocationInputProps) {
  const [input, setInput] = useState("");
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [isGeolocating, setIsGeolocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRadiusModal, setShowRadiusModal] = useState(false);
  const [radiusInput, setRadiusInput] = useState(String(searchRadius));
  const radiusInputRef = useRef<HTMLInputElement>(null);

  // Auto-fill from saved location on mount
  useEffect(() => {
    if (latitude !== undefined) return; // Already set
    const saved = getUserLocation();
    if (saved) {
      onLocationChange(saved.latitude, saved.longitude, saved.label);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Focus the radius input when modal opens
  useEffect(() => {
    if (showRadiusModal) {
      setRadiusInput(String(searchRadius));
      setTimeout(() => radiusInputRef.current?.select(), 0);
    }
  }, [showRadiusModal, searchRadius]);

  const handleGeocode = async () => {
    if (!input.trim()) return;
    setIsGeocoding(true);
    setError(null);
    try {
      const result = await apiGeocode(input.trim());
      if (result && result.lat && result.lon) {
        const lat = parseFloat(result.lat);
        const lon = parseFloat(result.lon);
        onLocationChange(lat, lon, result.label);
        saveUserLocation({ latitude: lat, longitude: lon, label: result.label });
        setInput("");
      } else {
        setError("Location not found. Try a zip code or city name.");
      }
    } catch {
      setError("Failed to look up location");
    } finally {
      setIsGeocoding(false);
    }
  };

  const handleDetect = () => {
    if (!navigator.geolocation) {
      setError("Geolocation not supported");
      return;
    }
    setIsGeolocating(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const { latitude: lat, longitude: lon } = position.coords;
          const result = await apiGeocode(`${lat}, ${lon}`);
          const lbl = result?.label || `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
          onLocationChange(lat, lon, lbl);
          saveUserLocation({ latitude: lat, longitude: lon, label: lbl });
          setInput("");
        } catch {
          setError("Failed to determine location");
        } finally {
          setIsGeolocating(false);
        }
      },
      () => {
        setError("Location access denied");
        setIsGeolocating(false);
      },
      { enableHighAccuracy: false, timeout: 10000 }
    );
  };

  const applyRadius = () => {
    const val = parseInt(radiusInput, 10);
    if (val > 0) {
      onSearchRadiusChange(val);
    }
    setShowRadiusModal(false);
  };

  const hasLocation = latitude !== undefined && longitude !== undefined;

  return (
    <div>
      {hasLocation ? (
        <div className="flex items-center gap-2 text-sm min-w-0">
          <span className="font-medium shrink-0">Near:</span>
          <button
            type="button"
            onClick={() => onLocationChange(undefined, undefined, "")}
            className="text-blue-600 dark:text-blue-400 hover:underline cursor-pointer truncate min-w-0"
            title={label}
          >
            {label}
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setShowRadiusModal(true)}
            className="shrink-0 px-2 py-0.5 text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded-full hover:bg-blue-200 dark:hover:bg-blue-900/60 transition-colors"
          >
            within {searchRadius} mi
          </button>
        </div>
      ) : (
        <>
          <label className="block text-sm font-medium mb-1">
            Near
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onBlur={(e) => setInput(e.target.value.trim())}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleGeocode(); } }}
              placeholder="Zip code or city name..."
              maxLength={200}
              disabled={disabled || isGeocoding || isGeolocating}
              className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white disabled:opacity-50 text-sm"
            />
            <button
              type="button"
              onClick={handleGeocode}
              disabled={disabled || isGeocoding || isGeolocating || !input.trim()}
              className="px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
            >
              {isGeocoding ? "..." : "Set"}
            </button>
            <button
              type="button"
              onClick={handleDetect}
              disabled={disabled || isGeocoding || isGeolocating}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Detect my location"
            >
              {isGeolocating ? (
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              )}
            </button>
          </div>
        </>
      )}
      {showRadiusModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowRadiusModal(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-4 w-56" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-medium mb-3 text-gray-900 dark:text-white">Search Radius</h3>
            <div className="flex items-center gap-2">
              <input
                ref={radiusInputRef}
                type="number"
                min="1"
                max="10000"
                value={radiusInput}
                onChange={(e) => setRadiusInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') applyRadius(); }}
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
      {error && (
        <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
