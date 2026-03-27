"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getUserName, saveUserName, clearUserName, getUserLocation, saveUserLocation, clearUserLocation, type UserLocation } from "@/lib/userProfile";
import { apiGeocode } from "@/lib/api";

export default function ProfilePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [locationInput, setLocationInput] = useState("");
  const [savedLocation, setSavedLocation] = useState<UserLocation | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isGeolocating, setIsGeolocating] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  useEffect(() => {
    const savedName = getUserName();
    if (savedName) {
      setName(savedName);
    }
    const loc = getUserLocation();
    if (loc) {
      setSavedLocation(loc);
    }
  }, []);

  const handleSave = async () => {
    setIsLoading(true);
    setMessage(null);

    try {
      saveUserName(name);

      // Geocode location input if provided and different from saved
      if (locationInput.trim()) {
        const result = await apiGeocode(locationInput.trim());
        if (result && result.lat && result.lon) {
          const loc: UserLocation = {
            latitude: parseFloat(result.lat),
            longitude: parseFloat(result.lon),
            label: result.label,
          };
          saveUserLocation(loc);
          setSavedLocation(loc);
          setLocationInput("");
        } else {
          setMessage({ type: 'error', text: 'Could not find that location. Try a zip code or city name.' });
          setIsLoading(false);
          return;
        }
      }

      setMessage({ type: 'success', text: 'Profile saved!' });
      setTimeout(() => {
        router.back();
      }, 1000);
    } catch {
      setMessage({ type: 'error', text: 'Failed to save profile' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDetectLocation = () => {
    if (!navigator.geolocation) {
      setMessage({ type: 'error', text: 'Geolocation is not supported by your browser' });
      return;
    }

    setIsGeolocating(true);
    setMessage(null);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const { latitude, longitude } = position.coords;
          // Reverse geocode to get a label
          const result = await apiGeocode(`${latitude}, ${longitude}`);
          const label = result?.label || `${latitude.toFixed(2)}, ${longitude.toFixed(2)}`;
          const loc: UserLocation = { latitude, longitude, label };
          saveUserLocation(loc);
          setSavedLocation(loc);
          setLocationInput("");
          setMessage({ type: 'success', text: `Location set to ${label}` });
        } catch {
          setMessage({ type: 'error', text: 'Failed to determine your location' });
        } finally {
          setIsGeolocating(false);
        }
      },
      () => {
        setMessage({ type: 'error', text: 'Location access denied' });
        setIsGeolocating(false);
      },
      { enableHighAccuracy: false, timeout: 10000 }
    );
  };

  const handleClearAll = () => {
    if (confirm('Are you sure you want to clear your profile?')) {
      clearUserName();
      clearUserLocation();
      setName("");
      setSavedLocation(null);
      setLocationInput("");
      setMessage({ type: 'success', text: 'Profile cleared!' });
      setTimeout(() => {
        router.push('/');
      }, 1000);
    }
  };

  return (
    <div className="poll-content">
      {/* Name Input Section */}
      <div className="mb-6">
        <label htmlFor="name" className="block text-sm font-medium mb-2">
          Your Name
        </label>
        <input
          type="text"
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Enter your name..."
          maxLength={50}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white"
          disabled={isLoading}
        />
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          This name will be automatically filled in voting forms
        </p>
      </div>

      {/* Location Section */}
      <div className="mb-6">
        <label htmlFor="location" className="block text-sm font-medium mb-2">
          Your Location
        </label>
        {savedLocation && (
          <div className="mb-2 flex items-center gap-2">
            <span className="text-sm text-gray-600 dark:text-gray-400">Current:</span>
            <span className="text-sm font-medium">{savedLocation.label}</span>
            <button
              type="button"
              onClick={() => { clearUserLocation(); setSavedLocation(null); }}
              className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
            >
              Clear
            </button>
          </div>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            id="location"
            value={locationInput}
            onChange={(e) => setLocationInput(e.target.value)}
            placeholder={savedLocation ? "Update location..." : "Zip code or city name..."}
            maxLength={200}
            className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white"
            disabled={isLoading || isGeolocating}
          />
          <button
            type="button"
            onClick={handleDetectLocation}
            disabled={isLoading || isGeolocating}
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
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          Used to find nearby places when creating location polls
        </p>
      </div>

      {message && (
        <div className={`mb-4 p-3 rounded-md text-sm ${
          message.type === 'success'
            ? 'bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-300 border border-green-400 dark:border-green-600'
            : 'bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-400 dark:border-red-600'
        }`}>
          {message.text}
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={isLoading || (!name.trim() && !locationInput.trim())}
        className="w-full rounded-full border border-solid border-transparent transition-colors flex items-center justify-center bg-foreground text-background hover:bg-[#383838] dark:hover:bg-[#ccc] font-medium text-base h-12 disabled:opacity-50 disabled:cursor-not-allowed mb-6"
      >
        {isLoading ? 'Saving...' : 'Save'}
      </button>

      {/* Divider */}
      <div className="border-t border-gray-200 dark:border-gray-700 pt-6 mb-6">
        <button
          onClick={handleClearAll}
          className="w-full rounded-full border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors flex items-center justify-center font-medium text-base h-12"
        >
          Clear Profile
        </button>
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 text-center">
          Remove your saved name and location from this browser
        </p>
      </div>

      {/* About Section */}
      <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3 text-center">
          About
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 text-center mb-4">
          WhoeverWants is an open-source polling application
        </p>
        <a
          href="https://github.com/samcarey/whoeverwants"
          target="_blank"
          rel="noopener noreferrer"
          className="w-full rounded-full border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors flex items-center justify-center font-medium text-base h-12 gap-3"
        >
          <svg
            className="w-5 h-5"
            fill="currentColor"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              fillRule="evenodd"
              d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
              clipRule="evenodd"
            />
          </svg>
          View on GitHub
        </a>
      </div>
    </div>
  );
}