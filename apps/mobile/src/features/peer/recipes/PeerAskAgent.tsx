import { useRef, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { randomUUID } from "expo-crypto";
import type { EnvironmentId, PeerRecipeSummary } from "@t3tools/contracts";
import {
  askableAgents,
  recipeDeliveryText,
  recipeOperation,
  type AskableAgent,
  type RecipeOperation,
} from "@t3tools/client-runtime/peer-recipes";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AppText as Text } from "../../../components/AppText";
import { useThreadShells } from "../../../state/entities";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { useEnvironmentQuery } from "../../../state/query";
import type { PeerTaskProps } from "../slotTypes";
function AgentRecipe({
  environmentId,
  agent,
  recipes,
  disabled,
  onBusyChange,
}: {
  environmentId: EnvironmentId;
  agent: AskableAgent;
  recipes: ReadonlyArray<PeerRecipeSummary>;
  disabled: boolean;
  onBusyChange: (b: boolean) => void;
}) {
  const [name, setName] = useState(""),
    [input, setInput] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState<string | null>(null);
  const operation = useRef<RecipeOperation | null>(null);
  const send = useAtomCommand(serverEnvironment.peerRecipes.send, { reportFailure: false });
  const recipe = recipes.find((r) => r.name === name),
    locked = disabled || busy || !!agent.reason;
  const act = async () => {
    if (!recipe || locked) return;
    operation.current = recipeOperation(operation.current, agent.target, name, input, randomUUID);
    setBusy(true);
    onBusyChange(true);
    setMessage(null);
    try {
      const r = await send({
        environmentId,
        input: { target: agent.target, recipe: recipe.name, input, op: operation.current.id },
      });
      if (r._tag === "Success") {
        setMessage(recipeDeliveryText(agent.title, r.value));
        operation.current = null;
        setName("");
        setInput("");
      } else {
        const error = squashAtomCommandFailure(r);
        setMessage(error instanceof Error ? error.message : String(error));
      }
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  };
  return (
    <View className="gap-2">
      <Text className="font-t3-medium text-foreground">{agent.title}</Text>
      {agent.reason ? <Text className="text-foreground-muted">{agent.reason}</Text> : null}
      <View className="flex-row flex-wrap gap-3">
        {recipes.map((r) => (
          <Pressable
            key={r.name}
            accessibilityRole="button"
            accessibilityState={{ selected: name === r.name, disabled: locked }}
            disabled={locked}
            onPress={() => {
              setName(r.name);
              setInput("");
            }}
          >
            <Text className={name === r.name ? "font-t3-medium text-primary" : "text-foreground"}>
              {r.title}
              {r.access === "read" ? " (reads only)" : ""}
            </Text>
          </Pressable>
        ))}
      </View>
      {recipe?.hint ? (
        <TextInput
          accessibilityLabel={`${recipe.hint} (optional)`}
          placeholder={`${recipe.hint} (optional)`}
          className="rounded-md border border-border p-2 text-foreground"
          editable={!locked}
          maxLength={4000}
          value={input}
          onChangeText={setInput}
        />
      ) : null}
      <Pressable accessibilityRole="button" disabled={locked || !recipe} onPress={() => void act()}>
        <Text className={locked || !recipe ? "text-foreground-muted" : "text-primary"}>
          {busy ? "Sending…" : "Send"}
        </Text>
      </Pressable>
      {message ? (
        <Text accessibilityRole="alert" className="text-foreground">
          {message}
        </Text>
      ) : null}
    </View>
  );
}
export function PeerAskAgent({
  environmentId,
  status,
  workspace,
  project,
  task,
  disabled,
  onBusyChange,
}: PeerTaskProps) {
  const localThreads = useThreadShells();
  const query = useEnvironmentQuery(
    serverEnvironment.peerRecipes.list({
      environmentId,
      input: { revision: JSON.stringify(status.plugins) },
    }),
  );
  const recipes = query.data?.recipes ?? [];
  if (query.error || !query.data?.enabled || !recipes.length) return null;
  const agents = askableAgents(
    status,
    { workspace, project: project.project.id, task: task.id },
    localThreads,
  );
  return (
    <View className="gap-3">
      <Text className="font-t3-medium text-foreground">Ask your agent</Text>
      {agents.length ? (
        agents.map((a) => (
          <AgentRecipe
            key={JSON.stringify(a.target)}
            environmentId={environmentId}
            agent={a}
            recipes={recipes}
            disabled={disabled}
            onBusyChange={onBusyChange}
          />
        ))
      ) : (
        <Text className="text-foreground-muted">
          No own coordinating agent is running on this task.
        </Text>
      )}
    </View>
  );
}
