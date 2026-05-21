"use client";

import { useEffect, useRef, useState, Suspense } from "react";
import { useParams } from "next/navigation";
import {
  apiUpdateGroupTitle,
  apiUploadGroupImage,
  apiDeleteGroupImage,
} from "@/lib/api";
import { slideToGroupInfo } from "@/lib/slideOverlay";
import { useGroup } from "@/lib/useGroup";
import { type Group } from "@/lib/groupUtils";
import GroupAvatar from "@/components/GroupAvatar";
import HeaderPortal from "@/components/HeaderPortal";
import ImageCropModal from "@/components/ImageCropModal";
import ConfirmationModal from "@/components/ConfirmationModal";
import { GroupLoading, GroupNotFound } from "@/components/GroupLoadState";
import { haptic } from "@/lib/haptics";

/**
 * Title + image staging: changes accumulate in local state and only commit
 * on Save. Back triggers a "Discard changes?" confirmation when anything
 * is staged. Picking a new image clears any pending removal; tapping
 * Remove clears any pending blob.
 */
function Editor({ group, groupId }: { group: Group; groupId: string }) {
  const [value, setValue] = useState<string>(group.groupTitleOverride ?? '');
  const [saving, setSaving] = useState(false);

  const [pendingCroppedBlob, setPendingCroppedBlob] = useState<Blob | null>(null);
  const [pendingImageRemoval, setPendingImageRemoval] = useState(false);
  const [localImagePreviewUrl, setLocalImagePreviewUrl] = useState<string | null>(null);

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
      : group.imageUrl;

  const titleChanged = (value.trim() || null) !== (group.groupTitleOverride ?? null);
  const imageChanged = pendingCroppedBlob !== null || pendingImageRemoval;
  const hasUnsavedChanges = titleChanged || imageChanged;

  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const navigateAway = () => {
    // Always land on /info — back button is "go to the info page", not
    // "pop one history entry" (which could be the group root or anywhere
    // else depending on how the user reached edit-title). The slide
    // overlay handles the router.push since useHistoryBack defaults to
    // false.
    slideToGroupInfo({ groupId, direction: 'back' });
  };

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

  const save = async () => {
    if (saving) return;
    haptic.success();
    setSaving(true);
    try {
      if (pendingCroppedBlob) {
        await apiUploadGroupImage(groupId, pendingCroppedBlob);
      } else if (pendingImageRemoval && group.imageUrl) {
        await apiDeleteGroupImage(groupId);
      }
      if (titleChanged) {
        await apiUpdateGroupTitle(groupId, value.trim() || null);
      }
      navigateAway();
    } catch (err) {
      console.error('Failed to save group changes:', err);
      setSaving(false);
    }
  };

  const openFilePicker = () => {
    if (saving) return;
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
    if (saving) return;
    setPendingImageRemoval(true);
    setPendingCroppedBlob(null);
  };

  return (
    <>
      {/* Floating opaque-bubble buttons portaled outside .responsive-scaling-container
       *  so position:fixed is viewport-relative on desktop. Mirrors the /info
       *  page's back + Edit buttons. */}
      <HeaderPortal>
        <button
          onClick={handleBack}
          className="fixed left-3 z-30 w-10 h-10 flex items-center justify-center rounded-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 active:opacity-70"
          style={{ top: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)' }}
          aria-label="Go back"
        >
          <svg className="w-6 h-6 text-gray-700 dark:text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="fixed right-3 z-30 h-10 px-4 flex items-center justify-center rounded-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 active:opacity-70 disabled:opacity-50 text-blue-600 dark:text-blue-400 text-sm font-medium"
          style={{ top: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)' }}
          aria-label="Save group title"
        >
          {saving ? '...' : 'Save'}
        </button>
      </HeaderPortal>

      <div className="max-w-4xl mx-auto px-4" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1.05rem)' }}>
        {/* Avatar + badges — centered above the title. Camera badge in
            the lower-right opens the file picker; X badge in the upper-
            right stages an image removal (only shown when an image is
            actually displayed). Both badges are siblings of the avatar
            button inside a `relative` wrapper so their click handlers
            stay independent. */}
        <div className="flex flex-col items-center mb-6">
          <div className="relative">
            <button
              type="button"
              onClick={openFilePicker}
              disabled={saving}
              aria-label="Change group image"
              className="block outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-full disabled:opacity-60"
            >
              <GroupAvatar
                imageUrl={effectiveImageUrl}
                names={group.participantNames}
                anonymousCount={group.anonymousRespondentCount}
                sizeClassName="w-28"
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
                aria-label="Remove group image"
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

        <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">Group title</label>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={(e) => setValue(e.target.value.trim())}
          placeholder={group.defaultTitle}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 rounded-lg text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          Leave blank to use the default: <span className="italic">{group.defaultTitle}</span>
        </p>
      </div>

      {pickedFile && (
        <ImageCropModal
          file={pickedFile}
          onCancel={() => setPickedFile(null)}
          onConfirm={onCropConfirm}
        />
      )}

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

/** Prop-driven inner view. Exposed so the slide overlay can render this
 *  view directly without going through useParams() (the overlay mounts
 *  the component while the URL is still the source page). */
export function GroupEditTitleView({ groupId }: { groupId: string }) {
  const { group, loading, error } = useGroup(groupId);

  if (loading) return <GroupLoading />;
  if (error || !group) return <GroupNotFound />;
  return <Editor group={group} groupId={groupId} />;
}

function EditGroupTitleInner() {
  const params = useParams();
  const groupId = params.groupShortId as string;
  return <GroupEditTitleView groupId={groupId} />;
}

export default function EditGroupTitlePage() {
  return (
    <Suspense fallback={<GroupLoading />}>
      <EditGroupTitleInner />
    </Suspense>
  );
}
