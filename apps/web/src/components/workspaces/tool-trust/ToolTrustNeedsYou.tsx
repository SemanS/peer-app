import { toolTrustNeedsYouCount } from "@t3tools/client-runtime/peer-tool-trust";
import { ShieldCheckIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "../../../lib/utils";
import { Button } from "../../ui/button";
import { TONE_SURFACE } from "../signals";
import type { NeedsYouSlotProps } from "../slots.types";
import { ToolTrustReview } from "./ToolTrustReview";
export function ToolTrustNeedsYou({ environmentId, status }: NeedsYouSlotProps) {
  const [open, setOpen] = useState(false);
  const count = toolTrustNeedsYouCount(status);
  if (count === 0) return null;
  return (
    <>
      <div
        className={cn(
          "my-1 flex min-w-0 items-center gap-2.5 rounded-lg border px-2.5 py-2",
          TONE_SURFACE.needs,
        )}
      >
        <ShieldCheckIcon aria-hidden className="size-3.5 shrink-0 text-warning-foreground" />
        <p className="min-w-0 flex-1 text-xs text-sidebar-foreground">
          {count} workspace {count === 1 ? "tool needs" : "tools need"} review or a secret.
        </p>
        <Button size="xs" variant="outline" onClick={() => setOpen(true)}>
          Review
        </Button>
      </div>
      <ToolTrustReview
        environmentId={environmentId}
        status={status}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
