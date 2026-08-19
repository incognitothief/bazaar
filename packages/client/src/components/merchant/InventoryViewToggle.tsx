import { LayoutGrid, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type InventoryViewMode = "grid" | "list";

export const INVENTORY_VIEW_MODE_KEY = "bazaar_merchant_inventory_view";

export function loadInventoryViewMode(): InventoryViewMode {
  return localStorage.getItem(INVENTORY_VIEW_MODE_KEY) === "list"
    ? "list"
    : "grid";
}

export function InventoryViewToggle({
  value,
  onChange,
}: {
  value: InventoryViewMode;
  onChange: (mode: InventoryViewMode) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Inventory view"
      className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5"
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-pressed={value === "grid"}
        aria-label="Grid view"
        title="Grid view"
        className={cn(value === "grid" && "bg-background shadow-sm")}
        onClick={() => onChange("grid")}
      >
        <LayoutGrid />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-pressed={value === "list"}
        aria-label="List view"
        title="List view"
        className={cn(value === "list" && "bg-background shadow-sm")}
        onClick={() => onChange("list")}
      >
        <List />
      </Button>
    </div>
  );
}
