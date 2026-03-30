"use client";

import { useState } from "react";
import type { OptionMetadataEntry } from "@/lib/types";
import PlaceDetailModal from "./PlaceDetailModal";

interface OptionLabelProps {
  text: string;
  metadata?: OptionMetadataEntry | null;
  className?: string;
  /** "inline" (default): icon left, text right. "stacked": icon+distance top, name, address vertically. */
  layout?: "inline" | "stacked";
}

function MapPinIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path fillRule="evenodd" clipRule="evenodd" d="M12 2C7.58 2 4 5.58 4 10c0 5.25 7.13 11.38 7.43 11.63a1 1 0 001.14 0C12.87 21.38 20 15.25 20 10c0-4.42-3.58-8-8-8zm0 11a3 3 0 110-6 3 3 0 010 6z" />
    </svg>
  );
}

/** Detect if metadata represents a restaurant (has rating or cuisine). */
export function isRestaurantEntry(metadata: OptionMetadataEntry | null | undefined): boolean {
  if (!metadata) return false;
  return metadata.rating !== undefined || !!metadata.cuisine;
}

/** Detect if metadata represents a location (has OSM infoUrl or name). */
export function isLocationEntry(metadata: OptionMetadataEntry | null | undefined): boolean {
  if (!metadata) return false;
  if (isRestaurantEntry(metadata)) return false; // restaurants handled separately
  if (metadata.name) return true;
  return !!metadata.infoUrl?.includes("openstreetmap.org");
}

/** Extract the place name from metadata or parse from Nominatim display_name. */
function getLocationName(text: string, metadata: OptionMetadataEntry): string {
  if (metadata.name) return metadata.name;
  const commaIdx = text.indexOf(", ");
  return commaIdx >= 0 ? text.slice(0, commaIdx) : text;
}

export function getAddressFromLabel(label: string, name: string): string {
  if (label.startsWith(name + ", ")) {
    return label.slice(name.length + 2);
  }
  const commaIdx = label.indexOf(", ");
  return commaIdx >= 0 ? label.slice(commaIdx + 2) : "";
}

export function formatDistance(miles: number): string {
  if (miles < 0.1) return "<0.1 mi";
  if (miles < 10) return `${miles.toFixed(1)} mi`;
  return `${Math.round(miles)} mi`;
}

function LocationIcon({ imageUrl, size = "sm" }: { imageUrl?: string; size?: "sm" | "lg" }) {
  const imgClass = size === "lg" ? "w-10 h-10 rounded" : "w-5 h-5 rounded";
  const pinClass = size === "lg" ? "w-8 h-8" : "w-4 h-4";
  if (imageUrl) {
    return <img src={imageUrl} alt="" className={imgClass} loading="lazy" />;
  }
  return (
    <span className="text-blue-500 dark:text-blue-400">
      <MapPinIcon className={pinClass} />
    </span>
  );
}

/** Clickable place name that opens the detail modal. */
function PlaceName({ name, hasModal }: { name: string; hasModal: boolean }) {
  if (hasModal) {
    return (
      <span className="font-medium leading-tight underline decoration-2 decoration-blue-400/50 cursor-pointer">
        {name}
      </span>
    );
  }
  return <span className="font-medium leading-tight">{name}</span>;
}

export function StarRating({ rating }: { rating: number }) {
  return (
    <span className="text-yellow-500 dark:text-yellow-400 whitespace-nowrap">
      {'★'.repeat(Math.floor(rating))}{rating % 1 >= 0.5 ? '½' : ''}
      <span className="text-xs ml-0.5">{rating}</span>
    </span>
  );
}

function RestaurantIcon({ imageUrl, size = "sm" }: { imageUrl?: string; size?: "sm" | "lg" }) {
  if (imageUrl) {
    const imgClass = size === "lg" ? "w-10 h-10 rounded object-cover" : "w-7 h-7 rounded object-cover";
    return <img src={imageUrl} alt="" className={imgClass} loading="lazy" />;
  }
  const textClass = size === "lg" ? "text-2xl" : "text-base";
  return <span className={textClass}>🍽️</span>;
}

