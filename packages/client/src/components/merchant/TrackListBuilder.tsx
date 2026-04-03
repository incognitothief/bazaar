import { useEffect, useState } from "react";
import type { Agent } from "@atproto/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listDigitalItemRows } from "@/lib/atproto/records";

export type TrackSlot = {
  uri: string;
  cid?: string;
  trackNumber: number;
};

export function TrackListBuilder({
  artistDid,
  agent,
  value,
  onChange,
}: {
  artistDid: string;
  agent: Agent;
  value: TrackSlot[];
  onChange: (tracks: TrackSlot[]) => void;
}) {
  const [pool, setPool] = useState<{ uri: string; title: string }[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    void (async () => {
      const rows = await listDigitalItemRows(agent, artistDid);
      const tracks = rows
        .filter((r) => r.item.itemClass === "track")
        .map((r) => ({ uri: r.uri, title: r.item.title }));
      setPool(tracks);
    })();
  }, [agent, artistDid]);

  const filtered = pool.filter(
    (p) =>
      !q ||
      p.title.toLowerCase().includes(q.toLowerCase()) ||
      p.uri.includes(q),
  );

  function addTrack(uri: string, cid?: string) {
    if (value.some((v) => v.uri === uri)) return;
    onChange([
      ...value,
      { uri, cid, trackNumber: value.length + 1 },
    ]);
  }

  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    const t = next[i]!;
    next[i] = next[j]!;
    next[j] = t;
    onChange(next.map((v, idx) => ({ ...v, trackNumber: idx + 1 })));
  }

  function remove(i: number) {
    onChange(
      value
        .filter((_, idx) => idx !== i)
        .map((v, idx) => ({ ...v, trackNumber: idx + 1 })),
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium" htmlFor="track-search">
          Add tracks
        </label>
        <Input
          id="track-search"
          placeholder="Search existing tracks…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="mt-1"
        />
        <ul className="mt-2 max-h-40 overflow-auto border border-border rounded-md divide-y divide-border text-sm">
          {filtered.map((p) => (
            <li key={p.uri} className="flex items-center justify-between gap-2 px-2 py-1">
              <span className="truncate">{p.title}</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => addTrack(p.uri)}
              >
                Add
              </Button>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="text-sm font-medium mb-2">Order ({value.length})</p>
        <ol className="space-y-2">
          {value.map((t, i) => (
            <li
              key={t.uri}
              className="flex items-center gap-2 rounded-md border border-border px-2 py-1"
            >
              <span className="text-xs text-muted-foreground w-6">{i + 1}</span>
              <span className="flex-1 truncate font-mono text-xs">
                {t.uri}
              </span>
              <Button type="button" size="sm" variant="ghost" onClick={() => move(i, -1)}>
                Up
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => move(i, 1)}>
                Down
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => remove(i)}>
                Remove
              </Button>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
