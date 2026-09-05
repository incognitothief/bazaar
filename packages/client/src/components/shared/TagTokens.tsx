import { MetadataChip } from "@/components/shared/MetadataChip";
import { cn } from "@/lib/utils";
import { formatTokenEntry, groupTags } from "@/lib/tagTokens";

/**
 * Renders an item/product's `tags[]`. Display-only -- see lib/tagTokens.
 *
 * - `part="plain"`  -> just the plain-label chips, as a bare fragment so they
 *   flow inside an existing chip row.
 * - `part="tokens"` -> the prefix-token groups (Genre, Released, ID, ...),
 *   stacked one row per group.
 * - `part="all"`    -> plain chips then the stacked groups.
 */
export function TagTokens({
  tags,
  className,
  part = "all",
}: {
  tags: string[] | null | undefined;
  className?: string;
  part?: "all" | "plain" | "tokens";
}) {
  const { groups, plain } = groupTags(tags);

  if (part === "plain") {
    return (
      <>
        {plain.map((t) => (
          <MetadataChip key={`plain-${t}`}>{t}</MetadataChip>
        ))}
      </>
    );
  }

  const showPlain = part === "all" && plain.length > 0;
  if (groups.length === 0 && !showPlain) return null;

  return (
    <div className={cn("space-y-1.5", className)}>
      {showPlain ? (
        <div className="flex flex-wrap gap-1.5">
          {plain.map((t) => (
            <MetadataChip key={`plain-${t}`}>{t}</MetadataChip>
          ))}
        </div>
      ) : null}
      {groups.map((g) => (
        <div key={g.key} className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {g.label}
          </span>
          {g.entries.map((e, i) => (
            <MetadataChip
              key={`${g.key}-${i}`}
              className={g.key === "id" ? "font-mono" : undefined}
            >
              {formatTokenEntry(g.key, e)}
            </MetadataChip>
          ))}
        </div>
      ))}
    </div>
  );
}
