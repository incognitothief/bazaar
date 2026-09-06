import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/**
 * Minimal hand-rolled dropdown menu -- no Radix dependency. The content is
 * portalled to <body> and positioned `fixed` off the trigger's rect so it
 * escapes ancestor `overflow-hidden` (inventory rows live inside a clipped,
 * rounded list container). Click-outside / Escape / scroll / resize close it.
 */

type Rect = { top: number; left: number; right: number; bottom: number };

type DropdownMenuContextValue = {
  open: boolean;
  setOpen: (next: boolean) => void;
  menuId: string;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  rect: Rect | null;
  setRect: (r: Rect | null) => void;
};

const DropdownMenuContext = createContext<DropdownMenuContextValue | null>(null);

function useCtx(component: string): DropdownMenuContextValue {
  const ctx = useContext(DropdownMenuContext);
  if (!ctx) throw new Error(`${component} must be used within <DropdownMenu>`);
  return ctx;
}

export function DropdownMenu({ children }: { children: ReactNode }) {
  const [open, setOpenState] = useState(false);
  const [rect, setRect] = useState<Rect | null>(null);
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    if (next && triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, right: r.right, bottom: r.bottom });
    }
  }, []);

  return (
    <DropdownMenuContext.Provider
      value={{ open, setOpen, menuId, triggerRef, rect, setRect }}
    >
      <div className="relative inline-flex">{children}</div>
    </DropdownMenuContext.Provider>
  );
}

export function DropdownMenuTrigger({
  children,
  className,
  "aria-label": ariaLabel,
  title,
}: {
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
  title?: string;
}) {
  const { open, setOpen, menuId, triggerRef } = useCtx("DropdownMenuTrigger");
  return (
    <button
      ref={triggerRef}
      type="button"
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={open ? menuId : undefined}
      aria-label={ariaLabel}
      title={title}
      className={className}
      onClick={(e) => {
        e.stopPropagation();
        setOpen(!open);
      }}
    >
      {children}
    </button>
  );
}

export function DropdownMenuContent({
  children,
  align = "end",
  className,
}: {
  children: ReactNode;
  align?: "start" | "end";
  className?: string;
}) {
  const { open, setOpen, menuId, rect } = useCtx("DropdownMenuContent");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onScrollOrResize() {
      setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, setOpen]);

  // Keep the menu on-screen vertically when the trigger is near the bottom.
  const [flipUp, setFlipUp] = useState(false);
  useLayoutEffect(() => {
    if (!open || !rect || !ref.current) return;
    const menuH = ref.current.offsetHeight;
    setFlipUp(rect.bottom + menuH + 8 > window.innerHeight && rect.top > menuH);
  }, [open, rect]);

  if (!open || !rect) return null;

  const style: React.CSSProperties = flipUp
    ? { position: "fixed", bottom: window.innerHeight - rect.top + 4 }
    : { position: "fixed", top: rect.bottom + 4 };
  if (align === "end") style.right = window.innerWidth - rect.right;
  else style.left = rect.left;

  return createPortal(
    <div
      ref={ref}
      id={menuId}
      role="menu"
      style={style}
      className={cn(
        "z-50 min-w-[10rem] overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md",
        className,
      )}
    >
      {children}
    </div>,
    document.body,
  );
}

export function DropdownMenuItem({
  children,
  onSelect,
  disabled,
  destructive,
  className,
}: {
  children: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  destructive?: boolean;
  className?: string;
}) {
  const { setOpen } = useCtx("DropdownMenuItem");
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors",
        "hover:bg-muted focus-visible:bg-muted disabled:pointer-events-none disabled:opacity-50",
        destructive && "text-destructive hover:bg-destructive/10",
        className,
      )}
      onClick={(e) => {
        e.stopPropagation();
        setOpen(false);
        onSelect();
      }}
    >
      {children}
    </button>
  );
}

export function DropdownMenuSeparator() {
  return <div role="separator" className="my-1 h-px bg-border" />;
}

export function DropdownMenuLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
      {children}
    </div>
  );
}
