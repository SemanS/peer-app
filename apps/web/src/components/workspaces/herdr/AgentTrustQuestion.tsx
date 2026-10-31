import type { EnvironmentId, PeerLocalAgent } from "@t3tools/contracts";
import { useState } from "react";

import { harnessName } from "@t3tools/client-runtime/peer/work";

import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { Button } from "../../ui/button";
import { failureMessage } from "../WorkspaceAccess";

/** An agent's question whether to trust its folder, answered here instead of in its terminal. */
export function AgentTrustQuestion({
  environmentId,
  agent,
}: {
  readonly environmentId: EnvironmentId;
  readonly agent: Pick<PeerLocalAgent, "id" | "agent" | "cwd">;
}) {
  const answer = useAtomCommand(serverEnvironment.peerHubAnswerAgentTrust, {
    reportFailure: false,
  });
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const send = (trust: boolean) => {
    setSending(true);
    setFailure(null);
    void answer({ environmentId, input: { agentId: agent.id, trust } })
      .then((result) => setFailure(failureMessage(result)))
      .finally(() => setSending(false));
  };
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border px-3 py-2.5">
      <p className="text-sm">
        {agent.agent === undefined ? "Your agent" : harnessName(agent.agent)} asks whether to trust
        this folder before it starts. It can then read, edit and run files there.
      </p>
      {agent.cwd === undefined ? null : (
        <p className="break-all font-mono text-xs text-muted-foreground">{agent.cwd}</p>
      )}
      {failure === null ? null : <p className="text-xs text-destructive-foreground">{failure}</p>}
      <div className="flex gap-2">
        <Button size="sm" disabled={sending} onClick={() => send(true)}>
          Trust and start
        </Button>
        <Button size="sm" variant="outline" disabled={sending} onClick={() => send(false)}>
          Don't start
        </Button>
      </div>
    </div>
  );
}
