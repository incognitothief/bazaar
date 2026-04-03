import { Progress } from "@/components/ui/progress";
import type { CompletenessScore } from "@/types/lexicons";
import { cn } from "@/lib/utils";

export function CompletenessIndicator({
  score,
  compact,
  onFieldClick,
}: {
  score: CompletenessScore;
  compact?: boolean;
  onFieldClick?: (field: string) => void;
}) {
  const color =
    score.score < 40
      ? "bg-red-500"
      : score.score <= 70
        ? "bg-amber-500"
        : "bg-emerald-600";

  if (compact) {
    return (
      <div className="flex items-center gap-2 min-w-[120px]">
        <Progress value={score.score} className="h-2 flex-1" />
        <span className="text-xs tabular-nums text-muted-foreground w-8">
          {score.score}
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Completeness</span>
        <span className="text-sm tabular-nums">{score.score}/100</span>
      </div>
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full transition-all", color)}
          style={{ width: `${score.score}%` }}
        />
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-red-600 dark:text-red-400">
          Required ({score.required.length} missing)
        </summary>
        <ul className="mt-2 flex flex-wrap gap-1">
          {score.required.map((f) => (
            <button
              key={f}
              type="button"
              className="rounded-md border border-border px-2 py-0.5 text-xs"
              onClick={() => onFieldClick?.(f)}
            >
              {f}
            </button>
          ))}
        </ul>
      </details>
      <details className="text-sm">
        <summary className="cursor-pointer text-amber-600 dark:text-amber-400">
          Recommended ({score.recommended.length} missing)
        </summary>
        <ul className="mt-2 flex flex-wrap gap-1">
          {score.recommended.map((f) => (
            <button
              key={f}
              type="button"
              className="rounded-md border border-border px-2 py-0.5 text-xs"
              onClick={() => onFieldClick?.(f)}
            >
              {f}
            </button>
          ))}
        </ul>
      </details>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">
          Optional ({score.optional.length} missing)
        </summary>
        <ul className="mt-2 flex flex-wrap gap-1">
          {score.optional.map((f) => (
            <button
              key={f}
              type="button"
              className="rounded-md border border-border px-2 py-0.5 text-xs"
              onClick={() => onFieldClick?.(f)}
            >
              {f}
            </button>
          ))}
        </ul>
      </details>
    </div>
  );
}
