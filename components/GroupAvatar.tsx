"use client";

import { useId } from 'react';
import RespondentCircles, {
  BOUNDING_DIAMETER,
  BOUNDING_OFFSET,
  BOUNDING_RADIUS,
} from '@/components/RespondentCircles';

// Group avatar — uploaded-image variant uses the same SVG-clipped disc
// geometry as RespondentCircles's bounding circle so image and initials
// variants render at identical size.
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
              <circle cx="50" cy="50" r={BOUNDING_RADIUS} />
            </clipPath>
          </defs>
          <circle cx="50" cy="50" r={BOUNDING_RADIUS} fill="#E5E7EB" />
          <image
            href={imageUrl}
            x={BOUNDING_OFFSET}
            y={BOUNDING_OFFSET}
            width={BOUNDING_DIAMETER}
            height={BOUNDING_DIAMETER}
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
