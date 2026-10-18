import { useRef, useState } from "react";
import type { EnvironmentId, PeerRecipeSummary } from "@t3tools/contracts";
import {
  askableAgents,
  recipeOperation,
  recipeDeliveryText,
  recipeLabel,
  type AskableAgent,
  type RecipeOperation,
} from "@t3tools/client-runtime/peer-recipes";
import { useThreadShells } from "../../../state/entities";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { useEnvironmentQuery } from "../../../state/query";
import { randomUUID } from "../../../lib/utils";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Select, SelectTrigger, SelectValue, SelectPopup, SelectItem } from "../../ui/select";
import { toastManager } from "../../ui/toast";
import { PeerSectionLabel } from "../PeerPageHeader";
import { failureMessage } from "../WorkspaceAccess";
import type { TaskContextSlotProps } from "../slots.types";
import { withFinally } from "~/lib/withFinally";
function AgentRecipe({
  environmentId,
  agent,
  recipes,
}: {
  environmentId: EnvironmentId;
  agent: AskableAgent;
  recipes: ReadonlyArray<PeerRecipeSummary>;
}) {
  const [name, setName] = useState(""),
    [input, setInput] = useState(""),
    [busy, setBusy] = useState(false);
  const operation = useRef<RecipeOperation | null>(null);
  const send = useAtomCommand(serverEnvironment.peerRecipes.send, { reportFailure: false });
  const recipe = recipes.find((r) => r.name === name);
  const act = async () => {
    if (!recipe || busy || agent.reason) return;
    const pending = recipeOperation(operation.current, agent.target, name, input, randomUUID);
    operation.current = pending;
    setBusy(true);
    await withFinally(
      async () => {
        const r = await send({
          environmentId,
          input: { target: agent.target, recipe: recipe.name, input, op: pending.id },
        });
        if (r._tag === "Success") {
          toastManager.add({ type: "success", title: recipeDeliveryText(agent.title, r.value) });
          operation.current = null;
          setName("");
          setInput("");
        } else
          toastManager.add({
            type: "error",
            title: failureMessage(r) ?? "Could not send the recipe.",
          });
      },
      () => {
        setBusy(false);
      },
    );
  };
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{agent.title}</p>
      {agent.reason ? <p className="text-xs text-muted-foreground">{agent.reason}</p> : null}
      <div className="flex items-center gap-2">
        <Select
          value={name}
          items={recipes.map((r) => ({ value: r.name, label: recipeLabel(r) }))}
          disabled={busy || !!agent.reason}
          onValueChange={(v) => {
            setName(v ?? "");
            setInput("");
          }}
        >
          <SelectTrigger size="sm" aria-label={`Recipe for ${agent.title}`}>
            <SelectValue placeholder="Choose a recipe" />
          </SelectTrigger>
          <SelectPopup>
            {recipes.map((r) => (
              <SelectItem key={r.name} value={r.name}>
                {recipeLabel(r)}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <Button size="sm" disabled={!recipe || busy || !!agent.reason} onClick={() => void act()}>
          {busy ? "Sending…" : "Send"}
        </Button>
      </div>
      {recipe?.hint ? (
        <Input
          aria-label={`${recipe.hint} (optional)`}
          placeholder={`${recipe.hint} (optional)`}
          value={input}
          maxLength={4000}
          disabled={busy || !!agent.reason}
          onChange={(e) => setInput(e.target.value)}
        />
      ) : null}
    </div>
  );
}
export function AskMyAgent({
  environmentId,
  status,
  workspace,
  project,
  scope,
}: TaskContextSlotProps) {
  const localThreads = useThreadShells();
  const query = useEnvironmentQuery(
    serverEnvironment.peerRecipes.list({
      environmentId,
      input: { revision: JSON.stringify(status.plugins) },
    }),
  );
  const recipes = query.data?.recipes ?? [];
  if (!scope.startsWith("task:") || query.error || !query.data?.enabled || !recipes.length)
    return null;
  const agents = askableAgents(status, { workspace, project, task: scope.slice(5) }, localThreads);
  return (
    <section aria-label="Ask your agent" className="flex flex-col gap-2.5">
      <PeerSectionLabel>Ask your agent</PeerSectionLabel>
      {agents.length ? (
        agents.map((agent) => (
          <AgentRecipe
            key={JSON.stringify(agent.target)}
            environmentId={environmentId}
            agent={agent}
            recipes={recipes}
          />
        ))
      ) : (
        <p className="text-sm text-muted-foreground">
          No own coordinating agent is running on this task.
        </p>
      )}
    </section>
  );
}
