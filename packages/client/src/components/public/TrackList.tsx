import { useEffect, useState } from "react";
import type { Agent } from "@atproto/api";
import { getRecordValue } from "@/lib/atproto/records";
import type { Collection, DigitalItem } from "@/types/lexicons";

function formatDuration(ms: number | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export function TrackList({
  agent,
  collection,
}: {
  agent: Agent;
  collection: Collection;
}) {
  const [rows, setRows] = useState<
    { uri: string; title: string; durationMs?: number }[]
  >([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const out: { uri: string; title: string; durationMs?: number }[] = [];
      for (const entry of collection.items) {
        if (entry.role !== "track") continue;
        const v = await getRecordValue<DigitalItem>(agent, entry.uri);
        out.push({
          uri: entry.uri,
          title: entry.title ?? v?.title ?? "Track",
          durationMs: v?.durationMs,
        });
      }
      if (!cancelled) setRows(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [agent, collection]);

  return (
    <ol className="list-decimal list-inside space-y-2 text-sm">
      {rows.map((r) => (
        <li key={r.uri} className="flex justify-between gap-4">
          <span>{r.title}</span>
          <span className="text-muted-foreground tabular-nums">
            {formatDuration(r.durationMs)}
          </span>
        </li>
      ))}
    </ol>
  );
}
