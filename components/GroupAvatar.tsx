"use client";

import { useId } from 'react';
import RespondentCircles from '@/components/RespondentCircles';

/**
 * Group avatar — image-or-initials wrapper.
 *
 * Rendered via SVG with viewBox 0 0 100 100 and a centered disc of
 * diameter 83 — matching `RespondentCircles`'s single-circle layout
 * exactly so the image and initials variants are pixel-identical in
 * size. CSS `border-radius` on a div sized to `w-full h-full` (the
 * previous approach) made the image fill 100% of the wrapper while the
 * SVG placeholder filled only 83%, producing a visibly bigger circle
 * for uploaded images.
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
  const reactId = useId();
  if (imageUrl) {
    const clipId = `${reactId}-clip`;
    return (
      <div className={`${sizeClassName} aspect-square flex-shrink-0 self-center`}>
        <svg viewBox="0 0 100 100" className="w-full h-full" aria-hidden="true">
          <defs>
            <clipPath id={clipId}>
              <circle cx="50" cy="50" r="41.5" />
            </clipPath>
          </defs>
          <circle cx="50" cy="50" r="41.5" fill="#E5E7EB" />
          <image
            href={imageUrl}
            x="8.5"
            y="8.5"
            width="83"
            height="83"
            preserveAspectRatio="xMidYMid slice"
            clipPath={`url(#${clipId})`}
          />
        </svg>
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
