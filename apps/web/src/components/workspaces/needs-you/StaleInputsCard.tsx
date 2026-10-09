import type { NeedsYouItem, WorkOpen } from "@t3tools/client-runtime/peer/needs-you";
import { Button } from "../../ui/button";
export function StaleInputsCard({
  item,
  onOpen,
}: {
  readonly item: Extract<NeedsYouItem, { kind: "stale" }>;
  readonly onOpen: (open: WorkOpen) => void;
}) {
  return (
    <li className="my-1 rounded-md border border-sidebar-border p-2.5">
      <p className="text-xs font-medium text-warning-foreground">Inputs changed</p>
      <p className="text-sm font-medium">{item.title}</p>
      <ul className="my-1 text-xs text-muted-foreground">
        {item.stale.scopes.map((input) => (
          <li key={input.scope}>
            {input.scope}: version {input.readVersion} →{" "}
            {input.currentVersion === null ? "removed" : `version ${input.currentVersion}`}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        Agent must update these inputs before handoff.
      </p>
      {item.open ? (
        <div className="mt-2">
          <Button size="xs" variant="outline" onClick={() => item.open && onOpen(item.open!)}>
            Open task context
          </Button>
        </div>
      ) : null}
    </li>
  );
}
