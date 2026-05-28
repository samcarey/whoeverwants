"use client";

import React from 'react';
import { Question } from '@/lib/types';
import { getCategoryIcon } from '@/lib/questionListUtils';
import { LAYOUTS, BOUNDING_SCALE, BOUNDING_RADIUS } from '@/components/RespondentCircles';

// Mirrors RespondentCircles's tessellation geometry but renders each
// question's category icon (emoji) as a bare glyph atop a faint
// bounding-disc backdrop. No per-icon discs — only the outer bounding
// circle, in a fill (gray-50 / gray-900) that sits just off the page
// background so the avatar reads as a quiet container. A single-question
// poll lands on LAYOUTS[1] (one glyph); multi-question polls pick the
// matching LAYOUTS[N] so the icons sit in the same packing positions as
// the group page's name circles. Re-uses RespondentCircles's exported
// LAYOUTS / BOUNDING_SCALE / BOUNDING_RADIUS so layout edits stay in sync.

interface PollAvatarProps {
  questions: Question[];
  sizeClassName?: string;
}

export default function PollAvatar({ questions, sizeClassName = 'w-16' }: PollAvatarProps) {
  const icons = questions
    .slice(0, LAYOUTS.length - 1)
    .map((q) => getCategoryIcon(q));

  // No questions → empty slot of the right dimensions so flex siblings
  // (the title) don't reflow vs the populated case. Still renders the
  // bounding disc so the slot looks identical to the populated case.
  if (icons.length === 0) {
    return (
      <div className={`${sizeClassName} aspect-square flex-shrink-0 self-center`}>
        <svg viewBox="0 0 100 100" className="w-full h-full" aria-hidden="true">
          <circle
            cx={50}
            cy={50}
            r={BOUNDING_RADIUS}
            className="fill-gray-50 dark:fill-gray-900"
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
          className="fill-gray-50 dark:fill-gray-900"
        />
        {icons.map((icon, i) => {
          const [cx, cy] = layoutCenters[i];
          // Per-icon font size. Factor 1.6 (vs the tessellation slot's
          // factor-2 diameter) leaves visible space around every glyph —
          // a quiet inset within the bounding-disc footprint for the
          // single-icon case, and a gap between adjacent glyphs for the
          // multi-icon tessellation. The outer slot dimensions don't change.
          const fontSize = layoutRadius * 1.6;
          return (
            <text
              key={i}
              x={cx}
              y={cy}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={fontSize}
              fontFamily="system-ui, -apple-system, 'Segoe UI Emoji', 'Apple Color Emoji', sans-serif"
            >
              {icon}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
