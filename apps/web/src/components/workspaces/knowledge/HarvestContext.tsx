import { useState } from "react";

import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { Button } from "../../ui/button";
import { stackedThreadToast, toastManager } from "../../ui/toast";
import type { TaskContextSlotProps } from "../slots";
import { reportFailure } from "../useWorkActions";

/**
 * On a context page: kontext reads the context for what the project should keep beyond the work,
 * and what it finds waits in Knowledge to keep. Offered once the context has text and the project
 * keeps knowledge with kontext's model on this computer.
 */
export function HarvestContext({
  environmentId,
  workspace,
  project,
  scope,
  contextText,
}: TaskContextSlotProps) {
  const harvestContext = useAtomCommand(serverEnvironment.peerHubHarvestContext, {
    reportFailure: false,
  });
  const [harvesting, setHarvesting] = useState(false);
  const hasText = contextText !== null && contextText.trim() !== "";
  const knowledge = useEnvironmentQuery(
    hasText
      ? serverEnvironment.peerHubKnowledgeStatus({ environmentId, input: { workspace, project } })
      : null,
  ).data;

  const harvest = async () => {
    setHarvesting(true);
    const result = await harvestContext({ environmentId, input: { workspace, project, scope } });
    setHarvesting(false);
    if (!reportFailure("Could not read it", result) || result._tag !== "Success") return;
    const proposed = result.value.proposed;
    toastManager.add(
      stackedThreadToast({
        type: "success",
        title:
          proposed === 0
            ? "Nothing in it holds beyond this work"
            : `${proposed} ${proposed === 1 ? "proposal" : "proposals"} in Knowledge to keep`,
        description: "People keep or dismiss them under the project in Work.",
      }),
    );
  };

  if (!hasText || knowledge?.store !== true || !knowledge.llm) return null;
  return (
    <div className="flex items-center gap-2">
      <Button size="xs" variant="outline" disabled={harvesting} onClick={() => void harvest()}>
        {harvesting ? "Reading it…" : "Propose what to keep"}
      </Button>
      <span className="text-xs text-muted-foreground">
        kontext reads this context for what the project should keep beyond the work; it waits in
        Knowledge to keep.
      </span>
    </div>
  );
}
