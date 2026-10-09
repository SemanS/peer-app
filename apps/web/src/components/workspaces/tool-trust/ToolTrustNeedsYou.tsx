import { toolTrustNeedsYouCount } from "@t3tools/client-runtime/peer-tool-trust";
import { useState } from "react";
import { Button } from "../../ui/button";
import type { NeedsYouSlotProps } from "../slots.types";
import { ToolTrustReview } from "./ToolTrustReview";
export function ToolTrustNeedsYou({ environmentId, status }: NeedsYouSlotProps) {
  const [open, setOpen] = useState(false);
  const count = toolTrustNeedsYouCount(status);
  if (count === 0) return null;
  return (
    <>
      <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
        <p>
          {count} workspace {count === 1 ? "tool needs" : "tools need"} review or a secret.
        </p>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          Review tools
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
