"use client";

import { Capacitor } from "@capacitor/core";
import { apiGeocode } from "@/lib/api";
import { saveUserLocation, type Coords, type UserLocation } from "@/lib/userProfile";

export class GeolocationDeniedError extends Error {
  constructor() {
    super("Location access denied");
    this.name = "GeolocationDeniedError";
  }
}

interface GetCurrentPositionOptions {
  timeout?: number;
  enableHighAccuracy?: boolean;
}

const DEFAULT_OPTIONS: Required<GetCurrentPositionOptions> = {
  timeout: 10000,
  enableHighAccuracy: false,
};

// WKWebView in Capacitor doesn't route navigator.geolocation requests to
// Core Location — even with NSLocationWhenInUseUsageDescription, calls
// silently fail. The @capacitor/geolocation plugin bridges to native
// Core Location and prompts via the system permission sheet.
async function getNativePosition(options: Required<GetCurrentPositionOptions>): Promise<Coords> {
  const mod = await import("@capacitor/geolocation").catch(() => null);
  if (!mod?.Geolocation) {
    throw new Error("Native geolocation plugin is not installed");
  }
  let perms = await mod.Geolocation.checkPermissions();
  if (perms.location === "prompt" || perms.location === "prompt-with-rationale") {
    perms = await mod.Geolocation.requestPermissions({ permissions: ["location"] });
  }
  if (perms.location !== "granted") {
    throw new GeolocationDeniedError();
  }
  const pos = await mod.Geolocation.getCurrentPosition(options);
  return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
}

function getWebPosition(options: Required<GetCurrentPositionOptions>): Promise<Coords> {
  if (!navigator.geolocation) {
    return Promise.reject(new Error("Geolocation not supported"));
  }
  return new Promise<Coords>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          reject(new GeolocationDeniedError());
        } else {
          reject(new Error("Failed to get location"));
        }
      },
      options
    );
  });
}

export async function getCurrentPosition(
  options: GetCurrentPositionOptions = {}
): Promise<Coords> {
  const merged = { ...DEFAULT_OPTIONS, ...options };
  if (typeof window !== "undefined" && Capacitor.isNativePlatform()) {
    return getNativePosition(merged);
  }
  return getWebPosition(merged);
}

/** Detect, reverse-geocode, and persist the user's location. Throws
 *  `GeolocationDeniedError` if permission is refused, generic `Error`
 *  otherwise. Callers handle their own UI state (input clear, message
 *  wording). */
export async function detectAndSaveUserLocation(): Promise<UserLocation> {
  const { latitude, longitude } = await getCurrentPosition();
  const result = await apiGeocode(`${latitude}, ${longitude}`);
  const label = result?.label || `${latitude.toFixed(2)}, ${longitude.toFixed(2)}`;
  const loc: UserLocation = { latitude, longitude, label };
  saveUserLocation(loc);
  return loc;
}
