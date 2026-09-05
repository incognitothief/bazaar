import { Autocomplete } from "@base-ui/react/autocomplete";
import { CheckIcon, ChevronDownIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { MACRO_CATEGORIES, type MacroCategory } from "@/lib/itemContentClass";

const ROW_CLASS =
  "flex cursor-default items-center justify-between rounded-md px-2 py-1.5 text-sm outline-hidden select-none hover:bg-accent hover:text-accent-foreground data-highlighted:bg-accent data-highlighted:text-accent-foreground";

/**
 * `catalog.item.category` editor: a select of the predefined macro categories
 * (audio / graphic / document) that also takes free text. Typing filters the
 * options; once the text matches none of them the list is empty and whatever the
 * merchant typed becomes their own category. The "none" row clears the field
 * back to generic. The stored value is always the raw string -- the data model
 * is unchanged, and the dictionary cross-reference that maps custom entries to a
 * page shape happens elsewhere.
 */
export function CategoryField({
  id,
  value,
  onChange,
  className,
}: {
  id?: string;
  value: string;
  onChange: (next: string) => void;
  className?: string;
}) {
  const current = value.trim().toLowerCase();

  return (
    <Autocomplete.Root
      items={[...MACRO_CATEGORIES]}
      value={value}
      onValueChange={onChange}
      openOnInputClick
    >
      <Autocomplete.InputGroup
        className={cn(
          "flex h-8 w-full items-center gap-1 rounded-lg border border-input bg-transparent pr-1 pl-2.5 text-sm transition-colors outline-none focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30",
          className,
        )}
      >
        <Autocomplete.Input
          id={id}
          placeholder="Optional — leave blank for generic, or type your own"
          maxLength={64}
          className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground md:text-sm"
        />
        <Autocomplete.Trigger
          aria-label="Show categories"
          className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground outline-none hover:text-foreground"
        >
          <Autocomplete.Icon render={<ChevronDownIcon className="size-4" />} />
        </Autocomplete.Trigger>
      </Autocomplete.InputGroup>

      <Autocomplete.Portal>
        <Autocomplete.Positioner
          align="start"
          sideOffset={4}
          className="isolate z-50"
          style={{ width: "var(--anchor-width)" }}
        >
          <Autocomplete.Popup className="max-h-[min(18rem,var(--available-height))] w-full overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10">
            <button
              type="button"
              onClick={() => onChange(current)}
              className={cn(
                ROW_CLASS,
                "w-full",
                current === "" && "text-muted-foreground",
              )}
            >
              <span className="truncate">{current === "" ? "none" : value}</span>
              {current === "" ? (
                <CheckIcon className="size-4 shrink-0" />
              ) : null}
            </button>
            <Autocomplete.List>
              {(item: MacroCategory) => (
                <Autocomplete.Item key={item} value={item} className={ROW_CLASS}>
                  {item}
                  {current === item ? (
                    <CheckIcon className="size-4 shrink-0" />
                  ) : null}
                </Autocomplete.Item>
              )}
            </Autocomplete.List>
          </Autocomplete.Popup>
        </Autocomplete.Positioner>
      </Autocomplete.Portal>
    </Autocomplete.Root>
  );
}
