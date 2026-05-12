"use client";

import { useRef, useState, Suspense } from "react";
import { useRouter, useParams } from "next/navigation";
import {
  apiUpdateGroupTitle,
  apiUploadGroupImage,
  apiDeleteGroupImage,
} from "@/lib/api";
import { navigateWithTransition, navigateBackWithTransition, hasAppHistory } from "@/lib/viewTransitions";
import { useGroup } from "@/lib/useGroup";
import { useMeasuredHeight } from "@/lib/useMeasuredHeight";
import { buildGroupImageUrl, type Group } from "@/lib/groupUtils";
import GroupHeader from "@/components/GroupHeader";
import GroupAvatar from "@/components/GroupAvatar";
import ImageCropModal from "@/components/ImageCropModal";
import { GroupLoading, GroupNotFound } from "@/components/GroupLoadState";

function Editor({ group, groupId }: { group: Group; groupId: string }) {
  const router = useRouter();
  // Migration 105: group_title lives on groups.title — surfaced on
  // every poll in the group as the same value. Empty groups carry the
  // override directly on `Group.groupTitleOverride` (no latestPoll to
  // read from).
  const [value, setValue] = useState<string>(group.groupTitleOverride ?? '');
  const [saving, setSaving] = useState(false);

  // Avatar state: local override of `group.imageUrl` so a freshly-uploaded
  // (or cleared) image appears instantly without re-routing through the
  // useGroup loader. `imageOverride === undefined` → use `group.imageUrl`;
  // `null` → forced no image; string → forced new URL.
  const [imageOverride, setImageOverride] = useState<string | null | undefined>(undefined);
  const effectiveImageUrl =
    imageOverride === undefined ? group.imageUrl : imageOverride;

  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [headerRef, headerHeight] = useMeasuredHeight<HTMLDivElement>();

  const goBack = () => {
    if (hasAppHistory()) navigateBackWithTransition();
    else navigateWithTransition(router, `/g/${groupId}/info`, 'back');
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      // `groupId` is the route param — the server resolves any of
      // `groups.short_id`, `groups.id`, `polls.short_id`, or
      // `polls.id` to the same group. apiUpdateGroupTitle handles
      // cache invalidation for every poll in the group.
      await apiUpdateGroupTitle(groupId, value.trim() || null);
      goBack();
    } catch (err) {
      console.error('Failed to update group title:', err);
      setSaving(false);
    }
  };

  const openFilePicker = () => {
    if (imageBusy) return;
    fileInputRef.current?.click();
  };

  const onFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset the input so re-picking the same file fires `change` again.
    e.target.value = '';
    if (!file) return;
    setPickedFile(file);
  };

  const onCropConfirm = async (croppedBlob: Blob) => {
    setImageBusy(true);
    try {
      const result = await apiUploadGroupImage(groupId, croppedBlob);
      setImageOverride(
        buildGroupImageUrl(
          result.group_short_id ?? result.group_id ?? groupId,
          result.image_updated_at,
        ),
      );
      setPickedFile(null);
    } catch (err) {
      console.error('Failed to upload group image:', err);
    } finally {
      setImageBusy(false);
    }
  };

  const onRemoveImage = async () => {
    if (imageBusy) return;
    setImageBusy(true);
    try {
      await apiDeleteGroupImage(groupId);
      setImageOverride(null);
    } catch (err) {
      console.error('Failed to remove group image:', err);
    } finally {
      setImageBusy(false);
    }
  };

  return (
    <>
      <GroupHeader
        headerRef={headerRef}
        title="Edit Title"
        onBack={goBack}
        rightSlot={
          <button
            onClick={save}
            disabled={saving}
            className="self-stretch py-2 px-2 flex items-center justify-center shrink-0 disabled:opacity-50"
            aria-label="Save group title"
          >
            <span className="min-w-10 h-10 flex items-center justify-center text-blue-600 dark:text-blue-400 text-sm font-semibold">
              {saving ? '...' : 'Save'}
            </span>
          </button>
        }
      />

      <div className="max-w-4xl mx-auto px-4" style={{ paddingTop: `calc(${headerHeight}px + 1rem)` }}>
        {/* Avatar + camera badge — centered above the title. Tap anywhere
            on the avatar (or the badge) to open the native image picker. */}
        <div className="flex flex-col items-center mb-6">
          <button
            type="button"
            onClick={openFilePicker}
            disabled={imageBusy}
            aria-label="Change group image"
            className="relative outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-full disabled:opacity-60"
          >
            <GroupAvatar
              imageUrl={effectiveImageUrl}
              names={group.participantNames}
              anonymousCount={group.anonymousRespondentCount}
              sizeClassName="w-28"
            />
            {/* Camera badge in lower-right. Sized so it slightly overlaps
                the circle edge — same idiom as message-app avatar editors. */}
            <span
              className="absolute bottom-0 right-0 w-9 h-9 rounded-full bg-blue-600 dark:bg-blue-500 text-white flex items-center justify-center shadow-md ring-2 ring-white dark:ring-gray-900"
              aria-hidden
            >
              <CameraPencilIcon />
            </span>
          </button>
          {effectiveImageUrl && !imageBusy && (
            <button
              type="button"
              onClick={onRemoveImage}
              className="mt-3 text-xs text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 underline-offset-2 hover:underline"
            >
              Remove image
            </button>
          )}
          {imageBusy && (
            <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">Uploading…</p>
          )}
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
          autoFocus
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
    </>
  );
}

function CameraPencilIcon() {
  // Combined camera + pencil glyph. Camera body with a tiny pencil
  // overlapping the lower-right of the lens — reads as "edit photo".
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7h3l2-3h6l2 3h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}

function EditGroupTitleInner() {
  const params = useParams();
  const groupId = params.groupShortId as string;
  const { group, loading, error } = useGroup(groupId);

  if (loading) return <GroupLoading />;
  if (error || !group) return <GroupNotFound />;
  return <Editor group={group} groupId={groupId} />;
}

export default function EditGroupTitlePage() {
  return (
    <Suspense fallback={<GroupLoading />}>
      <EditGroupTitleInner />
    </Suspense>
  );
}
