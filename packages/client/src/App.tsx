import { useEffect, useState } from "react";

type Health = { ok: boolean; service: string };

export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<Health>;
      })
      .then(setHealth)
      .catch((e: Error) => setErr(e.message));
  }, []);

  return (
    <main className="main">
      <h1>Bazaar</h1>
      <p className="lede">React + Vite in dev; Hono serves this app in production.</p>
      <section className="card">
        <h2>API</h2>
        {err && <p className="error">Could not reach /api/health: {err}</p>}
        {health && (
          <pre className="pre">{JSON.stringify(health, null, 2)}</pre>
        )}
      </section>
    </main>
  );
}
