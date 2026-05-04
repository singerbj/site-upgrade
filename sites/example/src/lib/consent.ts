declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

export const STORAGE_KEY = "consent";
export type ConsentValue = "granted" | "denied";

const ALL_CATEGORIES = [
  "ad_storage",
  "ad_user_data",
  "ad_personalization",
  "analytics_storage",
] as const;

function pushConsent(value: ConsentValue): void {
  if (typeof window === "undefined" || !window.gtag) return;
  const payload: Record<string, ConsentValue> = {};
  for (const k of ALL_CATEGORIES) payload[k] = value;
  window.gtag("consent", "update", payload);
}

export function setConsent(value: ConsentValue): void {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // localStorage unavailable; gtag still updates for the current session.
  }
  pushConsent(value);
}

export function getConsent(): ConsentValue | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "granted" || v === "denied" ? v : null;
  } catch {
    return null;
  }
}

export function clearConsent(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  pushConsent("denied");
}
