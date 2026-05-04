"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { type ConsentValue, getConsent, setConsent } from "../lib/consent";

const GA_ID = process.env.NEXT_PUBLIC_GA_ID;

export function ConsentBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!GA_ID) return;
    if (getConsent() === null) setShow(true);
  }, []);

  if (!show) return null;

  function decide(value: ConsentValue) {
    setConsent(value);
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
        analytics runs in cookieless mode.{" "}
        <Link href="/privacy/" style={{ color: "#111" }}>
          Learn more
        </Link>
        .
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
