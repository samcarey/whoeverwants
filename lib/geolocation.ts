"use client";

import { Capacitor } from "@capacitor/core";

export interface Coords {
  latitude: number;
  longitude: number;
}

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

// WKWebView in Capacitor doesn't route navigator.geolocation requests to
// Core Location — even with NSLocationWhenInUseUsageDescription, calls
// silently fail. The @capacitor/geolocation plugin bridges to native
// Core Location and prompts via the system permission sheet.
async function getNativePosition(options: GetCurrentPositionOptions): Promise<Coords> {
  const mod = await import("@capacitor/geolocation").catch(() => null);
  if (!mod || !mod.Geolocation) {
    throw new Error("Native geolocation plugin is not installed");
  }
  const Geolocation = mod.Geolocation;

  let perms = await Geolocation.checkPermissions();
  if (perms.location === "prompt" || perms.location === "prompt-with-rationale") {
    perms = await Geolocation.requestPermissions({ permissions: ["location"] });
  }
  if (perms.location !== "granted") {
    throw new GeolocationDeniedError();
  }

  const pos = await Geolocation.getCurrentPosition({
    enableHighAccuracy: options.enableHighAccuracy ?? false,
    timeout: options.timeout ?? 10000,
  });
  return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
}

function getWebPosition(options: GetCurrentPositionOptions): Promise<Coords> {
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
      {
        enableHighAccuracy: options.enableHighAccuracy ?? false,
        timeout: options.timeout ?? 10000,
      }
    );
  });
}

export async function getCurrentPosition(
  options: GetCurrentPositionOptions = {}
): Promise<Coords> {
  if (typeof window !== "undefined" && Capacitor.isNativePlatform()) {
    return getNativePosition(options);
  }
  return getWebPosition(options);
}
