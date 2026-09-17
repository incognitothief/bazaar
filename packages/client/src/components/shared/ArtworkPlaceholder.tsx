import artworkLoadingUrl from "@/assets/artwork-loading-combined.svg?url";
import { cn } from "@/lib/utils";

/**
 * Stand-in for a cover-art slot with no artwork.
 *
 * One <img> of one file: the six letters of "BAZAAR" are composed inside the
 * SVG by grid-positioned <g transform> wrappers, not by rendering six images
 * (see the commit that consolidated the original 6-file glob).
 *
 * Fills its parent rather than carrying a frame of its own -- the slots that
 * use it already have one, and they disagree (the storefront tile is square
 * and borderless inside a Card; the detail pages draw a rounded border). So
 * the caller owns the box, and the parent must have a definite height, which
 * in practice means `aspect-square`.
 *
 * Decorative, so `aria-hidden` -- the tile states the title and price in text,
 * and a screen reader gains nothing from "no artwork".
 */
export function ArtworkPlaceholder({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex h-full w-full items-center justify-center bg-muted p-6",
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
