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

function getAddressFromLabel(label: string, name: string): string {
  // Remove the name prefix from the full label to get just the address
  if (label.startsWith(name + ", ")) {
    return label.slice(name.length + 2);
  }
  // If name isn't at the start, return everything after first comma
  const commaIdx = label.indexOf(", ");
  return commaIdx >= 0 ? label.slice(commaIdx + 2) : label;
}

function formatDistance(miles: number): string {
  if (miles < 0.1) return "<0.1 mi";
  if (miles < 10) return `${miles.toFixed(1)} mi`;
  return `${Math.round(miles)} mi`;
}

export default function OptionLabel({ text, metadata, className = "" }: OptionLabelProps) {
  // Location with rich metadata: two-line display
  if (metadata?.name) {
    const address = getAddressFromLabel(text, metadata.name);
    const distance = metadata.distance_miles;

    const icon = metadata.imageUrl ? (
      <img
        src={metadata.imageUrl}
        alt=""
        className="w-5 h-5 rounded flex-shrink-0 mt-0.5"
        loading="lazy"
      />
    ) : (
      <span className="text-blue-500 dark:text-blue-400 flex-shrink-0 mt-0.5">
        <MapPinIcon className="w-4 h-4" />
      </span>
    );

    const content = (
      <span className={`inline-flex items-start gap-2 ${className}`}>
        {icon}
        <span className="min-w-0">
          <span className="flex items-baseline gap-1.5 flex-wrap">
            <span className="font-medium leading-tight">{metadata.name}</span>
            {distance !== undefined && (
              <span className="text-xs text-blue-600 dark:text-blue-400 whitespace-nowrap">
                {formatDistance(distance)}
              </span>
            )}
          </span>
          <span className="block text-xs text-gray-500 dark:text-gray-400 truncate leading-tight mt-0.5">
            {address}
          </span>
        </span>
      </span>
    );

    if (metadata.infoUrl) {
      return (
        <a
          href={metadata.infoUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="hover:underline"
        >
          {content}
        </a>
      );
    }

    return content;
  }

  // Non-location or no rich metadata: original behavior
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
      <a
        href={metadata.infoUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className={`inline-flex items-center gap-1.5 text-blue-600 dark:text-blue-400 hover:underline ${className}`}
      >
        {content}
      </a>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      {content}
    </span>
  );
}
