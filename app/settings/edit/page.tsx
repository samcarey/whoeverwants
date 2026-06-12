"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  getUserName,
  saveUserName,
  getUserLocation,
  saveUserLocation,
  clearUserLocation,
  type UserLocation,
} from "@/lib/userProfile";
import { isValidUserName } from "@/lib/nameValidation";
import {
  apiGeocode,
  apiUploadMyUserImage,
  apiDeleteMyUserImage,
} from "@/lib/api";
import { usePageReady } from "@/lib/usePageReady";
import { navigateWithTransition } from "@/lib/viewTransitions";
import { useSwipeBackGesture } from "@/lib/useSwipeBackGesture";
import {
  SHOW_SETTINGS_BACKDROP_EVENT,
  HIDE_SETTINGS_BACKDROP_EVENT,
} from "@/lib/eventChannels";
import { detectAndSaveUserLocation, GeolocationDeniedError } from "@/lib/geolocation";
import CompactNameField from "@/components/CompactNameField";
import InitialBubble from "@/components/InitialBubble";
import ImageCropModal from "@/components/ImageCropModal";
import AccountGateModal from "@/components/AccountGateModal";
import ConfirmationModal from "@/components/ConfirmationModal";
import HeaderPortal from "@/components/HeaderPortal";
import { useMyUserImageUrl } from "@/lib/useMyUserImageUrl";
import { haptic } from "@/lib/haptics";

/**
 * Profile editor — mirrors the /info → /edit-title pattern. Image, name, and
 * reference location are edited here; the main settings page displays them
 * read-only. Changes commit on the header Save button (image upload/remove,
 * name, typed location are deferred); the location "Detect"/"Clear" controls
 * commit immediately. Back triggers a "Discard changes?" confirmation when
 * anything is staged.
 */
