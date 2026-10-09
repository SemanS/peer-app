import { EnvironmentId } from "@t3tools/contracts";
import { peerAgentIsBlocked, peerAgentIsGone } from "@t3tools/client-runtime/peer/needs-you";
import type { StaticScreenProps } from "@react-navigation/native";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { AppText, AppTextInput } from "../../../components/AppText";
import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import {
  squashAtomCommandFailure,
  isAtomCommandInterrupted,
} from "@t3tools/client-runtime/state/runtime";
import { NeedsYouScreen } from "./NeedsYouScreen";
export function NeedsYouAgentRouteScreen({
  route,
}: StaticScreenProps<{ environmentId: string; agentId: string }>) {
  const environmentId = EnvironmentId.make(route.params.environmentId),
    query = useEnvironmentQuery(
      serverEnvironment.peerHubWatchAgent({
        environmentId,
        input: { agentId: route.params.agentId },
      }),
    ),
    view = query.data;
  const prompt = useAtomCommand(serverEnvironment.peerHubPromptAgent, { reportFailure: false });
  const [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const blocked = view !== null && peerAgentIsBlocked(view.status),
    gone = peerAgentIsGone(view),
    disabled = busy || blocked || gone || query.error !== null;
  return (
    <NeedsYouScreen title={view?.title ?? "Agent"}>
      {query.error ? <AppText accessibilityRole="alert">{query.error}</AppText> : null}
      {gone ? (
        <AppText accessibilityLiveRegion="polite">
          {view?.gone ? "This agent is no longer running." : "Connecting to the agent…"}
        </AppText>
      ) : null}
      {blocked ? <AppText accessibilityRole="alert">Answer it in herdr.</AppText> : null}
      {view?.entries?.slice(-50).map((entry) => (
        <View key={entry.id} className="gap-1 rounded-lg bg-card p-3">
          <AppText className="text-xs text-foreground-muted">{entry.kind}</AppText>
          <AppText selectable>
            {entry.kind === "tool"
              ? [entry.name, entry.summary, entry.result].filter(Boolean).join("\n")
              : entry.text}
          </AppText>
        </View>
      ))}
      {view?.terminal ? (
        <AppText selectable className="font-t3-mono text-sm">
          {view.terminal}
        </AppText>
      ) : null}
      {view?.hint ? <AppText className="text-sm text-foreground-muted">{view.hint}</AppText> : null}
      <AppTextInput
        accessibilityLabel="Message for agent"
        placeholder="Message for agent"
        value={text}
        onChangeText={setText}
        editable={!disabled}
        multiline
        className="rounded-lg bg-card p-3"
      />
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: disabled || !text.trim() }}
        disabled={disabled || !text.trim()}
        onPress={() => {
          setBusy(true);
          setError(null);
          void prompt({
            environmentId,
            input: { agentId: route.params.agentId, text: text.trim() },
          })
            .then((result) => {
              if (result._tag === "Success") setText("");
              else if (!isAtomCommandInterrupted(result)) {
                const cause = squashAtomCommandFailure(result);
                setError(cause instanceof Error ? cause.message : String(cause));
              }
            })
            .finally(() => setBusy(false));
        }}
      >
        <AppText className="text-primary">Send message</AppText>
      </Pressable>
      {error ? (
        <AppText accessibilityRole="alert" className="text-destructive">
          {error}
        </AppText>
      ) : null}
    </NeedsYouScreen>
  );
}
