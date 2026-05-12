"use client";

import RespondentCircles from '@/components/RespondentCircles';

/**
 * Group avatar — image-or-initials wrapper.
 *
 * When `imageUrl` is set, renders the uploaded image circle-clipped. When
 * null, falls through to `RespondentCircles` (the multi-circle initials
 * graphic). Same outer dimensions either way, so swapping at render time
 * doesn't cause layout shift.
 *
 * Migration 108 added the image data; `Group.imageUrl` is the derived URL
 * (already includes the `?v=<image_updated_at>` cache-buster, so changes
 * propagate without explicit cache invalidation in the browser).
 *
 * The image is rendered with `object-fit: cover` so non-square sources
 * still fill the circle, BUT the upload flow always crops to a square
 * before sending, so this is just a safety net.
 */
interface GroupAvatarProps {
  imageUrl: string | null;
  names: string[];
  anonymousCount: number;
  sizeClassName?: string;
}

export default function GroupAvatar({
  imageUrl,
  names,
  anonymousCount,
  sizeClassName = 'w-16',
}: GroupAvatarProps) {
  if (imageUrl) {
    return (
      <div
        className={`${sizeClassName} aspect-square flex-shrink-0 self-center rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt=""
          className="w-full h-full object-cover"
          draggable={false}
        />
      </div>
    );
  }
  return (
    <RespondentCircles
      names={names}
      anonymousCount={anonymousCount}
      sizeClassName={sizeClassName}
    />
  );
}
