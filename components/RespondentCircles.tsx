import React from 'react';
import { getUserInitials } from '@/lib/userProfile';

// Pre-computed circle packing layouts in SVG viewBox units (0-100)
const LAYOUTS: { centers: [number, number][]; diameter: number }[] = [
  /* 0 */ { centers: [], diameter: 0 },
  /* 1 */ { centers: [[50, 50]], diameter: 83 },
  /* 2 */ { centers: [[27, 50], [73, 50]], diameter: 44 },
  /* 3 */ { centers: [[50, 26], [27, 74], [73, 74]], diameter: 42 },
  /* 4 */ { centers: [[26, 26], [74, 26], [26, 74], [74, 74]], diameter: 42 },
  /* 5 */ { centers: [[22, 22], [78, 22], [50, 50], [22, 78], [78, 78]], diameter: 35 },
  /* 6 */ { centers: [[18, 34], [50, 34], [82, 34], [18, 66], [50, 66], [82, 66]], diameter: 29 },
  /* 7 */ {
    centers: [[32, 21], [68, 21], [16, 50], [50, 50], [84, 50], [32, 79], [68, 79]],
    diameter: 26,
  },
];

const MAX_NAMED = 6;

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
}

export default function RespondentCircles({ names, anonymousCount }: RespondentCirclesProps) {
  const validNames = names.filter(n => n.trim().length > 0);
  const shownNames = validNames.slice(0, MAX_NAMED);
  const overflow = Math.max(0, validNames.length - MAX_NAMED) + anonymousCount;

  const circles: { label: string; fill: string }[] = shownNames.map(name => ({
    label: getUserInitials(name),
    fill: nameToColor(name),
  }));

  if (overflow > 0) {
    circles.push({ label: `+${overflow}`, fill: '#6B7280' });
  }

  if (circles.length === 0) {
    circles.push({ label: '?', fill: '#9CA3AF' });
  }

  const n = Math.min(circles.length, LAYOUTS.length - 1);
  const layout = LAYOUTS[n];

  return (
    <div className="w-16 aspect-square flex-shrink-0 self-center">
      <svg viewBox="0 0 100 100" className="w-full h-full" aria-hidden="true">
        {circles.map((circle, i) => {
          const [cx, cy] = layout.centers[i];
          const r = layout.diameter / 2;
          const fontSize = circle.label.length <= 1 ? r * 1.25 : circle.label.length <= 2 ? r : r * 0.8;
          return (
            <g key={i}>
              <circle cx={cx} cy={cy} r={r} fill={circle.fill} />
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
            </g>
          );
        })}
      </svg>
    </div>
  );
}
