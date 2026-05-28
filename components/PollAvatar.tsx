"use client";

import React from 'react';
import { Question } from '@/lib/types';
import { getCategoryIcon } from '@/lib/questionListUtils';
import { LAYOUTS, BOUNDING_SCALE } from '@/components/RespondentCircles';

// Mirrors RespondentCircles's tessellation geometry but renders each
// question's category icon (emoji) as a bare glyph — no background discs.
// A single-question poll lands on LAYOUTS[1] (one big glyph); multi-question
// polls pick the matching LAYOUTS[N] so the icons sit in the same packing
// positions as the group page's name circles. Re-uses RespondentCircles's
// exported LAYOUTS / BOUNDING_SCALE so layout edits there stay in sync.

interface PollAvatarProps {
  questions: Question[];
  sizeClassName?: string;
}

export default function PollAvatar({ questions, sizeClassName = 'w-16' }: PollAvatarProps) {
  const icons = questions
    .slice(0, LAYOUTS.length - 1)
    .map((q) => getCategoryIcon(q));

  // No questions → empty slot of the right dimensions so flex siblings
  // (the title) don't reflow vs the populated case.
  if (icons.length === 0) {
    return <div className={`${sizeClassName} aspect-square flex-shrink-0 self-center`} />;
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
        {icons.map((icon, i) => {
          const [cx, cy] = layoutCenters[i];
          // Emoji glyphs render slightly smaller than their em-box; scale the
          // font size to roughly fill the per-icon slot the tessellation
          // reserves (radius × 2 ≈ font-em-box).
          const fontSize = layoutRadius * 2;
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