/** Wrapper that adds modal behavior to place/restaurant entries. */
function PlaceWrapper({
  children,
  text,
  name,
  metadata,
  className,
}: {
  children: React.ReactNode;
  text: string;
  name: string;
  metadata: OptionMetadataEntry;
  className?: string;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const address = getAddressFromLabel(text, name);
  const hasCoords = metadata.lat && metadata.lon;

  return (
    <>
      <div
        className={className}
        onClick={(e) => {
          if (hasCoords) {
            e.stopPropagation();
            setModalOpen(true);
          }
        }}
        style={hasCoords ? { cursor: "pointer" } : undefined}
      >
        {children}
      </div>
      {hasCoords && (
        <PlaceDetailModal
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          name={name}
          address={address}
          metadata={metadata}
        />
      )}
    </>
  );
}

export default function OptionLabel({ text, metadata, className = "", layout = "inline" }: OptionLabelProps) {
  // Restaurant entry
  if (isRestaurantEntry(metadata)) {
    const name = metadata!.name || text.split(", ")[0];
    const distance = metadata!.distance_miles;
    const hasCoords = !!(metadata!.lat && metadata!.lon);

    if (layout === "stacked") {
      return (
        <PlaceWrapper text={text} name={name} metadata={metadata!} className={`min-w-0 overflow-hidden ${className}`}>
          <div className="flex justify-center">
            <span className="flex-shrink-0 w-10 h-10 flex items-center justify-center">
              <RestaurantIcon imageUrl={metadata!.imageUrl} size="lg" />
            </span>
          </div>
          <div className="line-clamp-2 leading-tight mt-1 text-center">
            <PlaceName name={name} hasModal={hasCoords} />
          </div>
          {distance !== undefined && (
            <div className="text-xs text-blue-600 dark:text-blue-400 mt-0.5 text-center">
              {formatDistance(distance)}
            </div>
          )}
        </PlaceWrapper>
      );
    }

    // Default inline layout
    return (
      <PlaceWrapper text={text} name={name} metadata={metadata!} className={`flex items-center gap-2 ${className}`}>
        <span className="flex-shrink-0 w-7 h-7 flex items-center justify-center">
          <RestaurantIcon imageUrl={metadata!.imageUrl} />
        </span>
        <div className="min-w-0 overflow-hidden">
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <PlaceName name={name} hasModal={hasCoords} />
            {distance !== undefined && (
              <span className="text-xs text-blue-600 dark:text-blue-400 whitespace-nowrap">
                {formatDistance(distance)}
              </span>
            )}
          </div>
        </div>
      </PlaceWrapper>
    );
  }

  // Location entry
  if (isLocationEntry(metadata)) {
    const name = getLocationName(text, metadata!);
    const address = getAddressFromLabel(text, name);
    const distance = metadata!.distance_miles;
    const hasCoords = !!(metadata!.lat && metadata!.lon);

    if (layout === "stacked") {
      return (
        <PlaceWrapper text={text} name={name} metadata={metadata!} className={`min-w-0 overflow-hidden ${className}`}>
          <div className="flex justify-center">
            <span className="flex-shrink-0 w-10 h-10 flex items-center justify-center">
              <LocationIcon imageUrl={metadata!.imageUrl} size="lg" />
            </span>
          </div>
          <div className="line-clamp-2 leading-tight mt-1 text-center">
            <PlaceName name={name} hasModal={hasCoords} />
          </div>
          {address && (
            <div className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 leading-tight mt-0.5 text-center">
              {address}
            </div>
          )}
          {distance !== undefined && (
            <div className="text-xs text-blue-600 dark:text-blue-400 mt-0.5 text-center">
              {formatDistance(distance)}
            </div>
          )}
        </PlaceWrapper>
      );
    }

    // Default inline layout
    return (
      <PlaceWrapper text={text} name={name} metadata={metadata!} className={`flex items-center gap-2 ${className}`}>
        <span className="flex-shrink-0 w-7 h-7 flex items-center justify-center">
          <LocationIcon imageUrl={metadata!.imageUrl} />
        </span>
        <div className="min-w-0 overflow-hidden">
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <PlaceName name={name} hasModal={hasCoords} />
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
      </PlaceWrapper>
    );
  }

  // Non-location or no metadata: original behavior
  if (!metadata || (!metadata.imageUrl && !metadata.infoUrl)) {
    return <span className={className}>{text}</span>;
  }

  // Stacked layout for movies, video games, etc.
  if (layout === "stacked") {
    const displayName = text.replace(/\s*\(.*\)\s*$/, '').trim() || text;
    const yearMatch = text.match(/\((\d{4})\)/);
    const year = yearMatch ? yearMatch[1] : null;
    const nameEl = metadata.infoUrl ? (
      <a
        href={metadata.infoUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="font-medium leading-tight underline decoration-2 decoration-blue-400/50 hover:decoration-blue-500"
      >
        {displayName}
      </a>
    ) : (
      <span className="font-medium leading-tight">{displayName}</span>
    );

    return (
      <div className={`min-w-0 overflow-hidden ${className}`}>
        {metadata.imageUrl && (
          <div className="flex justify-center">
            <img
              src={metadata.imageUrl}
              alt=""
              className="w-12 h-16 object-cover rounded"
              loading="lazy"
            />
          </div>
        )}
        <div className="line-clamp-2 leading-tight mt-1 text-center">
          {nameEl}
        </div>
        {year && (
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 text-center">
            {year}
          </div>
        )}
      </div>
    );
  }

  // Default inline layout
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
          className="underline decoration-2 decoration-blue-400/50 hover:decoration-blue-500"
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
