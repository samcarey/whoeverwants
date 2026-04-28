"use client";

import { useEffect, useRef, useState } from "react";

interface InlineTitleFieldProps {
  /** Current title value (user-typed or auto-generated). */
  title: string;
  /** True when the value was produced by the auto-title generator and should
   *  display as a greyed-out italic placeholder. */
  isAutoTitle: boolean;
  /** Auto-generated title to show when isAutoTitle is true. The displayed
   *  value while showing auto is `autoTitle`, not `title` — `title` is only
   *  used when the user has typed their own. */
  autoTitle: string;
  /** Called with the user's typed title when they edit. The parent should
   *  set isAutoTitle=false on first keystroke. */
  onChange: (next: string) => void;
  /** Called when the user blurs an empty input (or otherwise wants to
   *  revert to auto-generated). Parent should clear `title` and set
   *  isAutoTitle=true. */
  onRevertToAuto: () => void;
  disabled?: boolean;
  maxLength?: number;
}

/**
 * Top-of-the-draft-poll-card title slot. Inline-editable like CategoryForLine
 * — greyed-out italic auto-generated text by default; blue M PLUS 1 Code font
 * once the user types. Tap (focus) to edit. Clearing the input on blur
 * reverts to auto-generated.
 *
 * Visual treatment mirrors CategoryForLine on purpose: the user has been
 * trained to recognize "blue + monospace = the value I typed" in the create
 * flow.
 */
export default function InlineTitleField({
  title,
  isAutoTitle,
  autoTitle,
  onChange,
  onRevertToAuto,
  disabled = false,
  maxLength = 100,
}: InlineTitleFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);

  // While focused we always show the user's typed text in the input. Out of
  // focus + isAutoTitle: show the auto title (grey italic). Out of focus +
  // user-typed: show the user's title in blue.
  const showAuto = !focused && isAutoTitle;
  const displayValue = showAuto ? autoTitle : title;

  const placeholderText = "Title";

  // Auto-revert: if the user blurs an empty input, kick back to auto mode.
  const handleBlur = () => {
    setFocused(false);
    const trimmed = title.trim();
    if (trimmed !== title) onChange(trimmed);
    if (!trimmed) onRevertToAuto();
  };

  // First focus on auto-mode: clear so the user types fresh, but DON'T mark
  // user-typed yet (mark on first keystroke). Empty string + focused renders
  // the placeholder, keeping the same width footprint as the auto title.
  const handleFocus = () => {
    setFocused(true);
    // Move caret to end on focus when user already has typed text.
    if (!isAutoTitle) {
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (el) el.setSelectionRange(el.value.length, el.value.length);
      });
    }
  };

  return (
    <input
      ref={inputRef}
      type="text"
      value={displayValue}
      placeholder={placeholderText}
      onChange={(e) => onChange(e.target.value)}
      onFocus={handleFocus}
      onBlur={handleBlur}
      disabled={disabled}
      maxLength={maxLength}
      aria-label="Poll title"
      className={`
        w-full bg-transparent border-none outline-none p-0 m-0 truncate
        font-bold
        placeholder:text-gray-400 dark:placeholder:text-gray-500 placeholder:italic placeholder:font-normal
        ${showAuto
          ? "text-gray-400 dark:text-gray-500 italic font-normal"
          : "text-blue-600 dark:text-blue-400"}
      `}
      style={{
        fontSize: "1rem",
        fontFamily: showAuto
          ? undefined
          : "'M PLUS 1 Code', monospace",
        caretColor: "#2563eb",
      }}
    />
  );
}
