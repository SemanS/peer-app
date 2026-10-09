import { useState } from "react";
import { Alert, Linking, Pressable, View } from "react-native";
import { useAtomValue } from "@effect/atom-react";
import { canChangePeerPlugins } from "@t3tools/client-runtime/peer/plugins";
import {
  canHandOff,
  contextMovedOn,
  isEarlierHandoff,
  outcomeText,
  packageRows,
  keyedLines,
  handoffRevision,
  summaryOf,
} from "@t3tools/client-runtime/peer/handoff";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AppText as Text } from "../../../components/AppText";
import { serverEnvironment } from "../../../state/server";
import { environmentSession } from "../../../state/session";
import { useAtomCommand } from "../../../state/use-atom-command";
import { useEnvironmentQuery } from "../../../state/query";
import type { PeerTaskProps, PeerSectionProps } from "../slotTypes";
export function PeerHandoff({
  environmentId,
  status,
  workspace,
  project,
  task,
  disabled,
  onBusyChange,
}: PeerTaskProps) {
  const [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false),
    [lines, setLines] = useState<string[]>([]);
  const handOff = useAtomCommand(serverEnvironment.peerHandoffHandOff, { reportFailure: false }),
    withdraw = useAtomCommand(serverEnvironment.peerHandoffWithdraw, { reportFailure: false });
  const place = { workspace, projectId: project.project.id, taskId: task.id },
    summaries = summaryOf(status.handoff, place);
  const query = useEnvironmentQuery(
    summaries.length
      ? serverEnvironment.peerHandoffRead({
          environmentId,
          input: { ...place, revision: handoffRevision(summaries, revision) },
        })
      : null,
  );
  const label = canHandOff(task, project.work.threads, status.email),
    current =
      status.coordination.contexts.find(
        (c) =>
          c.workspace === workspace &&
          c.project === project.project.id &&
          c.scope === `task:${task.id}`,
      )?.version ?? null;
  const act = async (remove = false) => {
    setBusy(true);
    onBusyChange(true);
    try {
      const r = await (remove ? withdraw : handOff)({ environmentId, input: place });
      if (r._tag === "Success") setLines(outcomeText(r.value));
      else {
        const e = squashAtomCommandFailure(r);
        setLines([e instanceof Error ? e.message : String(e)]);
      }
      setRevision((v) => v + 1);
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  };
  return (
    <View className="gap-2">
      <Text className="font-t3-medium text-foreground">
        {isEarlierHandoff(task) ? "Earlier handoff" : "Handoff for review"}
      </Text>
      {label ? (
        <Pressable
          accessibilityRole="button"
          disabled={disabled || busy}
          onPress={() => void act()}
        >
          <Text className="text-primary">{busy ? "Handing off…" : label}</Text>
        </Pressable>
      ) : null}
      {query.error ? (
        <Text accessibilityRole="alert" className="text-destructive">
          {query.error}
        </Text>
      ) : null}
      {query.data?.map((p) => (
        <View key={p.author} className="gap-1">
          <Text className="text-foreground">
            Handoff #{p.number} ·{" "}
            {project.project.members.find((m) => m.email === p.author)?.name ?? "Teammate"}
          </Text>
          {contextMovedOn(p, current) ? (
            <Text className="text-foreground-muted">{contextMovedOn(p, current)}</Text>
          ) : null}
          {keyedLines(
            packageRows(
              p,
              (email) =>
                project.project.members.find((m) => m.email === email)?.name ?? "a teammate",
            ),
          ).map(({ id, text: line }) => (
            <Text key={id} className="text-foreground">
              {line}
            </Text>
          ))}
          {p.pullRequests
            .filter((url) =>
              /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9][0-9]*$/.test(
                url,
              ),
            )
            .map((url) => (
              <Pressable
                key={url}
                accessibilityRole="link"
                onPress={() => void Linking.openURL(url)}
              >
                <Text className="text-primary">{url}</Text>
              </Pressable>
            ))}
          {p.author === status.email ? (
            <Pressable
              accessibilityRole="button"
              disabled={disabled || busy}
              onPress={() =>
                Alert.alert(
                  "Withdraw handoff?",
                  "Remove your package and published blocks; task status stays unchanged.",
                  [
                    { text: "Cancel", style: "cancel" },
                    { text: "Withdraw", style: "destructive", onPress: () => void act(true) },
                  ],
                )
              }
            >
              <Text className="text-destructive">Withdraw</Text>
            </Pressable>
          ) : null}
        </View>
      ))}
      {keyedLines([
        ...lines,
        ...(status.handoff?.deliveries
          .filter(
            (o) =>
              o.workspace === workspace && o.project === project.project.id && o.task === task.id,
          )
          .flatMap(outcomeText) ?? []),
      ]).map(({ id, text: line }) => (
        <Text key={id} className="text-foreground-muted">
          {line}
        </Text>
      ))}
    </View>
  );
}
export function HandoffTarget({ environmentId, status }: PeerSectionProps) {
  const session = useAtomValue(environmentSession.sessionStateValueAtom(environmentId));
  const command = useAtomCommand(serverEnvironment.peerHandoffSetTarget, { reportFailure: false }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  if (!canChangePeerPlugins(session) || !status.handoff) return null;
  return (
    <View className="gap-3">
      <Text className="font-t3-medium text-foreground">Handoff publishing</Text>
      <Text className="text-foreground-muted">
        Not at all keeps packages in Peer only. Withdraw before turning the plugin off.
      </Text>
      {status.workspaces.flatMap((w) =>
        w.projects.map((p) => (
          <View key={`${w.slug}/${p.project.id}`} className="gap-1">
            <Text className="text-foreground">
              {w.name} · {p.project.name}
            </Text>
            {(["comment", "description", "none"] as const).map((target) => (
              <Pressable
                key={target}
                accessibilityRole="button"
                accessibilityState={{
                  selected:
                    (status.handoff?.projectTargets[`${w.slug}/${p.project.id}`] ??
                      status.handoff?.target) === target,
                }}
                disabled={busy}
                onPress={() => {
                  setBusy(true);
                  void command({
                    environmentId,
                    input: { workspace: w.slug, projectId: p.project.id, target },
                  })
                    .then((r) => {
                      if (r._tag === "Failure") {
                        const e = squashAtomCommandFailure(r);
                        setError(e instanceof Error ? e.message : String(e));
                      }
                    })
                    .finally(() => setBusy(false));
                }}
              >
                <Text className="text-primary">
                  {target === "none"
                    ? "Not at all"
                    : target === "description"
                      ? "Pull request description"
                      : "Pull request comment"}
                </Text>
              </Pressable>
            ))}
          </View>
        )),
      )}
      {error ? (
        <Text accessibilityRole="alert" className="text-destructive">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
