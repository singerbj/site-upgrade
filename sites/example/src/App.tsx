export function App() {
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
      <h1>Example Site</h1>
      <p>
        This is a Vite SPA hosted on Cloudflare via R2 + a router Worker. Each
        site in this monorepo deploys independently to its own subdomain.
      </p>
    </main>
  );
}
