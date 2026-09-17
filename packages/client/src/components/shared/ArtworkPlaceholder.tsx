import artworkLoadingUrl from "@/assets/artwork-loading-combined.svg?url";
import { cn } from "@/lib/utils";

/**
 * Stand-in for a cover-art slot with no artwork.
 *
 * One <img> of one file: the six letters of "BAZAAR" are composed inside the
 * SVG by grid-positioned <g transform> wrappers, not by rendering six images
 * (see the commit that consolidated the original 6-file glob).
 *
 * Decorative, so `aria-hidden` -- the page states what the item is in text,
 * and a screen reader gains nothing from "no artwork". Callers pass the size
 * constraint that matches their own artwork frame; the rounded border and
 * muted fill are kept here so an empty slot and a filled one line up.
 */
export function ArtworkPlaceholder({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex aspect-square min-h-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted p-6",
        className,
      )}
      aria-hidden
    >
      <img
        src={artworkLoadingUrl}
        alt=""
        className="max-h-full max-w-full object-contain opacity-50"
        draggable={false}
        decoding="async"
      />
    </div>
  );
}
