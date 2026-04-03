import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function FormatBadge({
  format,
  className,
}: {
  format: string;
  className?: string;
}) {
  return (
    <Badge variant="secondary" className={cn("uppercase", className)}>
      {format}
    </Badge>
  );
}
