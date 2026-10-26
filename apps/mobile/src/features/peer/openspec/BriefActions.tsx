import {
  briefActionLabel,
  briefActions,
  briefDiff,
  briefStateText,
  type BriefAction,
} from "@t3tools/client-runtime/peer/openspec";
import {
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, PeerOpenSpecReadResult } from "@t3tools/contracts";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../../components/ui/AppText";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { openSpecAtoms } from "./atoms";

const failure = (result: AtomCommandResult<unknown, unknown>) =>
  result._tag === "Failure" ? String(squashAtomCommandFailure(result)) : null;

/** The brief's state against OpenSpec and what a person can do; own briefs are edited on desktop. */
export function BriefActions({
  environmentId,
  workspace,
  projectId,
  taskId,
  repositoryId,
  data,
  onChanged,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: string;
  readonly projectId: string;
  readonly taskId: string;
  readonly repositoryId: string | undefined;
  readonly data: PeerOpenSpecReadResult;
  readonly onChanged: () => void;
}) {
  const link = useAtomCommand(openSpecAtoms.link, { reportFailure: false });
  const unlink = useAtomCommand(openSpecAtoms.unlink, { reportFailure: false });
  const updateTask = useAtomCommand(serverEnvironment.peerHubUpdateTask, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const state = data.link;
  if (state === undefined) return null;
  const brief = state.brief;
  const target = { workspace, projectId, taskId, expectedRevision: brief?.revision ?? 0 };
  const run = async (call: () => Promise<AtomCommandResult<unknown, unknown>>) => {
    setBusy(true);
    setError(null);
    const failed = failure(await call());
    setBusy(false);
    setError(failed);
    if (failed === null) setChoosing(false);
    onChanged();
  };
  const linkTo = (change: string | undefined) =>
    run(() =>
      link({
        environmentId,
        input: {
          ...target,
          ...(change === undefined ? {} : { change }),
          ...(repositoryId === undefined ? {} : { repositoryId }),
        },
      }),
    );
  const act = (action: BriefAction) => {
    switch (action.kind) {
      case "link":
      case "relink-mapped":
        return void linkTo(action.change);
      case "update":
        return void linkTo(undefined);
      case "relink":
        return setChoosing(true);
      case "keep":
      case "unlink":
        return void run(() => unlink({ environmentId, input: target }));
      case "close":
        return void run(() =>
          updateTask({ environmentId, input: { workspace, projectId, taskId, status: "done" } }),
        );
      case "edit":
      case "write":
        return;
    }
  };
  const text = briefStateText(state);
  const diff =
    state.state === "changed" && brief !== null && data.state === "ready" && data.snapshot
      ? briefDiff(brief, data.snapshot)
      : null;
  const actions = briefActions(state);
  const editable = actions.filter((action) => action.kind === "edit" || action.kind === "write");
  const changes = (state.changes ?? []).filter((one) => one !== brief?.source?.change);
  return (
    <View className="gap-2">
      {text === null ? null : <Text className="text-sm text-foreground-muted">{text}</Text>}
      {diff === null
        ? null
        : [
            ...(diff.goalChanged ? ["The goal changed."] : []),
            ...diff.added.map((item) => `Added: ${item}`),
            ...diff.removed.map((item) => `Removed: ${item}`),
            ...diff.toggled.map((item) => `${item.done ? "Done" : "Reopened"}: ${item.text}`),
          ].map((line) => (
            <Text key={line} className="text-sm text-foreground">
              {line}
            </Text>
          ))}
      {actions
        .filter((action) => action.kind !== "edit" && action.kind !== "write")
        .map((action) => (
          <Pressable
            key={action.kind}
            accessibilityRole="button"
            disabled={busy}
            onPress={() => act(action)}
            className="py-2 disabled:opacity-50"
          >
            <Text className="text-primary">{briefActionLabel(action)}</Text>
          </Pressable>
        ))}
      {editable.length === 0 ? null : (
        <Text className="text-sm text-foreground-muted">
          Edit this task's brief in Peer on desktop.
        </Text>
      )}
      {choosing
        ? changes.length === 0
          ? [
              <Text key="none" className="text-sm text-foreground-muted">
                The repository has no other OpenSpec change to link.
              </Text>,
            ]
          : changes.map((change) => (
              <Pressable
                key={change}
                accessibilityRole="button"
                disabled={busy}
                onPress={() => void linkTo(change)}
                className="py-2 pl-3 disabled:opacity-50"
              >
                <Text className="text-primary">Link to {change}</Text>
              </Pressable>
            ))
        : null}
      {error === null ? null : (
        <Text accessibilityRole="alert" className="text-sm text-foreground">
          {error}
        </Text>
      )}
    </View>
  );
}
