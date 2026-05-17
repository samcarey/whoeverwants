"use client";

import { Capacitor } from "@capacitor/core";

// Haptic feedback for significant user actions (commits, confirmations,
// destructive intents). Routes to @capacitor/haptics on native iOS so
// WKWebView gets Core Haptics, falls back to navigator.vibrate on
// Android/PWA. iOS Safari ignores the Vibration API entirely, so without
// the Capacitor route every call is a no-op on iOS.

type ImpactStyleKey = "Light" | "Medium" | "Heavy";
type NotificationTypeKey = "Success" | "Warning" | "Error";

interface HapticsBridge {
  impact(style: ImpactStyleKey): Promise<void>;
  notification(type: NotificationTypeKey): Promise<void>;
}

let bridgePromise: Promise<HapticsBridge | null> | null = null;

async function loadBridge(): Promise<HapticsBridge | null> {
  if (!bridgePromise) {
    bridgePromise = import("@capacitor/haptics")
      .then((mod): HapticsBridge => ({
        impact: (style: ImpactStyleKey) =>
          mod.Haptics.impact({ style: mod.ImpactStyle[style] }),
        notification: (type: NotificationTypeKey) =>
          mod.Haptics.notification({ type: mod.NotificationType[type] }),
      }))
      .catch(() => null);
  }
  return bridgePromise;
}

function webFallback(durationMs: number) {
  if (typeof navigator === "undefined") return;
  if (typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(durationMs);
  } catch {}
}

async function fireImpact(style: ImpactStyleKey, fallbackMs: number) {
  if (typeof window === "undefined") return;
  if (Capacitor.isNativePlatform()) {
    const bridge = await loadBridge();
    if (bridge) {
      try {
        await bridge.impact(style);
        return;
      } catch {
        // fall through to web fallback
      }
    }
  }
  webFallback(fallbackMs);
}

async function fireNotification(type: NotificationTypeKey, fallbackMs: number) {
  if (typeof window === "undefined") return;
  if (Capacitor.isNativePlatform()) {
    const bridge = await loadBridge();
    if (bridge) {
      try {
        await bridge.notification(type);
        return;
      } catch {}
    }
  }
  webFallback(fallbackMs);
}

export const haptic = {
  light: () => void fireImpact("Light", 10),
  medium: () => void fireImpact("Medium", 20),
  heavy: () => void fireImpact("Heavy", 35),
  success: () => void fireNotification("Success", 30),
  warning: () => void fireNotification("Warning", 40),
  error: () => void fireNotification("Error", 50),
};
