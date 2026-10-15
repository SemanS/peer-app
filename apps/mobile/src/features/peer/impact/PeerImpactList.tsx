import { useState } from "react";
import { Pressable, View } from "react-native";
import { useAtomValue } from "@effect/atom-react";
import { AuthOrchestrationOperateScope } from "@t3tools/contracts";
import {
  impactAction,
  impactChangeLabel,
  impactRows,
  impactProjectIds,
  impactPlaceAllowed,
  filterImpactView,
  visibleImpactProvided,
  visibleImpactRecords,
} from "@t3tools/client-runtime/peer/impact";
import { activePlugin } from "@t3tools/client-runtime/peer/plugins";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AppText as Text } from "../../../components/AppText";
import { serverEnvironment } from "../../../state/server";
import { environmentSession } from "../../../state/session";
import { useEnvironmentQuery } from "../../../state/query";
import { useAtomCommand } from "../../../state/use-atom-command";
import type { PeerTaskProps } from "../slotTypes";

export function PeerImpactList({
  environmentId,
  status,
  workspace,
  project,
  task,
  disabled,
  onBusyChange,
}: PeerTaskProps) {
  const session = useAtomValue(environmentSession.sessionStateValueAtom(environmentId)),
    operate =
      session?.authenticated === true &&
      session.scopes?.includes(AuthOrchestrationOperateScope) === true,
    place = { workspace, project: project.project.id, task: task.id },
    projectIds = impactProjectIds(status.workspaces, workspace),
    active = activePlugin(status, "impact") && impactPlaceAllowed(projectIds, place);
  const query = useEnvironmentQuery(
    active && status.email
      ? serverEnvironment.peerImpactList({
          environmentId,
          person: status.email,
          projectIds,
          input: { ...place, revision: status.impact?.revision },
        })
      : null,
  );
  const dismiss = useAtomCommand(serverEnvironment.peerImpactDismiss, { reportFailure: false }),
    reopen = useAtomCommand(serverEnvironment.peerImpactReopen, { reportFailure: false });
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const view =
      query.error || query.isPending || !query.data
        ? undefined
        : filterImpactView(query.data, projectIds),
    records = visibleImpactRecords(view, place),
    changes = visibleImpactProvided(view, place);
  if (!active) return null;
  async function change(record: (typeof records)[number]) {
    const action = impactAction(record, operate);
    if (!action || disabled || busy) return;
    setBusy(true);
    onBusyChange(true);
    setError(null);
    try {
      const result = await (action.command === "dismiss" ? dismiss : reopen)({
        environmentId,
        input: { workspace, project: record.project, id: record.id },
      });
      if (result._tag === "Failure") {
        const failure = squashAtomCommandFailure(result);
        setError(failure instanceof Error ? failure.message : String(failure));
      }
      query.refresh();
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }
  return (
    <View className="gap-2">
      <Text className="font-t3-medium text-foreground">Impact</Text>
      <Text className="text-foreground-muted">
        Advice from changed symbols; never blocks an edit.
      </Text>
      {query.isPending ? <Text>Loading impact overlaps…</Text> : null}
      {query.error ? (
        <View>
          <Text accessibilityRole="alert">{query.error}</Text>
          <Pressable accessibilityRole="button" onPress={query.refresh}>
            <Text className="text-primary">Retry</Text>
          </Pressable>
        </View>
      ) : null}
      {records.map((record) => {
        const action = impactAction(record, operate),
          open = expanded.has(record.id);
        return (
          <View key={record.id} className="gap-2">
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: open }}
              onPress={() =>
                setExpanded((value) => {
                  const next = new Set(value);
                  if (next.has(record.id)) next.delete(record.id);
                  else next.add(record.id);
                  return next;
                })
              }
            >
              <Text className="text-foreground">
                {record.sides.map((side) => `${side.label} · ${side.email}`).join(" ↔ ")} ·{" "}
                {record.state}
                {record.reopened ? " · reopened" : ""}
              </Text>
            </Pressable>
            {open ? (
              <View className="gap-2">
                {impactRows(record).map(({ item, label }) => (
                  <Text
                    key={JSON.stringify([item.changer, item.path, item.name])}
                    className="text-foreground"
                  >
                    {label}
                  </Text>
                ))}
                {record.state === "dismissed" && record.dismissedBy ? (
                  <Text className="text-foreground-muted">Dismissed by {record.dismissedBy}.</Text>
                ) : null}
                {action ? (
                  <Pressable
                    accessibilityRole="button"
                    disabled={disabled || busy}
                    onPress={() => void change(record)}
                  >
                    <Text className="text-primary">{action.label}</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </View>
        );
      })}
      {changes.length ? (
        <View className="gap-1">
          <Text className="font-t3-medium">Changed provided interfaces</Text>
          {changes.map((item) => (
            <Text
              key={`${item.side.session}/${item.path}/${item.name}`}
              className="text-foreground"
            >
              {item.name} ({item.path}) · {impactChangeLabel(item.change)} · {item.side.label} ·{" "}
              {item.side.email}
            </Text>
          ))}
        </View>
      ) : null}
      {!query.isPending && !query.error && !records.length && !changes.length ? (
        <Text className="text-foreground-muted">No live impact overlaps.</Text>
      ) : null}
      {error ? <Text accessibilityRole="alert">{error}</Text> : null}
    </View>
  );
}
