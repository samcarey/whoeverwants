"use client";

import { useEffect } from "react";
import ModalPortal from "./ModalPortal";
import type { OptionMetadataEntry } from "@/lib/types";
import { formatDistance } from "./OptionLabel";

interface PlaceDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  name: string;
  address: string;
  metadata: OptionMetadataEntry;
}

export default function PlaceDetailModal({
  isOpen,
  onClose,
  name,
  address,
  metadata,
}: PlaceDetailModalProps) {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) onClose();
    };
    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "unset";
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const lat = metadata.lat;
  const lon = metadata.lon;
  const hasCoords = lat && lon;

  // OSM embed URL with marker
  const embedUrl = hasCoords
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${Number(lon) - 0.005},${Number(lat) - 0.003},${Number(lon) + 0.005},${Number(lat) + 0.003}&layer=mapnik&marker=${lat},${lon}`
    : null;

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-black/50 dark:bg-black/70"
          onClick={onClose}
        />

        {/* Modal */}
        <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-sm w-full overflow-hidden">
          {/* Map preview */}
          {embedUrl && (
            <a
              href={metadata.infoUrl || "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="block"
            >
              <iframe
                src={embedUrl}
                className="w-full h-48 border-0 pointer-events-none"
                loading="lazy"
                title={`Map of ${name}`}
              />
            </a>
          )}

          {/* Details */}
          <div className="px-4 py-3">
            {/* Name + icon */}
            <div className="flex items-center gap-2.5">
              {metadata.imageUrl && (
                <img
                  src={metadata.imageUrl}
                  alt=""
                  className="w-8 h-8 rounded object-cover flex-shrink-0"
                />
              )}
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white leading-tight">
                {name}
              </h3>
            </div>

            {/* Metadata row */}
            <div className="flex items-center gap-2 mt-1.5 text-sm text-gray-500 dark:text-gray-400 flex-wrap">
              {metadata.cuisine && <span>{metadata.cuisine}</span>}
              {metadata.cuisine && metadata.distance_miles !== undefined && (
                <span>·</span>
              )}
              {metadata.distance_miles !== undefined && (
                <span className="text-blue-600 dark:text-blue-400">
                  {formatDistance(metadata.distance_miles)}
                </span>
              )}
            </div>

            {/* Address — opens native maps app on mobile */}
            {address && hasCoords && (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${lat},${lon}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block mt-1.5 text-sm text-blue-600 dark:text-blue-400 underline decoration-1 underline-offset-2"
              >
                {address}
              </a>
            )}
            {address && !hasCoords && (
              <p className="mt-1.5 text-sm text-gray-500 dark:text-gray-400">
                {address}
              </p>
            )}

          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
