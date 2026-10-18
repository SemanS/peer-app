import { EyeIcon } from "lucide-react";
import type { EnvironmentId } from "@t3tools/contracts";

import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import { Badge } from "../../ui/badge";
import { Dialog, DialogClose, DialogPopup } from "../../ui/dialog";
import { Button } from "../../ui/button";
import { Toggle, ToggleGroup } from "../../ui/toggle-group";
import { PeerDialogBody, PeerDialogFooter, PeerDialogHeader } from "../PeerDialog";
import { atOpHeading, atOpRowView } from "./operations.logic";

export interface AtOpTarget {
  readonly description: string;
  readonly after: string;
  readonly before: string | null;
}

/**
 * The project's changes as they were after one step, or just before it: jj's `--at-op` read,
 * which snapshots nothing and changes nothing. It opens on "after", which is what the spec names.
 */
export function AtOpDialog({
  environmentId,
  workspace,
  project,
  target,
  which,
  onWhichChange,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: string;
  readonly project: string;
  readonly target: AtOpTarget;
  readonly which: "after" | "before";
  readonly onWhichChange: (which: "after" | "before") => void;
  readonly onClose: () => void;
}) {
  const operation = which === "before" && target.before !== null ? target.before : target.after;
  const view = useEnvironmentQuery(
    serverEnvironment.peerJujutsuAtOp({
      environmentId,
      input: { workspace, project, operation },
    }),
  );
  const rows = (view.data?.rows ?? []).map(atOpRowView);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup className="max-w-2xl">
        <PeerDialogHeader
          icon={EyeIcon}
          tone="neutral"
          title="The repository as it was"
          description={atOpHeading(which, target.description)}
        />
        <PeerDialogBody>
          <div className="flex flex-col gap-3">
            {target.before === null ? null : (
              <ToggleGroup
                aria-label="Which moment"
                value={[which]}
                onValueChange={(next) => {
                  const value = next[0];
                  if (value === "before" || value === "after") onWhichChange(value);
                }}
              >
                <Toggle value="before">Before this step</Toggle>
                <Toggle value="after">After this step</Toggle>
              </ToggleGroup>
            )}
            {view.error === null ? null : (
              <p role="alert" className="text-sm text-destructive-foreground">
                {view.error}
              </p>
            )}
            {view.data === null && view.error === null ? (
              <p role="status" className="text-sm text-muted-foreground">
                Reading the changes at that step…
              </p>
            ) : null}
            {view.data !== null && rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No changes of this project then.</p>
            ) : null}
            <ul aria-label="Changes at that step" className="flex flex-col divide-y divide-border">
              {rows.map((row) => (
                <li key={row.changeId} className="flex flex-col gap-1 py-2.5">
                  <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="font-mono text-xs text-muted-foreground">{row.changeId}</span>
                    <span className="text-sm font-medium text-foreground">{row.subject}</span>
                    {row.bookmarks.map((bookmark) => (
                      <span key={bookmark} className="font-mono text-xs text-muted-foreground">
                        {bookmark}
                      </span>
                    ))}
                    {row.flags.map((flag) => (
                      <Badge
                        key={flag}
                        variant={flag === "empty" ? "secondary" : "warning"}
                        size="sm"
                      >
                        {flag === "divergent" ? "two versions" : flag}
                      </Badge>
                    ))}
                  </span>
                  <span className="text-xs text-muted-foreground">{row.paths}</span>
                </li>
              ))}
            </ul>
          </div>
        </PeerDialogBody>
        <PeerDialogFooter note="Nothing was changed to show this.">
          <DialogClose render={<Button variant="outline" />}>Close</DialogClose>
        </PeerDialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
