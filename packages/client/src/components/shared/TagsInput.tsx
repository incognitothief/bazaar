import { useRef, useState } from "react";
import { XIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { KNOWN_TOKENS, parseTag, TOKEN_PREFIXES } from "@/lib/tagTokens";

/**
 * Chip-style tag entry: type, Enter to confirm as a chip, click a chip's ×
 * to remove it. Backspace on an empty field removes the last chip -- the
 * standard tag-input convention (Gmail, Linear, Notion, ...), not something
 * called out explicitly but expected the moment chips exist.
 *
 * Prefix tokens (`genre:`, `released:`, `id:` -- see lib/tagTokens) are just
 * tags with a `key:value` shape: the quick-add row below seeds a prefix, and a
 * committed token chip shows its key de-emphasized.
 */
export function TagsInput({
  id,
  tags,
  onChange,
  placeholder,
}: {
  id: string;
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Token keys that already have a value and are marked singular -- no more
  // of these may be added (e.g. only one `released:` per record).
  const usedSingularKeys = new Set<string>();
  for (const t of tags) {
    const p = parseTag(t);
    if (p.kind === "token" && KNOWN_TOKENS[p.key]?.singular) {
      usedSingularKeys.add(p.key);
    }
  }

  function commitDraft() {
    const value = draft.trim();
    // A bare `genre:` etc. -- keep editing, don't commit a valueless token.
    if (TOKEN_PREFIXES.includes(value)) return;
    setDraft("");
    if (!value || tags.includes(value)) return;
    const p = parseTag(value);
    if (p.kind === "token" && usedSingularKeys.has(p.key)) return;
    onChange([...tags, value]);
  }

  function removeTag(tag: string) {
    onChange(tags.filter((t) => t !== tag));
  }

  function seedPrefix(prefix: string) {
    setDraft((d) => (TOKEN_PREFIXES.includes(d.trim()) || d === "" ? prefix : d));
    inputRef.current?.focus();
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <div className="flex min-h-8 w-full min-w-0 flex-wrap items-center gap-1.5 rounded-lg border border-input bg-transparent px-2.5 py-1 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
          {tags.map((tag) => {
            const p = parseTag(tag);
            return (
              <Badge
                key={tag}
                variant="secondary"
                className={cn(
                  "gap-1 pr-1",
                  p.kind === "token" && "border border-primary/30",
                )}
              >
                {p.kind === "token" ? (
                  <span>
                    <span className="text-muted-foreground">
                      {p.key}:{p.subtype ? `${p.subtype}:` : ""}
                    </span>
                    {p.value}
                  </span>
                ) : (
                  tag
                )}
                <button
                  type="button"
                  onClick={() => removeTag(tag)}
                  aria-label={`Remove ${tag}`}
                  className="rounded-full hover:text-destructive"
                >
                  <XIcon className="size-3" />
                </button>
              </Badge>
            );
          })}
          <input
            id={id}
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitDraft();
              } else if (e.key === "Backspace" && !draft && tags.length > 0) {
                removeTag(tags[tags.length - 1]!);
              }
            }}
            onBlur={commitDraft}
            placeholder={tags.length === 0 ? placeholder : undefined}
            className="h-6 min-w-[80px] flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <p className="shrink-0 text-xs text-muted-foreground">
          <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">
            Enter
          </kbd>{" "}
          to add
        </p>
      </div>
      <div className="flex flex-wrap gap-1">
        {TOKEN_PREFIXES.map((pfx) => {
          const key = pfx.replace(/:$/, "");
          const disabled = usedSingularKeys.has(key);
          return (
            <button
              key={pfx}
              type="button"
              disabled={disabled}
              onClick={() => seedPrefix(pfx)}
              title={disabled ? `Only one ${key} allowed` : undefined}
              className={cn(
                "rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors",
                disabled
                  ? "cursor-not-allowed opacity-40"
                  : "hover:bg-muted hover:text-foreground",
              )}
            >
              {pfx}
            </button>
          );
        })}
      </div>
    </div>
  );
}
