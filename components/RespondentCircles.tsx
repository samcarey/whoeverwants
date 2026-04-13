import React from 'react';
import { getUserInitials } from '@/lib/userProfile';

// Pre-computed circle packing layouts in SVG viewBox units (0-100)
const LAYOUTS: { centers: [number, number][]; diameter: number }[] = [
  /* 0 */ { centers: [], diameter: 0 },
  /* 1 */ { centers: [[50, 50]], diameter: 76 },
  /* 2 */ { centers: [[28, 50], [72, 50]], diameter: 42 },
  /* 3 */ { centers: [[50, 27], [28, 73], [72, 73]], diameter: 38 },
  /* 4 */ { centers: [[27, 27], [73, 27], [27, 73], [73, 73]], diameter: 38 },
  /* 5 */ { centers: [[23, 23], [77, 23], [50, 50], [23, 77], [77, 77]], diameter: 32 },
  /* 6 */ { centers: [[19, 35], [50, 35], [81, 35], [19, 65], [50, 65], [81, 65]], diameter: 26 },
  /* 7 */ {
    centers: [[33, 22], [67, 22], [17, 50], [50, 50], [83, 50], [33, 78], [67, 78]],
    diameter: 24,
  },
];

const MAX_NAMED = 6;

const COLORS = [
  '#4F46E5', '#2563EB', '#0891B2', '#0D9488', '#059669',
  '#EA580C', '#DC2626', '#DB2777', '#9333EA', '#7C3AED',
];

function nameToColor(name: string): string {
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
          const fontSize = circle.label.length <= 2 ? r : r * 0.8;
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
