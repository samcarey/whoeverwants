"use client";

import { useEffect, useState } from "react";
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

function AddressActionsModal({
  isOpen,
  onClose,
  name,
  address,
}: {
  isOpen: boolean;
  onClose: () => void;
  name: string;
  address: string;
}) {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) onClose();
    };
    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
    }
    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const query = encodeURIComponent(name + ", " + address);

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[60] flex items-end justify-center p-4 pb-8">
        <div
          className="absolute inset-0 bg-black/50 dark:bg-black/70"
          onClick={onClose}
        />
        <div className="relative w-full max-w-sm flex flex-col gap-2">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl overflow-hidden">
            <a
              href={`https://maps.apple.com/?q=${query}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onClose}
              className="block w-full px-4 py-3 text-center text-blue-600 dark:text-blue-400 font-medium border-b border-gray-200 dark:border-gray-700 active:bg-gray-100 dark:active:bg-gray-700"
            >
              Open in Maps
            </a>
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${query}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onClose}
              className="block w-full px-4 py-3 text-center text-blue-600 dark:text-blue-400 font-medium border-b border-gray-200 dark:border-gray-700 active:bg-gray-100 dark:active:bg-gray-700"
            >
              Open in Google Maps
            </a>
            <button
              onClick={() => {
                navigator.clipboard.writeText(name + ", " + address);
                onClose();
              }}
              className="block w-full px-4 py-3 text-center text-blue-600 dark:text-blue-400 font-medium active:bg-gray-100 dark:active:bg-gray-700"
            >
              Copy Address
            </button>
          </div>
          <button
            onClick={onClose}
            className="w-full px-4 py-3 bg-white dark:bg-gray-800 rounded-xl shadow-xl text-center text-blue-600 dark:text-blue-400 font-semibold active:bg-gray-100 dark:active:bg-gray-700"
          >
            Cancel
          </button>
        </div>
      </div>
    </ModalPortal>
  );
}

export default function PlaceDetailModal({
  isOpen,
  onClose,
  name,
  address,
  metadata,
}: PlaceDetailModalProps) {
  const [addressModalOpen, setAddressModalOpen] = useState(false);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen && !addressModalOpen) onClose();
    };
    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "unset";
    };
  }, [isOpen, addressModalOpen, onClose]);

  if (!isOpen) return null;

  const lat = metadata.lat;
  const lon = metadata.lon;
  const hasCoords = lat && lon;

  const embedUrl = hasCoords
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${Number(lon) - 0.005},${Number(lat) - 0.003},${Number(lon) + 0.005},${Number(lat) + 0.003}&layer=mapnik&marker=${lat},${lon}`
    : null;

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="absolute inset-0 bg-black/50 dark:bg-black/70"
          onClick={onClose}
        />

        <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-sm w-full overflow-hidden">
          {embedUrl && (
            <iframe
              src={embedUrl}
              className="w-full h-48 border-0"
              loading="lazy"
              title={`Map of ${name}`}
              style={{ pointerEvents: "none" }}
            />
          )}

          <div className="px-4 py-3">
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

            {address && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setAddressModalOpen(true);
                }}
                className="block mt-1.5 text-sm text-blue-600 dark:text-blue-400 underline decoration-1 underline-offset-2 text-left"
              >
                {address}
              </button>
            )}
          </div>
        </div>
      </div>

      <AddressActionsModal
        isOpen={addressModalOpen}
        onClose={() => setAddressModalOpen(false)}
        name={name}
        address={address}
      />
    </ModalPortal>
  );
}
