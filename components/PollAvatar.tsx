"use client";

import React from 'react';
import { Question } from '@/lib/types';
import { getCategoryIcon } from '@/lib/questionListUtils';
import {
  BOUNDING_RADIUS,
  LAYOUTS,
  BOUNDING_SCALE,
} from '@/components/RespondentCircles';

// Mirrors RespondentCircles's tessellation but renders each question's
// category icon (emoji) instead of a name's colored initials disc. A
// single-question poll lands on LAYOUTS[1] (one big circle); multi-question
// polls pick the matching LAYOUTS[N] so the geometry is pixel-identical to
// the group page's name graphic. Re-uses RespondentCircles's exported
// LAYOUTS / BOUNDING_SCALE / BOUNDING_RADIUS so layout edits there stay
// in sync here automatically.
//
// Visual choice: each inner disc gets a light fill (#E5E7EB, matching the
// image-variant base disc in GroupAvatar) instead of a per-name color —
// emojis are already multi-colored, so a neutral disc reads as a quiet
// holder rather than a competing color block.

interface PollAvatarProps {
  questions: Question[];
  sizeClassName?: string;
}

const ICON_DISC_FILL = '#E5E7EB';

export default function PollAvatar({ questions, sizeClassName = 'w-16' }: PollAvatarProps) {
  const icons = questions
    .slice(0, LAYOUTS.length - 1)
    .map((q) => getCategoryIcon(q));

  // No questions → quiet placeholder bounding disc (matches the empty
  // RespondentCircles state shape so the slot stays occupied).
  if (icons.length === 0) {
    return (
      <div className={`${sizeClassName} aspect-square flex-shrink-0 self-center`}>
        <svg viewBox="0 0 100 100" className="w-full h-full" aria-hidden="true">
          <circle
            cx={50}
            cy={50}
            r={BOUNDING_RADIUS}
            className="fill-gray-100 dark:fill-gray-800"
          />
        </svg>
      </div>
    );
  }

  const n = Math.min(icons.length, LAYOUTS.length - 1);
  const layout = LAYOUTS[n];
  const scale = BOUNDING_SCALE[n] ?? 1;
  const layoutCenters: [number, number][] = layout.centers.map(([cx, cy]) => [
    50 + (cx - 50) * scale,
    50 + (cy - 50) * scale,
  ]);
  const layoutRadius = (layout.diameter * scale) / 2;

  return (
    <div className={`${sizeClassName} aspect-square flex-shrink-0 self-center`}>
      <svg viewBox="0 0 100 100" className="w-full h-full" aria-hidden="true">
        <circle
          cx={50}
          cy={50}
          r={BOUNDING_RADIUS}
          className="fill-gray-100 dark:fill-gray-800"
        />
        {icons.map((icon, i) => {
          const [cx, cy] = layoutCenters[i];
          const r = layoutRadius;
          // Emoji glyphs render slightly smaller than their em-box; scale
          // the font size up modestly so the glyph fills the disc visually.
          const fontSize = r * 1.3;
          return (
            <g key={i}>
              <circle cx={cx} cy={cy} r={r} fill={ICON_DISC_FILL} />
              <text
                x={cx}
                y={cy}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={fontSize}
                fontFamily="system-ui, -apple-system, 'Segoe UI Emoji', 'Apple Color Emoji', sans-serif"
              >
                {icon}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
