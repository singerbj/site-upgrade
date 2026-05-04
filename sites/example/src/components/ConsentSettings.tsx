"use client";

import { useEffect, useState } from "react";
import {
  type ConsentValue,
  clearConsent,
  getConsent,
  setConsent,
} from "../lib/consent";

export function ConsentSettings() {
  const [current, setCurrent] = useState<ConsentValue | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setCurrent(getConsent());
    setHydrated(true);
  }, []);

  function update(value: ConsentValue) {
    setConsent(value);
    setCurrent(value);
  }

  function reset() {
    clearConsent();
    setCurrent(null);
  }

  return (
    <div>
      <p style={{ margin: "0 0 0.75rem 0" }}>
        Current setting:{" "}
        <strong>{hydrated ? (current ?? "no decision") : "…"}</strong>
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button type="button" onClick={() => update("granted")} style={btn}>
          Accept analytics cookies
        </button>
        <button type="button" onClick={() => update("denied")} style={btn}>
          Decline analytics cookies
        </button>
        <button type="button" onClick={reset} style={btn}>
          Reset choice
        </button>
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  padding: "0.5rem 1rem",
  border: "1px solid #ccc",
  background: "#fff",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 14,
};
