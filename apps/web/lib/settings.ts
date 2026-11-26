"use client";

import { useCallback, useSyncExternalStore } from "react";

export type FaviconProvider = "google" | "faviconim" | "off";

/**
 * What the dashboard shows while several backends are collecting: the active
 * backend, or every collecting backend merged. The choice is remembered;
 * "merged" only takes effect with two or more collecting backends.
 */
export type BackendView = "single" | "merged";

export interface UserSettings {
  faviconProvider: FaviconProvider;
  backendView: BackendView;
}

const DEFAULT_SETTINGS: UserSettings = {
  faviconProvider: "faviconim",
  backendView: "merged",
};

const STORAGE_KEY = "neko-master-settings";

// Cached settings for sync access
let cachedSettings: UserSettings = DEFAULT_SETTINGS;
let isClient = false;

// Initialize cache (only runs once)
function initCache() {
  if (typeof window === "undefined") return;
  isClient = true;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      cachedSettings = { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch {
    // Ignore parse errors
  }
}

// Get settings from cache (sync, returns same reference if unchanged)
function getCachedSettings(): UserSettings {
  if (typeof window === "undefined") {
    return DEFAULT_SETTINGS;
  }
  if (!isClient) {
    initCache();
  }
  return cachedSettings;
}

// Get settings from localStorage (force refresh)
export function getSettings(): UserSettings {
  if (typeof window === "undefined") {
    return DEFAULT_SETTINGS;
  }
  
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      const settings = { ...DEFAULT_SETTINGS, ...parsed };
      cachedSettings = settings; // Update cache
      return settings;
    }
  } catch {
    // Ignore parse errors
  }
  
  return DEFAULT_SETTINGS;
}

// Save settings to localStorage
export function saveSettings(settings: Partial<UserSettings>): void {
  if (typeof window === "undefined") {
    return;
  }
  
  try {
    const current = getSettings();
    const updated = { ...current, ...settings };
    cachedSettings = updated; // Update cache immediately
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    
    // Dispatch event to notify components
    window.dispatchEvent(new CustomEvent("settings-changed", { detail: updated }));
  } catch {
    // Ignore storage errors
  }
}

// Subscribe to settings changes
function subscribe(callback: () => void) {
  const handler = () => {
    // Update cache when settings change
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        cachedSettings = { ...DEFAULT_SETTINGS, ...parsed };
      }
    } catch {
      // Ignore parse errors
    }
    callback();
  };
  window.addEventListener("settings-changed", handler);
  return () => window.removeEventListener("settings-changed", handler);
}

// Snapshot function that returns cached value (must be same reference if unchanged)
function getSnapshot(): UserSettings {
  return getCachedSettings();
}

// Server snapshot
function getServerSnapshot(): UserSettings {
  return DEFAULT_SETTINGS;
}

// React hook for settings using useSyncExternalStore for instant sync
export function useSettings() {
  // useSyncExternalStore already returns a stable snapshot reference;
  // it only changes when the subscribe callback fires and getSnapshot
  // returns a different value (cachedSettings is replaced in saveSettings).
  const settings = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot
  );

  const setSettings = useCallback((newSettings: Partial<UserSettings>) => {
    saveSettings(newSettings);
  }, []);

  return { settings, setSettings, mounted: true };
}

// Generate favicon URL based on provider
export function getFaviconUrl(domain: string, provider: FaviconProvider): string {
  if (provider === "off") {
    return "";
  }
  const cleanDomain = domain
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];

  switch (provider) {
    case "faviconim":
      return `https://favicon.im/${encodeURIComponent(cleanDomain)}?larger=true`;
    case "google":
    default:
      return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(cleanDomain)}&sz=128`;
  }
}
