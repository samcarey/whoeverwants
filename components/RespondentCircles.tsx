import React from 'react';

// Circle packing layouts for N=1..7 circles in an SVG viewBox (0-100)
// Visually balanced arrangements with consistent margins between circles
const LAYOUTS: { centers: [number, number][]; diameter: number }[] = [
  /* 0 */ { centers: [], diameter: 0 },
  /* 1 */ { centers: [[50, 50]], diameter: 76 },
  /* 2 */ { centers: [[28, 50], [72, 50]], diameter: 42 },
  /* 3 */ { centers: [[50, 27], [28, 73], [72, 73]], diameter: 38 },
  /* 4 */ { centers: [[27, 27], [73, 27], [27, 73], [73, 73]], diameter: 38 },
  /* 5 */ { centers: [[23, 23], [77, 23], [50, 50], [23, 77], [77, 77]], diameter: 32 },
  /* 6 */ { centers: [[19, 35], [50, 35], [81, 35], [19, 65], [50, 65], [81, 65]], diameter: 26 },
  /* 7 -- 2-3-2 honeycomb */ {
    centers: [[33, 22], [67, 22], [17, 50], [50, 50], [83, 50], [33, 78], [67, 78]],
    diameter: 24,
  },
];

const COLORS = [
  '#4F46E5', // indigo
  '#2563EB', // blue
  '#0891B2', // cyan
  '#0D9488', // teal
  '#059669', // emerald
  '#EA580C', // orange
  '#DC2626', // red
  '#DB2777', // pink
  '#9333EA', // purple
  '#7C3AED', // violet
];

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function nameToColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash) + name.charCodeAt(i);
    hash |= 0;
  }
  return COLORS[Math.abs(hash) % COLORS.length];
}

interface RespondentCirclesProps {
  names: string[];
  anonymousCount: number;
}

export default function RespondentCircles({ names, anonymousCount }: RespondentCirclesProps) {
  const validNames = names.filter(n => n.trim().length > 0);
  const shownNames = validNames.slice(0, 6);
  const overflow = Math.max(0, validNames.length - 6) + anonymousCount;

  const circles: { label: string; fill: string }[] = shownNames.map(name => ({
    label: getInitials(name),
    fill: nameToColor(name),
  }));

  if (overflow > 0) {
    circles.push({ label: `+${overflow}`, fill: '#6B7280' });
  }

  if (circles.length === 0) {
    circles.push({ label: '?', fill: '#9CA3AF' });
  }

  const n = Math.min(circles.length, 7);
  const layout = LAYOUTS[n];

  return (
    <div className="w-16 aspect-square flex-shrink-0 self-center">
      <svg viewBox="0 0 100 100" className="w-full h-full" aria-hidden="true">
        {circles.map((circle, i) => {
          const [cx, cy] = layout.centers[i];
          const r = layout.diameter / 2;
          const fontSize = circle.label.length <= 2 ? r * 1.0 : r * 0.8;
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
