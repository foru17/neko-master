import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

type Messages = { [key: string]: string | Messages };

// Community locales may lag behind new strings; fill any missing key from
// English so the UI never shows a raw message key.
function withFallback(base: Messages, override: Messages): Messages {
  const result: Messages = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const baseValue = base[key];
    result[key] =
      typeof value === "object" && value !== null && typeof baseValue === "object" && baseValue !== null
        ? withFallback(baseValue, value)
        : value;
  }
  return result;
}

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;

  if (!locale || !routing.locales.includes(locale as any)) {
    locale = routing.defaultLocale;
  }

  const messages: Messages = (await import(`../messages/${locale}.json`)).default;
  if (locale === "en") {
    return { locale, messages };
  }

  const english: Messages = (await import("../messages/en.json")).default;
  return { locale, messages: withFallback(english, messages) };
});
