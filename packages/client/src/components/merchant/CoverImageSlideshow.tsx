import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * A product can have any number of cover images -- the data model doesn't
 * distinguish single vs. multi (see productTypes.ts's allowMultipleCoverImages,
 * which only gates the *upload* UI). This just renders whatever count shows
 * up: one image renders plain, more than one gets prev/next controls.
 */
export function CoverImageSlideshow({
  images,
  alt,
}: {
  images: Array<{ objectId: string; url: string }>;
  alt?: string;
}) {
  const [index, setIndex] = useState(0);
  if (images.length === 0) return null;
  const current = images[Math.min(index, images.length - 1)];

  return (
    <div className="space-y-2">
      <img
        src={current.url}
        alt={alt ?? ""}
        className="aspect-square w-full rounded-lg border border-border object-cover"
      />
      {images.length > 1 ? (
        <div className="flex items-center justify-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Previous image"
            onClick={() => setIndex((i) => (i - 1 + images.length) % images.length)}
          >
            <ChevronLeft />
          </Button>
          <span className="text-xs text-muted-foreground">
            {index + 1} / {images.length}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Next image"
            onClick={() => setIndex((i) => (i + 1) % images.length)}
          >
            <ChevronRight />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
