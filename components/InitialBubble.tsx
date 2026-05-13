import { ANONYMOUS_FALLBACK_COLOR, nameToColor } from "@/components/RespondentCircles";
import { getUserInitials } from "@/lib/userProfile";

/**
 * Name-initials disc. Optionally renders an uploaded profile image
 * (clipped to the circle) when `imageUrl` is set.
 *
 * Size defaults to `w-7 h-7` (small inline bubble) with `text-xs`
 * initials. Override via `sizeClassName` + `textSizeClassName` for
 * larger surfaces (settings hero `w-28`, /info members `w-8 h-8`).
 *
 * When an `imageUrl` is provided we render the bitmap clipped to a
 * circle via `object-cover`. A gray base shows during image load.
 */
const BASE_LAYOUT_CLASS = "rounded-full flex items-center justify-center select-none";
const DEFAULT_SIZE_CLASS = "w-7 h-7";
const DEFAULT_TEXT_CLASS = "text-xs";

export default function InitialBubble({
  name,
  imageUrl = null,
  sizeClassName = DEFAULT_SIZE_CLASS,
  textSizeClassName = DEFAULT_TEXT_CLASS,
  className,
}: {
  name: string | null;
  imageUrl?: string | null;
  sizeClassName?: string;
  textSizeClassName?: string;
  className?: string;
}) {
  const wrapperClass = [sizeClassName, BASE_LAYOUT_CLASS, className]
    .filter(Boolean)
    .join(" ");
  if (imageUrl) {
    return (
      <div
        className={`${wrapperClass} overflow-hidden bg-gray-200 dark:bg-gray-700`}
        aria-hidden="true"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt=""
          className="w-full h-full object-cover"
          draggable={false}
        />
      </div>
    );
  }
  const backgroundColor = name?.trim() ? nameToColor(name) : ANONYMOUS_FALLBACK_COLOR;
  return (
    <div
      className={`${wrapperClass} text-white font-bold ${textSizeClassName}`}
      style={{ backgroundColor }}
      aria-hidden="true"
    >
      {getUserInitials(name)}
    </div>
  );
}
