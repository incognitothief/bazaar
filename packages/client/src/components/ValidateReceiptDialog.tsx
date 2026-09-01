import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { SearchIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = uri.trim();
            if (!trimmed) return;
            setOpen(false);
            navigate(`/dashboard/validate/${encodeURIComponent(trimmed)}`);
          }}
        >
          <DialogHeader>
            <DialogTitle>Validate a receipt URI</DialogTitle>
            <DialogDescription>
              Check any purchase receipt against the listing it was issued
              for.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="dialog-receipt-uri">Receipt URI</Label>
            <Input
              id="dialog-receipt-uri"
              value={uri}
              placeholder="at://did:plc:.../purchase.receipt/..."
              onChange={(e) => setUri(e.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="submit">Validate</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
