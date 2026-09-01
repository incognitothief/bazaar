import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { SearchIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function ValidateReceiptDialog({
  initialUri = "",
}: {
  initialUri?: string;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [uri, setUri] = useState(initialUri);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setUri(initialUri);
      }}
    >
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <SearchIcon />
            Validate a receipt URI
          </Button>
        }
      />
      <DialogContent
        className="top-[16%] translate-y-0 rounded-none sm:max-w-lg"
        showCloseButton={false}
      >
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = uri.trim();
            if (!trimmed) return;
            setOpen(false);
            navigate(`/dashboard/validate/${encodeURIComponent(trimmed)}`);
          }}
        >
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <Label htmlFor="dialog-receipt-uri" className="sr-only">
                Receipt URI
              </Label>
              <Input
                id="dialog-receipt-uri"
                className="rounded-none"
                value={uri}
                placeholder="at://did:plc:.../purchase.receipt/..."
                onChange={(e) => setUri(e.target.value)}
                autoFocus
              />
            </div>
            <Button
              type="button"
              variant="outline"
              className="rounded-none"
              onClick={() => setUri("")}
            >
              Clear
            </Button>
            <Button type="submit" className="rounded-none">
              Validate
            </Button>
          </div>
          <DialogHeader>
            <DialogTitle>Validate a receipt URI</DialogTitle>
          </DialogHeader>
        </form>
      </DialogContent>
    </Dialog>
  );
}
