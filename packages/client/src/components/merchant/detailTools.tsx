import { useState } from "react";
import { Settings, X, type LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * A control on a merchant detail page's tool cluster. Rendered as a desktop
 * 2x2 icon grid and, on mobile, as chunky tiles in a "remote control" dialog.
 */
export type ToolAction = {
  key: string;
  Icon: LucideIcon;
  label: string;
  /** internal route */
  href?: string;
  /** plain <a> (e.g. a file download) */
  externalHref?: string;
  onClick?: () => void;
  disabled?: boolean;
  disabledHint?: string;
};

function DesktopToolButton({ action }: { action: ToolAction }) {
  const linkCls = cn(buttonVariants({ variant: "outline", size: "icon-sm" }));
  const icon = <action.Icon className="size-4" />;
  if (action.disabled) {
    return (
      <span title={action.disabledHint} className="inline-flex">
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          disabled
          aria-label={action.label}
        >
          {icon}
        </Button>
      </span>
    );
  }
  if (action.externalHref) {
    return (
      <a
        href={action.externalHref}
        className={linkCls}
        aria-label={action.label}
        title={action.label}
      >
        {icon}
      </a>
    );
  }
  if (action.href) {
    return (
      <Link
        to={action.href}
        className={linkCls}
        aria-label={action.label}
        title={action.label}
      >
        {icon}
      </Link>
    );
  }
  return (
    <Button
      type="button"
      variant="outline"
      size="icon-sm"
      aria-label={action.label}
      title={action.label}
      onClick={action.onClick}
    >
      {icon}
    </Button>
  );
}

function RemoteTile({
  action,
  onDone,
}: {
  action: ToolAction;
  onDone: () => void;
}) {
  const cls =
    "flex aspect-square flex-col items-center justify-center gap-2 rounded-xl border border-border bg-muted/40 p-3 text-center text-xs font-medium shadow-sm transition-transform hover:bg-muted active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40";
  const inner = (
    <>
      <action.Icon className="size-6" />
      <span>{action.label}</span>
    </>
  );
  if (action.disabled) {
    return (
      <button type="button" disabled className={cls} title={action.disabledHint}>
        {inner}
      </button>
    );
  }
  if (action.externalHref) {
    return (
      <a href={action.externalHref} className={cls} onClick={onDone}>
        {inner}
      </a>
    );
  }
  if (action.href) {
    return (
      <Link to={action.href} className={cls} onClick={onDone}>
        {inner}
      </Link>
    );
  }
  return (
    <button
      type="button"
      className={cls}
      onClick={() => {
        onDone();
        action.onClick?.();
      }}
    >
      {inner}
    </button>
  );
}

/**
 * The merchant detail-page tool cluster: a compact 2x2 icon grid on desktop,
 * a single gear that opens a remote-control dialog on mobile. Drop it into a
 * page header row; it owns its own dialog state.
 */
export function DetailToolbar({
  actions,
  panelTitle,
}: {
  actions: ToolAction[];
  panelTitle: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="hidden shrink-0 grid-cols-2 gap-1 sm:grid">
        {actions.map((a) => (
          <DesktopToolButton key={a.key} action={a} />
        ))}
      </div>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-14 shrink-0 sm:hidden"
        aria-label={panelTitle}
        onClick={() => setOpen(true)}
      >
        <Settings className="size-7" />
      </Button>
      <Dialog open={open} onOpenChange={(o) => setOpen(o)}>
        <DialogContent className="max-w-[20rem]" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{panelTitle}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            {[
              ...actions,
              { key: "close", Icon: X, label: "Close" } satisfies ToolAction,
            ].map((a) => (
              <RemoteTile
                key={a.key}
                action={a}
                onDone={() => setOpen(false)}
              />
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
