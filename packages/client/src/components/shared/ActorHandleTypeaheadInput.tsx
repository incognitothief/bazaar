import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  type ActorTypeaheadHit,
  fetchActorTypeahead,
} from "@/lib/actorTypeahead";
import { cn } from "@/lib/utils";

function SuggestionAvatar({
  avatarUrl,
  handle,
}: {
  avatarUrl?: string;
  handle: string;
}) {
  const [broken, setBroken] = useState(false);
  const initial = handle.trim().charAt(0).toUpperCase() || "?";

  if (!avatarUrl || broken) {
    return (
      <span
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground"
        aria-hidden
      >
        {initial}
      </span>
    );
  }

  return (
    <img
      src={avatarUrl}
      alt=""
      className="size-8 shrink-0 rounded-full object-cover"
      onError={() => setBroken(true)}
    />
  );
}

const DEBOUNCE_MS = 280;
const MIN_QUERY_LEN = 2;
const LIMIT = 10;

type Props = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  autoComplete?: string;
};

export function ActorHandleTypeaheadInput({
  id,
  value,
  onChange,
  disabled,
  placeholder,
  autoComplete,
}: Props) {
  const reactId = useId();
  const listboxId = `${id}-${reactId}-listbox`;
  const wrapRef = useRef<HTMLDivElement>(null);
  /** Browser autofill does not set this; avoids opening the list over the submit button. */
  const userDroveTypeaheadRef = useRef(false);
  const [debounced, setDebounced] = useState(value);
  const [suggestions, setSuggestions] = useState<ActorTypeaheadHit[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [value]);

  useEffect(() => {
    const q = debounced.trim();
    if (q.length < MIN_QUERY_LEN || disabled) {
      setSuggestions([]);
      setOpen(false);
      setHighlight(-1);
      setLoading(false);
      return;
    }

    if (!userDroveTypeaheadRef.current) {
      setSuggestions([]);
      setOpen(false);
      setHighlight(-1);
      setLoading(false);
      return;
    }

    const ac = new AbortController();
    setLoading(true);

    void (async () => {
      try {
        const next = await fetchActorTypeahead(q, LIMIT, ac.signal);
        if (ac.signal.aborted) return;
        setSuggestions(next);
        setOpen(next.length > 0);
        setHighlight(next.length > 0 ? 0 : -1);
      } catch (e) {
        if (ac.signal.aborted) return;
        if (e instanceof DOMException && e.name === "AbortError") return;
        setSuggestions([]);
        setOpen(false);
        setHighlight(-1);
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    })();

    return () => ac.abort();
  }, [debounced, disabled]);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (wrapRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  const pick = useCallback(
    (handle: string) => {
      onChange(handle);
      setOpen(false);
      setHighlight(-1);
    },
    [onChange],
  );

  const showList = open && suggestions.length > 0 && !disabled;
  const activeId =
    showList && highlight >= 0
      ? `${listboxId}-opt-${highlight}`
      : undefined;

  return (
    <div ref={wrapRef} className="relative">
      <Input
        id={id}
        type="text"
        autoComplete={autoComplete}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        aria-autocomplete="list"
        aria-controls={listboxId}
        aria-expanded={showList}
        aria-activedescendant={activeId}
        aria-busy={loading}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        onPaste={() => {
          userDroveTypeaheadRef.current = true;
        }}
        onCut={() => {
          userDroveTypeaheadRef.current = true;
        }}
        onFocus={() => {
          if (suggestions.length > 0) setOpen(true);
        }}
        onKeyDown={(e) => {
          if (
            !e.metaKey &&
            !e.ctrlKey &&
            !e.altKey &&
            (e.key.length === 1 ||
              e.key === "Backspace" ||
              e.key === "Delete")
          ) {
            userDroveTypeaheadRef.current = true;
          }

          if (!showList) return;

          if (e.key === "Escape") {
            e.preventDefault();
            setOpen(false);
            setHighlight(-1);
            return;
          }

          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlight((h) =>
              h < suggestions.length - 1 ? h + 1 : 0,
            );
            return;
          }

          if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) =>
              h <= 0 ? suggestions.length - 1 : h - 1,
            );
            return;
          }

          if (e.key === "Enter" && highlight >= 0) {
            e.preventDefault();
            const hit = suggestions[highlight];
            if (hit) pick(hit.handle);
          }
        }}
        className={cn(loading && "pr-9")}
      />
      {loading ? (
        <span
          className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 animate-pulse rounded-full bg-muted-foreground/40"
          aria-hidden
        />
      ) : null}
      {showList ? (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-popover py-1 text-popover-foreground shadow-md"
        >
          {suggestions.map((hit, i) => (
            <li
              key={hit.did}
              id={`${listboxId}-opt-${i}`}
              role="option"
              aria-selected={i === highlight}
              className={cn(
                "flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-sm outline-none",
                i === highlight ? "bg-accent text-accent-foreground" : "",
              )}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(hit.handle);
              }}
              onMouseEnter={() => setHighlight(i)}
            >
              <SuggestionAvatar avatarUrl={hit.avatar} handle={hit.handle} />
              <span className="min-w-0 flex-1 truncate">
                <span className="font-mono text-foreground">{hit.handle}</span>
                {hit.displayName?.trim() ? (
                  <span className="ml-2 text-muted-foreground">
                    {hit.displayName.trim()}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
