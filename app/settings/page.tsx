"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { getUserName, saveUserName, clearUserName, getUserLocation, saveUserLocation, clearUserLocation, type UserLocation } from "@/lib/userProfile";
import {
  apiGeocode,
  apiGetMyUserProfile,
  apiUploadMyUserImage,
  apiDeleteMyUserImage,
  buildUserImageUrl,
  cacheMyUserProfile,
  getCachedMyUserProfile,
  clearCachedMyUserProfile,
} from "@/lib/api";
import { usePageReady } from "@/lib/usePageReady";
import CompactNameField from "@/components/CompactNameField";
import InitialBubble from "@/components/InitialBubble";
import ImageCropModal from "@/components/ImageCropModal";
import ConfirmationModal from "@/components/ConfirmationModal";
import { getStoredTheme, saveTheme, type ThemePreference } from "@/lib/theme";

const THEME_OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string; icon: React.ReactNode }> = [
  {
    value: "light",
    label: "Light",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="4" />
        <path strokeLinecap="round" d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </svg>
    ),
  },
  {
    value: "dark",
    label: "Dark",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1111.21 3a7 7 0 009.79 9.79z" />
      </svg>
    ),
  },
  {
    value: "system",
    label: "System",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path strokeLinecap="round" d="M8 20h8M12 16v4" />
      </svg>
    ),
  },
];

