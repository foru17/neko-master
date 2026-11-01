"use client";

import { useLocale } from "next-intl";
import { useMemo } from "react";

// Special non-ISO codes used in this app
const SPECIAL_NAMES: Record<string, Record<string, string>> = {
  LOCAL: { en: "Local", zh: "本地", ru: "Локальная сеть" },
  DIRECT: { en: "Direct", zh: "直连", ru: "Напрямую" },
  UNKNOWN: { en: "Unknown", zh: "未知", ru: "Неизвестно" },
  PRIVATE: { en: "Private", zh: "私有", ru: "Приватная сеть" },
  RESERVED: { en: "Reserved", zh: "保留", ru: "Зарезервированная сеть" },
};

// Override CLDR defaults for specific regions to ensure consistent display
// across different browser/OS CLDR versions
const REGION_OVERRIDES: Record<string, Record<string, string>> = {
  HK: { zh: "中国香港" },
  TW: { zh: "中国台湾" },
  MO: { zh: "中国澳门" },
};

const localeMap: Record<string, string> = {
  zh: "zh-Hans",
  en: "en",
  ru: "ru",
};

function createDisplayNames(locale: string): Intl.DisplayNames | null {
  try {
    return new Intl.DisplayNames([localeMap[locale] || locale], {
      type: "region",
    });
  } catch {
    return null;
  }
}

// Cache DisplayNames instances per locale
const displayNamesCache = new Map<string, Intl.DisplayNames | null>();

function getDisplayNames(locale: string): Intl.DisplayNames | null {
  if (!displayNamesCache.has(locale)) {
    displayNamesCache.set(locale, createDisplayNames(locale));
  }
  return displayNamesCache.get(locale)!;
}

/**
 * Get localized country/region name from ISO 3166-1 alpha-2 code.
 * Uses Intl.DisplayNames for standard codes and a small map for special app codes.
 */
export function getLocalizedCountryName(
  code: string,
  locale: string,
): string {
  if (!code) return "";

  const upper = code.toUpperCase();

  // Handle special non-ISO codes
  const special = SPECIAL_NAMES[upper];
  if (special) {
    return special[locale] || special.en || code;
  }

  // Check overrides before CLDR (consistent across environments)
  const override = REGION_OVERRIDES[upper];
  if (override?.[locale]) {
    return override[locale];
  }

  // Use Intl.DisplayNames for standard ISO country codes
  const displayNames = getDisplayNames(locale);
  if (displayNames) {
    try {
      const name = displayNames.of(upper);
      if (name) return name;
    } catch {
      // Invalid code, fall through
    }
  }

  return code;
}

/**
 * React hook that returns a memoized country name translator for the current locale.
 */
export function useCountryName() {
  const locale = useLocale();

  return useMemo(() => {
    return (code: string) => getLocalizedCountryName(code, locale);
  }, [locale]);
}
