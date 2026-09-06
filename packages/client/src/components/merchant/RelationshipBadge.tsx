import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { RelationshipDescriptor } from "./inventoryCommander";

/**
 * Small chip describing how an inventory row sits in the listing graph:
 * a product, an item sold on its own, an item that only ships inside a
 * product, or an item with no listing at all. Rendered nothing for legacy
 * grains (`none`).
 */
export function RelationshipBadge({
  relationship,
  className,
}: {
  relationship: RelationshipDescriptor;
  className?: string;
}) {
  if (relationship.kind === "none" || !relationship.label) return null;

  const tone: Record<RelationshipDescriptor["kind"], string> = {
    standalone: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
    "in-product": "border-border text-muted-foreground",
    unlisted: "border-amber-500/40 text-amber-600 dark:text-amber-400",
    none: "",
  };

  return (
    <Badge
      variant="outline"
      className={cn("text-[10px] font-normal", tone[relationship.kind], className)}
    >
      {relationship.label}
    </Badge>
  );
}