export default function SettingsPage() {
  const router = useRouter();
  usePageReady(true);
  const [name, setName] = useState("");
  const [locationInput, setLocationInput] = useState("");
  const [savedLocation, setSavedLocation] = useState<UserLocation | null>(null);
  const [theme, setTheme] = useState<ThemePreference>("system");
  const [isLoading, setIsLoading] = useState(false);
  const [isGeolocating, setIsGeolocating] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  // Profile-image state mirrors the staging pattern from /edit-title:
  // pendingCroppedBlob (new upload pending Save) vs pendingImageRemoval
  // (clear pending Save). The current server image is read into
  // `serverImageUrl` once on mount via apiGetMyUserProfile.
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [pendingCroppedBlob, setPendingCroppedBlob] = useState<Blob | null>(null);
  const [pendingImageRemoval, setPendingImageRemoval] = useState(false);
  const [localImagePreviewUrl, setLocalImagePreviewUrl] = useState<string | null>(null);
  const [serverImageUrl, setServerImageUrl] = useState<string | null>(() => {
    // Synchronous seed from the localStorage cache so first paint
    // already shows the image (no flash from initials → image).
    if (typeof window === 'undefined') return null;
    const cached = getCachedMyUserProfile();
    return buildUserImageUrl(cached?.browser_id ?? null, cached?.image_updated_at ?? null);
  });
  const [imageSaving, setImageSaving] = useState(false);
  const [showDiscardImageConfirm, setShowDiscardImageConfirm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const savedName = getUserName();
    if (savedName) {
      setName(savedName);
    }
    const loc = getUserLocation();
    if (loc) {
      setSavedLocation(loc);
    }
    setTheme(getStoredTheme());

    // Sync the cached profile with the server. Updates `serverImageUrl`
    // if the server's timestamp is newer than the local cache (e.g.
    // image was set from another device with the same browser_id —
    // shouldn't happen since browser_id is per-browser, but the round
    // trip also serves as the first-time-on-this-device sync.)
    apiGetMyUserProfile()
      .then((profile) => {
        cacheMyUserProfile(profile);
        setServerImageUrl(buildUserImageUrl(profile.browser_id, profile.image_updated_at));
      })
      .catch(() => {
        // Network blip — the cached value is still authoritative.
      });
  }, []);

  // Object-URL lifecycle for the cropped preview blob.
  useEffect(() => {
    if (!pendingCroppedBlob) {
      setLocalImagePreviewUrl(null);
      return;
    }
    const u = URL.createObjectURL(pendingCroppedBlob);
    setLocalImagePreviewUrl(u);
    return () => {
      URL.revokeObjectURL(u);
    };
  }, [pendingCroppedBlob]);

  const effectiveImageUrl = pendingCroppedBlob
    ? localImagePreviewUrl
    : pendingImageRemoval
      ? null
      : serverImageUrl;

  const hasPendingImageChange = pendingCroppedBlob !== null || pendingImageRemoval;

  const selectedTheme = THEME_OPTIONS.find((o) => o.value === theme);

  const handleThemeChange = (next: ThemePreference) => {
    setTheme(next);
    saveTheme(next);
  };

  const openFilePicker = () => {
    if (imageSaving) return;
    fileInputRef.current?.click();
  };

  const onFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPickedFile(file);
  };

  const onCropConfirm = (croppedBlob: Blob) => {
    setPendingCroppedBlob(croppedBlob);
    setPendingImageRemoval(false);
    setPickedFile(null);
  };

  const onRemoveImage = () => {
    if (imageSaving) return;
    // If a new crop is staged but not saved, just drop it. Otherwise
    // stage a removal of the existing server image.
    if (pendingCroppedBlob) {
      setPendingCroppedBlob(null);
      return;
    }
    if (serverImageUrl) {
      setPendingImageRemoval(true);
    }
  };

  // Apply whichever image change is pending. Caller owns the loading
  // flag + user-visible status message; this just runs the network
  // calls + state writes. Returns when there's nothing to do.
  const commitPendingImageChange = async (): Promise<void> => {
    if (pendingCroppedBlob) {
      const profile = await apiUploadMyUserImage(pendingCroppedBlob);
      setServerImageUrl(buildUserImageUrl(profile.browser_id, profile.image_updated_at));
      setPendingCroppedBlob(null);
    } else if (pendingImageRemoval) {
      await apiDeleteMyUserImage();
      setServerImageUrl(null);
      setPendingImageRemoval(false);
    }
  };

  const saveImageChange = async () => {
    if (imageSaving || !hasPendingImageChange) return;
    setImageSaving(true);
    setMessage(null);
    try {
      await commitPendingImageChange();
      setMessage({ type: 'success', text: 'Photo updated!' });
    } catch {
      setMessage({ type: 'error', text: 'Failed to update photo' });
    } finally {
      setImageSaving(false);
    }
  };

  const discardImageChange = () => {
    setShowDiscardImageConfirm(false);
    setPendingCroppedBlob(null);
    setPendingImageRemoval(false);
  };

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

      if (hasPendingImageChange) {
        await commitPendingImageChange();
      }

      setMessage({ type: 'success', text: 'Settings saved!' });
      setTimeout(() => {
        router.back();
      }, 1000);
    } catch {
      setMessage({ type: 'error', text: 'Failed to save settings' });
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

  const handleClearAll = async () => {
    if (!confirm('Are you sure you want to clear your settings?')) return;
    clearUserName();
    clearUserLocation();
    setName("");
    setSavedLocation(null);
    setLocationInput("");
    // Also clear any uploaded profile image — "clear my settings" is
    // an everything-on-this-browser wipe, so the image goes too. Server
    // delete is fire-and-forget; the local cache is cleared either way
    // so the FE state is consistent immediately.
    try {
      await apiDeleteMyUserImage();
    } catch {
      // ignore — server may be unreachable, the cache clear below still
      // owns the FE state
    }
    clearCachedMyUserProfile();
    setServerImageUrl(null);
    setPendingCroppedBlob(null);
    setPendingImageRemoval(false);
    setMessage({ type: 'success', text: 'Settings cleared!' });
    setTimeout(() => {
      router.push('/');
    }, 1000);
  };

  return (
    <div className="question-content">
      {/* Profile photo section — sits at the top of the page since the
          avatar reads as the "you" identity for everything else below.
          Tap the avatar (or the camera badge) to open the file picker;
          the X badge stages a removal of an existing image. */}
      <div className="mb-6 flex flex-col items-center">
        <div className="relative">
          <button
            type="button"
            onClick={openFilePicker}
            disabled={imageSaving}
            aria-label="Change profile photo"
            className="block outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-full disabled:opacity-60"
          >
            <InitialBubble
              imageUrl={effectiveImageUrl}
              name={name}
              sizeClassName="w-28 h-28"
              textSizeClassName="text-2xl"
            />
            <span
              className="absolute bottom-0 right-0 w-9 h-9 rounded-full bg-blue-600 dark:bg-blue-500 text-white flex items-center justify-center shadow-md ring-2 ring-white dark:ring-gray-900"
              aria-hidden
            >
              <CameraPencilIcon />
            </span>
          </button>
          {effectiveImageUrl && !imageSaving && (
            <button
              type="button"
              onClick={onRemoveImage}
              aria-label="Remove profile photo"
              className="absolute top-0 right-0 w-7 h-7 rounded-full bg-gray-500 dark:bg-gray-600 text-white flex items-center justify-center shadow-md ring-2 ring-white dark:ring-gray-900 hover:bg-gray-600 dark:hover:bg-gray-500 active:scale-95 transition-transform"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={onFileChosen}
          className="hidden"
        />
        {hasPendingImageChange && (
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={saveImageChange}
              disabled={imageSaving}
              className="px-3 py-1.5 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium disabled:opacity-50"
            >
              {imageSaving ? 'Saving…' : pendingImageRemoval ? 'Save (remove photo)' : 'Save photo'}
            </button>
            <button
              type="button"
              onClick={() => setShowDiscardImageConfirm(true)}
              disabled={imageSaving}
              className="px-3 py-1.5 rounded-full border border-gray-300 dark:border-gray-600 text-sm font-medium disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        )}
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 text-center">
          Shown wherever your name appears
        </p>
      </div>

      {/* Name Input Section */}
      <div className="mb-6">
        <section className="rounded-3xl bg-gray-50 dark:bg-gray-800 px-4">
          <CompactNameField name={name} setName={setName} disabled={isLoading} />
        </section>
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          This name will be automatically filled in voting forms
        </p>
      </div>

      {/* Location Section */}
      <div className="mb-6">
        <label htmlFor="location" className="block text-sm font-medium mb-1">
          Reference Location
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
            onBlur={(e) => setLocationInput(e.target.value.trim())}
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
          Used as the reference point for calculating distance in location-based questions
        </p>
      </div>

      <div className="mb-6">
        <section className="rounded-3xl bg-gray-50 dark:bg-gray-800 px-4">
          <label className="flex items-center justify-between gap-3 h-12 cursor-pointer">
            <span className="text-base font-normal shrink-0">Theme</span>
            <span className="relative inline-flex items-center gap-1.5 text-base font-normal text-gray-600 dark:text-gray-400">
              {selectedTheme?.icon}
              {selectedTheme?.label}
              <svg
                aria-hidden="true"
                className="w-4 h-4 shrink-0"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M10 3a.75.75 0 01.55.24l3.25 3.5a.75.75 0 11-1.1 1.02L10 4.852 7.3 7.76a.75.75 0 01-1.1-1.02l3.25-3.5A.75.75 0 0110 3zm-3.76 9.2a.75.75 0 011.06.04L10 15.148l2.7-2.908a.75.75 0 111.1 1.02l-3.25 3.5a.75.75 0 01-1.1 0l-3.25-3.5a.75.75 0 01.04-1.06z"
                  clipRule="evenodd"
                />
              </svg>
              <select
                value={theme}
                onChange={(e) => handleThemeChange(e.target.value as ThemePreference)}
                className="absolute inset-0 opacity-0 cursor-pointer"
                aria-label="Theme"
              >
                {THEME_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </span>
          </label>
        </section>
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          System follows your device&apos;s appearance setting
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
        disabled={isLoading || (!name.trim() && !locationInput.trim() && !hasPendingImageChange)}
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
          Clear Settings
        </button>
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 text-center">
          Remove your saved name, location, and profile photo from this browser
        </p>
      </div>

      {/* About Section */}
      <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3 text-center">
          About
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 text-center mb-4">
          WhoeverWants is an open-source questioning application
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

      {pickedFile && (
        <ImageCropModal
          file={pickedFile}
          onCancel={() => setPickedFile(null)}
          onConfirm={onCropConfirm}
        />
      )}

      <ConfirmationModal
        isOpen={showDiscardImageConfirm}
        message="Discard photo changes?"
        confirmText="Discard"
        confirmButtonClass="bg-red-600 hover:bg-red-700 text-white"
        onConfirm={discardImageChange}
        onCancel={() => setShowDiscardImageConfirm(false)}
      />
    </div>
  );
}

function CameraPencilIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7h3l2-3h6l2 3h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}