export default function SettingsEditPage() {
  const router = useRouter();
  usePageReady(true);

  const [name, setName] = useState("");
  const [initialName, setInitialName] = useState("");
  const [locationInput, setLocationInput] = useState("");
  const [savedLocation, setSavedLocation] = useState<UserLocation | null>(null);
  const [isGeolocating, setIsGeolocating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Image staging mirrors /edit-title: pendingCroppedBlob (new upload) vs
  // pendingImageRemoval (clear). The current account image comes from the
  // shared useMyUserImageUrl() hook.
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [pendingCroppedBlob, setPendingCroppedBlob] = useState<Blob | null>(null);
  const [pendingImageRemoval, setPendingImageRemoval] = useState(false);
  const [localImagePreviewUrl, setLocalImagePreviewUrl] = useState<string | null>(null);
  const [photoGateOpen, setPhotoGateOpen] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const serverImageUrl = useMyUserImageUrl();

  useEffect(() => {
    const savedName = getUserName() ?? "";
    setName(savedName);
    setInitialName(savedName);
    setSavedLocation(getUserLocation());
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
  const nameChanged = name.trim() !== initialName.trim();
  const hasUnsavedChanges = nameChanged || locationInput.trim() !== "" || hasPendingImageChange;

  const openFilePicker = () => {
    if (saving) return;
    // The photo is account data — gate behind the same account-setup modal as
    // creating a group / voting when the user has no name/account yet.
    if (!isValidUserName(getUserName())) {
      setPhotoGateOpen(true);
      return;
    }
    fileInputRef.current?.click();
  };

  const onFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPickedFile(file);
  };

  const onCropConfirm = (croppedBlob: Blob) => {
    setPendingCroppedBlob(croppedBlob);
    setPendingImageRemoval(false);
    setPickedFile(null);
  };

  const onRemoveImage = () => {
    if (saving) return;
    if (pendingCroppedBlob) {
      setPendingCroppedBlob(null);
      return;
    }
    if (serverImageUrl) {
      setPendingImageRemoval(true);
    }
  };

  const navigateAway = () => {
    navigateWithTransition(router, "/settings", "back");
  };

  // Swipe-back → /settings (mirrors the group/poll info pages). The
  // settings backdrop renders the main settings page behind this one
  // during the drag; on commit we navigate directly with router.push (the
  // backdrop is already showing the destination). The header chrome is the
  // HeaderPortal-floated back/Save buttons in the body-level
  // `#header-portal` node, so that node is the gesture's "header"
  // transform target — the buttons slide with the page (see app/layout.tsx).
  //
  // The gesture is DISABLED while changes are staged (`hasUnsavedChanges`):
  // the back button routes those through the "Discard your changes?"
  // confirmation, and a swipe can't stop mid-gesture to ask — silently
  // discarding a cropped photo / typed name would be data loss. With
  // changes staged the handlers simply aren't attached, so the drag
  // scrolls/no-ops like any non-swipe page.
  const headerPortalRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    headerPortalRef.current = document.getElementById("header-portal");
    return () => {
      headerPortalRef.current = null;
    };
  }, []);
  const { swipeWrapperRef, touchHandlers } = useSwipeBackGesture({
    headerRef: headerPortalRef,
    showBackdrop: () => window.dispatchEvent(new Event(SHOW_SETTINGS_BACKDROP_EVENT)),
    hideBackdrop: () => window.dispatchEvent(new Event(HIDE_SETTINGS_BACKDROP_EVENT)),
    onCommit: () => router.push("/settings"),
  });
  const swipeHandlers = hasUnsavedChanges ? {} : touchHandlers;

  const handleBack = () => {
    if (hasUnsavedChanges) {
      setShowDiscardConfirm(true);
      return;
    }
    navigateAway();
  };

  const discardAndLeave = () => {
    setShowDiscardConfirm(false);
    navigateAway();
  };

  const handleSave = async () => {
    if (saving) return;
    haptic.success();
    setSaving(true);
    setMessage(null);

    try {
      saveUserName(name);
      setInitialName(name.trim());

      // Geocode a typed location if provided.
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
          setMessage({ type: "error", text: "Could not find that location. Try a zip code or city name." });
          setSaving(false);
          return;
        }
      }

      if (pendingCroppedBlob) {
        // Pass the current name so the server can mint an account to own the
        // photo when the caller has none yet (the openFilePicker gate ensures
        // a name exists). Ignored when an account already resolves.
        await apiUploadMyUserImage(pendingCroppedBlob, name);
        setPendingCroppedBlob(null);
      } else if (pendingImageRemoval) {
        await apiDeleteMyUserImage();
        setPendingImageRemoval(false);
      }

      navigateAway();
    } catch {
      setMessage({ type: "error", text: "Failed to save settings" });
      setSaving(false);
    }
  };

  const handleDetectLocation = async () => {
    setIsGeolocating(true);
    setMessage(null);
    try {
      const loc = await detectAndSaveUserLocation();
      setSavedLocation(loc);
      setLocationInput("");
      setMessage({ type: "success", text: `Location set to ${loc.label}` });
    } catch (err) {
      if (err instanceof GeolocationDeniedError) {
        setMessage({ type: "error", text: "Location access denied" });
      } else {
        setMessage({ type: "error", text: "Failed to determine your location" });
      }
    } finally {
      setIsGeolocating(false);
    }
  };

  return (
    <>
      {/* Floating opaque-bubble buttons portaled outside .responsive-scaling-container
       *  so position:fixed is viewport-relative on desktop. Mirrors the /info +
       *  /edit-title back + action buttons. */}
      <HeaderPortal>
        <button
          onClick={handleBack}
          className="fixed left-3 z-30 w-10 h-10 flex items-center justify-center rounded-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 active:opacity-70"
          style={{ top: "calc(env(safe-area-inset-top, 0px) + 0.5rem)" }}
          aria-label="Go back"
        >
          <svg className="w-6 h-6 text-gray-700 dark:text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="fixed right-3 z-30 h-10 px-4 flex items-center justify-center rounded-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 active:opacity-70 disabled:opacity-50 text-blue-600 dark:text-blue-400 text-sm font-medium"
          style={{ top: "calc(env(safe-area-inset-top, 0px) + 0.5rem)" }}
          aria-label="Save profile"
        >
          {saving ? "..." : "Save"}
        </button>
      </HeaderPortal>

      {/* z-index:1 + opaque background keeps the settings backdrop hidden
          behind the page until the swipe moves the wrapper sideways. The
          negative horizontal margins cancel the template wrapper's `px-4`
          (1rem) PLUS the outer safe-area padding so the background paints
          all the way to the screen edges (same as the info pages); the
          inner div re-applies the inset so the content doesn't move. */}
      <div
        ref={swipeWrapperRef}
        {...swipeHandlers}
        className="touch-pan-y"
        style={{
          willChange: "transform",
          position: "relative",
          zIndex: 1,
          background: "var(--background)",
          minHeight: "100dvh",
          marginLeft: "calc(-1rem - max(0.35rem, env(safe-area-inset-left, 0px)))",
          marginRight: "calc(-1rem - max(0.35rem, env(safe-area-inset-right, 0px)))",
        }}
      >
      <div
        style={{
          paddingLeft: "calc(1rem + max(0.35rem, env(safe-area-inset-left, 0px)))",
          paddingRight: "calc(1rem + max(0.35rem, env(safe-area-inset-right, 0px)))",
        }}
      >
      <div className="max-w-4xl mx-auto px-4" style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 1.05rem)" }}>
        {/* Avatar + badges — camera badge opens the file picker; X badge stages
            an image removal (only shown when an image is displayed). Both badges
            are siblings of the avatar button so their handlers stay independent. */}
        <div className="flex flex-col items-center mb-6">
          <div className="relative">
            <button
              type="button"
              onClick={openFilePicker}
              disabled={saving}
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
            {effectiveImageUrl && !saving && (
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
        </div>

        {/* Name */}
        <div className="mb-6">
          <section className="rounded-3xl bg-gray-50 dark:bg-gray-800 px-4">
            <CompactNameField name={name} setName={setName} disabled={saving} />
          </section>
        </div>

        {/* Reference Location */}
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
                onClick={() => {
                  clearUserLocation();
                  setSavedLocation(null);
                }}
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
              disabled={saving || isGeolocating}
            />
            <button
              type="button"
              onClick={handleDetectLocation}
              disabled={saving || isGeolocating}
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

        {message && (
          <div
            className={`mb-4 p-3 rounded-md text-sm ${
              message.type === "success"
                ? "bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-300 border border-green-400 dark:border-green-600"
                : "bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-400 dark:border-red-600"
            }`}
          >
            {message.text}
          </div>
        )}
      </div>
      </div>
      </div>

      {pickedFile && (
        <ImageCropModal
          file={pickedFile}
          onCancel={() => setPickedFile(null)}
          onConfirm={onCropConfirm}
        />
      )}

      <AccountGateModal
        isOpen={photoGateOpen}
        message="to add a profile photo"
        onSubmit={() => {
          setPhotoGateOpen(false);
          fileInputRef.current?.click();
        }}
        onCancel={() => setPhotoGateOpen(false)}
      />

      <ConfirmationModal
        isOpen={showDiscardConfirm}
        message="Discard your changes?"
        confirmText="Discard"
        confirmButtonClass="bg-red-600 hover:bg-red-700 text-white"
        onConfirm={discardAndLeave}
        onCancel={() => setShowDiscardConfirm(false)}
      />
    </>
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
