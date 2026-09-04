import { useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";

/**
 * Small icon-only copy-to-clipboard control for a raw value (a URI, CID,
 * DID, ...) shown inline next to that value -- used anywhere someone
 * (buyer or merchant support) needs to grab an exact value to paste into a
 * support thread, pdsls, etc.
 */
export function CopyButton({
  value,
  label = "Copy",
  className,
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          toast.success("Copied to clipboard");
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error("Could not copy");
        }
      }}
      aria-label={label}
      title={label}
      className={cn(
        "shrink-0 text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      {copied ? (
        <CheckIcon className="size-3.5" />
      ) : (
        <CopyIcon className="size-3.5" />
      )}
    </button>
  );
}
