"use client";

import { useEffect, useState } from "react";

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

const STORAGE_KEY = "consent";
const GA_ID = process.env.NEXT_PUBLIC_GA_ID;

export function ConsentBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!GA_ID) return;
    try {
      if (localStorage.getItem(STORAGE_KEY) === null) {
        setShow(true);
      }
    } catch {
      // localStorage unavailable (e.g. privacy mode) — leave banner hidden.
    }
  }, []);

  if (!show) return null;

  function decide(value: "granted" | "denied") {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // ignore
    }
    window.gtag?.("consent", "update", {
      ad_storage: value,
      ad_user_data: value,
      ad_personalization: value,
      analytics_storage: value,
    });
    setShow(false);
  }

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      style={{
        position: "fixed",
        bottom: 16,
        left: 16,
        right: 16,
        maxWidth: 480,
        margin: "0 auto",
        padding: "1rem 1.25rem",
        background: "#fff",
        color: "#111",
        border: "1px solid #ddd",
        borderRadius: 8,
        boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
        fontFamily: "system-ui, -apple-system, sans-serif",
        fontSize: 14,
        lineHeight: 1.5,
        zIndex: 1000,
      }}
    >
      <p style={{ margin: "0 0 0.75rem 0" }}>
        We use analytics to understand how this site is used. Until you accept,
        analytics runs in cookieless mode.
      </p>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={() => decide("denied")}
          style={buttonStyle(false)}
        >
          Decline
        </button>
        <button
          type="button"
          onClick={() => decide("granted")}
          style={buttonStyle(true)}
        >
          Accept
        </button>
      </div>
    </div>
  );
}

function buttonStyle(primary: boolean): React.CSSProperties {
  return {
    padding: "0.5rem 1rem",
    border: primary ? "none" : "1px solid #ccc",
    background: primary ? "#111" : "#fff",
    color: primary ? "#fff" : "#111",
    borderRadius: 4,
    cursor: "pointer",
    fontSize: 14,
  };
}
