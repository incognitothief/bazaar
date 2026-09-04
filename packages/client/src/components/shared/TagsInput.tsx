import { useState } from "react";
import { XIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Chip-style tag entry: type, Enter to confirm as a chip, click a chip's ×
 * to remove it. Backspace on an empty field removes the last chip -- the
 * standard tag-input convention (Gmail, Linear, Notion, ...), not something
 * called out explicitly but expected the moment chips exist.
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

  function commitDraft() {
    const value = draft.trim();
    setDraft("");
    if (!value || tags.includes(value)) return;
    onChange([...tags, value]);
  }

  function removeTag(tag: string) {
    onChange(tags.filter((t) => t !== tag));
  }

  return (
    <div className="flex items-center gap-2">
      <div
        className={cn(
          "flex min-h-8 w-full min-w-0 flex-wrap items-center gap-1.5 rounded-lg border border-input bg-transparent px-2.5 py-1 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
        )}
      >
        {tags.map((tag) => (
          <Badge key={tag} variant="secondary" className="gap-1 pr-1">
            {tag}
            <button
              type="button"
              onClick={() => removeTag(tag)}
              aria-label={`Remove ${tag}`}
              className="rounded-full hover:text-destructive"
            >
              <XIcon className="size-3" />
            </button>
          </Badge>
        ))}
        <input
          id={id}
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
  );
}
