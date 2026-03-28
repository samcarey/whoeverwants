"use client";

import { useRef, useCallback } from "react";
import type { OptionMetadataEntry } from "@/lib/types";

interface OptionLabelProps {
  text: string;
  metadata?: OptionMetadataEntry | null;
  className?: string;
}

const LONG_PRESS_MS = 500;

/** Wrapper that opens a URL on long press instead of tap. */
function LongPressLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedRef = useRef(false);

  const start = useCallback(() => {
    firedRef.current = false;
    timerRef.current = setTimeout(() => {
      firedRef.current = true;
      window.open(href, "_blank", "noopener,noreferrer");
    }, LONG_PRESS_MS);
  }, [href]);

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  return (
    <div
      className={className}
      onMouseDown={start}
      onMouseUp={cancel}
      onMouseLeave={cancel}
      onTouchStart={start}
      onTouchEnd={cancel}
      onTouchCancel={cancel}
      onClick={(e) => {
        e.stopPropagation();
        // Prevent any parent tap handlers from firing after long press
        if (firedRef.current) e.preventDefault();
      }}
    >
      {children}
    </div>
  );
}

function MapPinIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path fillRule="evenodd" clipRule="evenodd" d="M12 2C7.58 2 4 5.58 4 10c0 5.25 7.13 11.38 7.43 11.63a1 1 0 001.14 0C12.87 21.38 20 15.25 20 10c0-4.42-3.58-8-8-8zm0 11a3 3 0 110-6 3 3 0 010 6z" />
    </svg>
  );
}

/** Detect if metadata represents a location (has OSM infoUrl or name). */
function isLocationEntry(metadata: OptionMetadataEntry | null | undefined): boolean {
  if (!metadata) return false;
  if (metadata.name) return true;
  // Legacy entries: only have infoUrl pointing to OpenStreetMap
  return !!metadata.infoUrl?.includes("openstreetmap.org");
}

/** Extract the place name from metadata or parse from Nominatim display_name. */
function getLocationName(text: string, metadata: OptionMetadataEntry): string {
  if (metadata.name) return metadata.name;
  // Parse from Nominatim display_name: "Name, Street, City, ..."
  const commaIdx = text.indexOf(", ");
  return commaIdx >= 0 ? text.slice(0, commaIdx) : text;
}

function getAddressFromLabel(label: string, name: string): string {
  if (label.startsWith(name + ", ")) {
    return label.slice(name.length + 2);
  }
  const commaIdx = label.indexOf(", ");
  return commaIdx >= 0 ? label.slice(commaIdx + 2) : "";
}

function formatDistance(miles: number): string {
  if (miles < 0.1) return "<0.1 mi";
  if (miles < 10) return `${miles.toFixed(1)} mi`;
  return `${Math.round(miles)} mi`;
}

export default function OptionLabel({ text, metadata, className = "" }: OptionLabelProps) {
  // Location entry: two-line display with icon
  if (isLocationEntry(metadata)) {
    const name = getLocationName(text, metadata!);
    const address = getAddressFromLabel(text, name);
    const distance = metadata!.distance_miles;

    const icon = metadata!.imageUrl ? (
      <img
        src={metadata!.imageUrl}
        alt=""
        className="w-5 h-5 rounded flex-shrink-0"
        loading="lazy"
      />
    ) : (
      <span className="text-blue-500 dark:text-blue-400 flex-shrink-0">
        <MapPinIcon className="w-4 h-4" />
      </span>
    );

    const inner = (
      <>
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <span className="font-medium leading-tight">{name}</span>
          {distance !== undefined && (
            <span className="text-xs text-blue-600 dark:text-blue-400 whitespace-nowrap">
              {formatDistance(distance)}
            </span>
          )}
        </div>
        {address && (
          <div className="text-xs text-gray-500 dark:text-gray-400 truncate leading-tight mt-0.5">
            {address}
          </div>
        )}
      </>
    );

    const wrapper = metadata!.infoUrl ? (
      <LongPressLink
        href={metadata!.infoUrl}
        className="min-w-0 overflow-hidden block cursor-default"
      >
        {inner}
      </LongPressLink>
    ) : (
      <div className="min-w-0 overflow-hidden">{inner}</div>
    );

    return (
      <div className={`flex items-center gap-2 ${className}`}>
        {icon}
        {wrapper}
      </div>
    );
  }

  // Non-location or no metadata: original behavior
  if (!metadata || (!metadata.imageUrl && !metadata.infoUrl)) {
    return <span className={className}>{text}</span>;
  }

  const content = (
    <>
      {metadata.imageUrl && (
        <img
          src={metadata.imageUrl}
          alt=""
          className="w-5 h-7 object-cover rounded flex-shrink-0"
          loading="lazy"
        />
      )}
      <span>{text}</span>
    </>
  );

  if (metadata.infoUrl) {
    return (
      <LongPressLink
        href={metadata.infoUrl}
        className={`inline-flex items-center gap-1.5 text-blue-600 dark:text-blue-400 cursor-default ${className}`}
      >
        {content}
      </LongPressLink>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      {content}
    </span>
  );
}
