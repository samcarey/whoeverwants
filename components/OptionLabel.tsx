"use client";

import type { OptionMetadataEntry } from "@/lib/types";

interface OptionLabelProps {
  text: string;
  metadata?: OptionMetadataEntry | null;
  className?: string;
}

function MapPinIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path fillRule="evenodd" clipRule="evenodd" d="M12 2C7.58 2 4 5.58 4 10c0 5.25 7.13 11.38 7.43 11.63a1 1 0 001.14 0C12.87 21.38 20 15.25 20 10c0-4.42-3.58-8-8-8zm0 11a3 3 0 110-6 3 3 0 010 6z" />
    </svg>
  );
}

/** Detect if metadata represents a location (has OSM infoUrl or name). */
export function isLocationEntry(metadata: OptionMetadataEntry | null | undefined): boolean {
  if (!metadata) return false;
  if (metadata.name) return true;
  return !!metadata.infoUrl?.includes("openstreetmap.org");
}

/** Extract the place name from metadata or parse from Nominatim display_name. */
function getLocationName(text: string, metadata: OptionMetadataEntry): string {
  if (metadata.name) return metadata.name;
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
        className="w-5 h-5 rounded"
        loading="lazy"
      />
    ) : (
      <span className="text-blue-500 dark:text-blue-400">
        <MapPinIcon className="w-4 h-4" />
      </span>
    );

    const nameEl = metadata!.infoUrl ? (
      <a
        href={metadata!.infoUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="font-medium leading-tight underline decoration-blue-400/50 hover:decoration-blue-500"
      >
        {name}
      </a>
    ) : (
      <span className="font-medium leading-tight">{name}</span>
    );

    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <span className="flex-shrink-0 w-7 h-7 flex items-center justify-center">{icon}</span>
        <div className="min-w-0 overflow-hidden">
          <div className="flex items-baseline gap-1.5 flex-wrap">
            {nameEl}
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
        </div>
      </div>
    );
  }

  // Non-location or no metadata: original behavior
  if (!metadata || (!metadata.imageUrl && !metadata.infoUrl)) {
    return <span className={className}>{text}</span>;
  }

  // Typed option with image and/or link (movies, video games, etc.)
  const imageEl = metadata.imageUrl ? (
    <img
      src={metadata.imageUrl}
      alt=""
      className="w-5 h-7 object-cover rounded"
      loading="lazy"
    />
  ) : null;

  if (metadata.infoUrl) {
    return (
      <span className={`inline-flex items-center gap-1.5 ${className}`}>
        {imageEl && <span className="flex-shrink-0 w-7 h-7 flex items-center justify-center">{imageEl}</span>}
        <a
          href={metadata.infoUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="underline decoration-blue-400/50 hover:decoration-blue-500"
        >
          {text}
        </a>
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      {imageEl && <span className="flex-shrink-0 w-7 h-7 flex items-center justify-center">{imageEl}</span>}
      <span>{text}</span>
    </span>
  );
}
