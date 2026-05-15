"use client";

import React, { useId } from 'react';
import { getUserInitials, isCurrentUserName } from '@/lib/userProfile';
import { useMyUserImageUrl } from '@/lib/useMyUserImageUrl';

// Shared bounding-disc geometry. The avatar's outer SVG is a 100×100
// viewBox; everything inside fits inside a centered disc of diameter
// BOUNDING_DIAMETER so the image variant in GroupAvatar matches the
// initials tessellation pixel-for-pixel.
export const BOUNDING_RADIUS = 41.5;
export const BOUNDING_DIAMETER = BOUNDING_RADIUS * 2;
export const BOUNDING_OFFSET = 50 - BOUNDING_RADIUS;

// Pre-computed circle packing layouts in SVG viewBox units (0-100)
const LAYOUTS: { centers: [number, number][]; diameter: number }[] = [
  /* 0 */ { centers: [], diameter: 0 },
  /* 1 */ { centers: [[50, 50]], diameter: 83 },
  /* 2 */ { centers: [[27, 50], [73, 50]], diameter: 44 },
  /* 3 */ { centers: [[50, 22.708], [26.364, 63.646], [73.636, 63.646]], diameter: 42 },
  /* 4 */ { centers: [[26, 26], [74, 26], [26, 74], [74, 74]], diameter: 42 },
  /* 5 */ { centers: [[22, 22], [78, 22], [50, 50], [22, 78], [78, 78]], diameter: 35 },
  /* 6 */ { centers: [[18, 34], [50, 34], [82, 34], [18, 66], [50, 66], [82, 66]], diameter: 29 },
  /* 7 */ {
    centers: [[32, 21], [68, 21], [16, 50], [50, 50], [84, 50], [32, 79], [68, 79]],
    diameter: 26,
  },
];

// Per-N scale that snugs each tessellation inside the bounding disc.
// Computed from each layout's outermost reach so layout edits stay in
// sync without a hand-tuned parallel array.
const BOUNDING_SCALE = LAYOUTS.map(({ centers, diameter }) => {
  if (centers.length === 0) return 1;
  const r = diameter / 2;
  const maxReach = Math.max(...centers.map(([cx, cy]) => Math.hypot(cx - 50, cy - 50) + r));
  return BOUNDING_RADIUS / maxReach;
});

const MAX_NAMED = 6;

export const ANONYMOUS_FALLBACK_COLOR = '#9CA3AF';

const COLORS = [
  '#4F46E5', '#2563EB', '#0891B2', '#0D9488', '#059669',
  '#EA580C', '#DC2626', '#DB2777', '#9333EA', '#7C3AED',
];

export function nameToColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash) + name.charCodeAt(i);
    hash |= 0;
  }
  return COLORS[(hash >>> 0) % COLORS.length];
}

interface RespondentCirclesProps {
  names: string[];
  anonymousCount: number;
  sizeClassName?: string;
}

export default function RespondentCircles({ names, anonymousCount, sizeClassName = "w-16" }: RespondentCirclesProps) {
  // The current browser's uploaded profile image (or null). When one
  // of the rendered names matches the current user's saved name we
  // swap that one circle for the image — every other name keeps its
  // colored-initials disc. The hook subscribes to the profile-changed
  // event so an upload from the settings page propagates here without
  // a navigation. Per scope ("no cross-user image lookup") we only
  // resolve the current user's image; other names keep initials.
  const myImageUrl = useMyUserImageUrl();
  // Stable per-instance prefix so multiple RespondentCircles on the
  // same page don't collide on clipPath ids.
  const reactId = useId();

  const validNames = names.filter(n => n.trim().length > 0);
  const shownNames = validNames.slice(0, MAX_NAMED);
  const overflow = Math.max(0, validNames.length - MAX_NAMED) + anonymousCount;

  type Circle = { label: string; fill: string; imageUrl: string | null };
  const circles: Circle[] = shownNames.map(name => {
    const isMe = isCurrentUserName(name);
    return {
      label: getUserInitials(name),
      fill: nameToColor(name),
      imageUrl: isMe ? myImageUrl : null,
    };
  });

  if (overflow > 0) {
    circles.push({ label: `+${overflow}`, fill: '#6B7280', imageUrl: null });
  }

  // Empty state placeholder: a plain gray circle with NO label. Used by
  // the home list, group page header, and /info hero for groups that
  // only contain the current user (filtered out by buildGroups) AND
  // have no anonymous votes — keeps the avatar slot occupied with a
  // consistent gray bubble rather than misrepresenting the group as a
  // single anonymous voter via the legacy "?" fallback.
  const isPlaceholder = circles.length === 0;
  if (isPlaceholder) {
    circles.push({ label: '', fill: ANONYMOUS_FALLBACK_COLOR, imageUrl: null });
  }

  const n = Math.min(circles.length, LAYOUTS.length - 1);
  const layout = LAYOUTS[n];
  // Snug each tessellation into a diameter-83 bounding circle so the
  // multi-circle layouts visually match the image-avatar disc size.
  const scale = BOUNDING_SCALE[n] ?? 1;
  const layoutCenters: [number, number][] = layout.centers.map(([cx, cy]) => [
    50 + (cx - 50) * scale,
    50 + (cy - 50) * scale,
  ]);
  const layoutRadius = (layout.diameter * scale) / 2;
  const hasAnyImage = circles.some(c => !!c.imageUrl);

  return (
    <div className={`${sizeClassName} aspect-square flex-shrink-0 self-center`}>
      <svg viewBox="0 0 100 100" className="w-full h-full" aria-hidden="true">
        {hasAnyImage && (
          <defs>
            {circles.map((circle, i) => {
              if (!circle.imageUrl) return null;
              const [cx, cy] = layoutCenters[i];
              return (
                <clipPath id={`${reactId}-clip-${i}`} key={i}>
                  <circle cx={cx} cy={cy} r={layoutRadius} />
                </clipPath>
              );
            })}
          </defs>
        )}
        {!isPlaceholder && (
          <circle
            cx={50}
            cy={50}
            r={BOUNDING_RADIUS}
            className="fill-gray-100 dark:fill-gray-800"
          />
        )}
        {circles.map((circle, i) => {
          const [cx, cy] = layoutCenters[i];
          const r = layoutRadius;
          if (circle.imageUrl) {
            // Image-backed circle: an SVG <image> clipped to the disc.
            // `preserveAspectRatio="xMidYMid slice"` mimics CSS
            // object-cover so non-square sources fill the circle. A
            // gray base circle peeks through during image load.
            return (
              <g key={i}>
                <circle cx={cx} cy={cy} r={r} fill="#E5E7EB" />
                <image
                  href={circle.imageUrl}
                  x={cx - r}
                  y={cy - r}
                  width={r * 2}
                  height={r * 2}
                  preserveAspectRatio="xMidYMid slice"
                  clipPath={`url(#${reactId}-clip-${i})`}
                />
              </g>
            );
          }
          const fontSize = circle.label.length <= 1 ? r * 1.6 : circle.label.length <= 2 ? r : r * 0.8;
          return (
            <g key={i}>
              <circle cx={cx} cy={cy} r={r} fill={circle.fill} />
              {circle.label && (
                <text
                  x={cx}
                  y={cy}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="white"
                  fontSize={fontSize}
                  fontWeight="700"
                  fontFamily="system-ui, -apple-system, sans-serif"
                >
                  {circle.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
