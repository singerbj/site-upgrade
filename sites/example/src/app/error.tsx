"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main
      style={{
        fontFamily: "system-ui, -apple-system, sans-serif",
        padding: "2rem",
        maxWidth: 720,
        margin: "0 auto",
        lineHeight: 1.6,
      }}
    >
      <h1>Something went wrong</h1>
      <p>An unexpected error occurred while rendering this page.</p>
      <button
        type="button"
        onClick={reset}
        style={{
          padding: "0.5rem 1rem",
          border: "1px solid #ccc",
          background: "#fff",
          borderRadius: 4,
          cursor: "pointer",
        }}
      >
        Try again
      </button>
    </main>
  );
}
