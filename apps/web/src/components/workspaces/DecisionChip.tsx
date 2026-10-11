import { Badge } from "../ui/badge";
import type { DecisionChipModel } from "./DecisionChip.logic";

/**
 * What decided a coordination request, in one chip: `<policy> · <where it came from>`. It is core:
 * the Hub names the decision (or this computer works it out), so it reads the same on a project's
 * header, an overlap's page and the coordination history. Amber while the project's path rules
 * were not applied.
 */
export function DecisionChip({ chip }: { readonly chip: DecisionChipModel }) {
  return (
    <Badge variant={chip.warn ? "warning" : "outline"} size="control" className="max-w-full">
      <span className="font-semibold">{chip.policy}</span>
      <span aria-hidden className="text-muted-foreground">
        ·
      </span>
      <span className="min-w-0 truncate font-normal text-muted-foreground">{chip.source}</span>
    </Badge>
  );
}
