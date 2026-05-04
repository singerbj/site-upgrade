"use client";

import { useEffect, useState } from "react";
import {
  type ConsentValue,
  clearConsent,
  getConsent,
  isGpcEnabled,
  setConsent,
} from "../lib/consent";

export function ConsentSettings() {
  const [current, setCurrent] = useState<ConsentValue | null>(null);
  const [gpc, setGpc] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setCurrent(getConsent());
    setGpc(isGpcEnabled());
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

  const effective = gpc
    ? "denied (Global Privacy Control)"
    : (current ?? "no decision");

  return (
    <div>
      <p style={{ margin: "0 0 0.75rem 0" }}>
        Current setting: <strong>{hydrated ? effective : "…"}</strong>
      </p>
      {gpc ? (
        <p style={{ margin: "0 0 0.75rem 0", fontSize: 13, opacity: 0.8 }}>
          Your browser is sending Global Privacy Control. Analytics will stay
          denied for this session regardless of any choice below. Disable GPC in
          your browser settings if you want to grant consent.
        </p>
      ) : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button
          type="button"
          onClick={() => update("granted")}
          disabled={gpc}
          style={btn(gpc)}
        >
          Accept analytics cookies
        </button>
        <button
          type="button"
          onClick={() => update("denied")}
          style={btn(false)}
        >
          Decline analytics cookies
        </button>
        <button type="button" onClick={reset} style={btn(false)}>
          Reset choice
        </button>
      </div>
    </div>
  );
}

function btn(disabled: boolean): React.CSSProperties {
  return {
    padding: "0.5rem 1rem",
    border: "1px solid #ccc",
    background: "#fff",
    borderRadius: 4,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    fontSize: 14,
  };
}
