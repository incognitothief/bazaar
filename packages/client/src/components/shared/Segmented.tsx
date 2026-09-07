import { cn } from "@/lib/utils";

/**
 * A 2+ option pill where the *whole* control is one tap target — each click
 * advances to the next option (wrapping). Looks like a classic segmented
 * control; far easier to hit on mobile than aiming at one half. The selected
 * option gets a solid fill so the current choice is obvious at a glance.
 */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
  className?: string;
}) {
  const idx = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const nextOption = options[(idx + 1) % options.length];
  return (
    <button
      type="button"
      aria-label={
        nextOption
          ? `${label}: ${options[idx]?.label ?? value} — tap for ${nextOption.label}`
          : label
      }
      className={cn(
        "group inline-flex items-center gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5 text-sm",
        className,
      )}
      onClick={() => nextOption && onChange(nextOption.value)}
    >
      {options.map((o) => (
        <span
          key={o.value}
          aria-hidden="true"
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors group-hover:text-foreground",
            value === o.value &&
              "bg-primary font-semibold text-primary-foreground shadow-sm group-hover:text-primary-foreground",
          )}
        >
          {o.label}
        </span>
      ))}
    </button>
  );
}
