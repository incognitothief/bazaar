import { LayoutGrid, List } from "lucide-react";
import { cn } from "@/lib/utils";

export type InventoryViewMode = "grid" | "list";

export const INVENTORY_VIEW_MODE_KEY = "bazaar_merchant_inventory_view";

export function loadInventoryViewMode(): InventoryViewMode {
  return localStorage.getItem(INVENTORY_VIEW_MODE_KEY) === "list"
    ? "list"
    : "grid";
}

const segCls =
  "inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors [&_svg]:size-4";
const segActiveCls = "bg-primary text-primary-foreground shadow-sm";

/**
 * Grid/list toggle — the whole pill is one tap target; a click flips the mode.
 * The active mode's icon gets a solid fill so the current state is obvious.
 */
export function InventoryViewToggle({
  value,
  onChange,
}: {
  value: InventoryViewMode;
  onChange: (mode: InventoryViewMode) => void;
}) {
  const next: InventoryViewMode = value === "grid" ? "list" : "grid";
  return (
    <button
      type="button"
      aria-label={`Inventory view: ${value} — tap for ${next} view`}
      title={`Switch to ${next} view`}
      className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5"
      onClick={() => onChange(next)}
    >
      <span
        aria-hidden="true"
        className={cn(segCls, value === "grid" && segActiveCls)}
      >
        <LayoutGrid />
      </span>
      <span
        aria-hidden="true"
        className={cn(segCls, value === "list" && segActiveCls)}
      >
        <List />
      </span>
    </button>
  );
}
