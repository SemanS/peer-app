import { harnessLabel, planLabel } from "@t3tools/client-runtime/peer-settings";

import { Button, InlineButton } from "../../ui/button";
import { PageSection } from "./CapacityCoordinationParts";
import { harnessShort, type DetectedPlan } from "./aiSubscriptions.logic";

/**
 * The plans the agents on this computer report, each to be added as the person's own with a click
 * or put aside with "Not mine" (which the page keeps on this computer). Nothing is added by being
 * seen. What a row shows is the agent's own word for its plan, never the account it is signed in to.
 * Plans put aside can be brought back.
 */
export function DetectedPlans({
  offered,
  hidden,
  canAdd,
  onAdd,
  onDismiss,
  onRestore,
}: {
  readonly offered: ReadonlyArray<DetectedPlan>;
  readonly hidden: ReadonlyArray<DetectedPlan>;
  readonly canAdd: boolean;
  readonly onAdd: (plan: DetectedPlan) => void;
  readonly onDismiss: (plan: DetectedPlan) => void;
  readonly onRestore: () => void;
}) {
  if (offered.length === 0 && hidden.length === 0) return null;
  return (
    <PageSection
      title="Detected on this computer"
      description="Your local Claude Code and Codex report which plan they run on. Add the ones that are yours; nothing is added until you do."
    >
      {offered.length === 0 ? null : (
        <div className="overflow-hidden rounded-xl border bg-card">
          {offered.map((detected) => (
            <div
              key={detected.key}
              className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 border-b py-2 ps-3.5 pe-2.5 last:border-b-0"
            >
              <div className="flex min-w-0 flex-1 basis-60 flex-col">
                <span className="text-sm font-medium">
                  {harnessShort(detected.harness)} {planLabel(detected.plan)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {`Reported by ${harnessLabel(detected.harness)} · “${detected.reported}”`}
                </span>
              </div>
              <Button size="sm" disabled={!canAdd} onClick={() => onAdd(detected)}>
                Add as my plan
              </Button>
              <Button size="sm" variant="outline" onClick={() => onDismiss(detected)}>
                Not mine
              </Button>
            </div>
          ))}
        </div>
      )}
      {hidden.length === 0 ? null : (
        <p className="text-xs text-muted-foreground">
          {hidden.length === 1
            ? "1 detected plan is hidden on this computer. "
            : `${hidden.length} detected plans are hidden on this computer. `}
          <InlineButton onClick={onRestore}>Show again</InlineButton>
        </p>
      )}
    </PageSection>
  );
}
