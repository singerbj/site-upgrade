import Link from "next/link";

export default function NotFound() {
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
      <h1>404</h1>
      <p>This page could not be found.</p>
      <Link href="/">Return home</Link>
    </main>
  );
}
