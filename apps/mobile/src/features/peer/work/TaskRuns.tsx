import { useAtomValue } from "@effect/atom-react";
import { NO_RUNS_TEXT } from "@t3tools/client-runtime/peer/runs";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, PeerHubStatus, PeerProjectState } from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, View } from "react-native";

import { AppText } from "../../../components/ui/AppText";
import { serverEnvironment } from "../../../state/server";
import { useEnvironmentQuery } from "../../../state/query";
import { useAtomCommand } from "../../../state/use-atom-command";
import { useMinuteClock } from "../ownership/useMinuteClock";
import { mobileRunRows } from "./taskRuns.logic";

/**
 * A task's runs on the phone, newest first: who runs which agent where, in what state, and End
 * run for a run the person may end. Read again whenever `revision` (the live task) changes.
 */
export function TaskRuns({
  environmentId,
  status,
  workspace,
  project,
  taskId,
  revision,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly workspace: string;
  readonly project: PeerProjectState;
  readonly taskId: string;
  readonly revision: string;
}) {
  const projectId = project.project.id;
  const query = useEnvironmentQuery(
    serverEnvironment.peerRunsList({ environmentId, input: { workspace, projectId, taskId } }),
  );
  const { refresh } = query;
  // The query reads on mount; only a later change of the task reads again.
  const seen = useRef(revision);
  useEffect(() => {
    if (revision === seen.current) return;
    seen.current = revision;
    refresh();
  }, [refresh, revision]);
  const end = useAtomCommand(serverEnvironment.peerRunsEnd, { reportFailure: false });
  const allowed = useAtomValue(serverEnvironment.peerRunsEnd.permissionAtom(environmentId));
  const now = useMinuteClock();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const rows = mobileRunRows(query.data?.runs ?? [], {
    me: status.email,
    now,
    project,
  });

  const confirmEnd = (id: string, agent: string) =>
    Alert.alert(`End the run of ${agent}?`, "Its agent's sessions stay as they are.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "End run",
        style: "destructive",
        onPress: () => {
          setBusy(id);
          setMessage(null);
          void end({ environmentId, input: { workspace, projectId, runId: id } })
            .then((result) => {
              if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
                const cause = squashAtomCommandFailure(result);
                setMessage(cause instanceof Error ? cause.message : String(cause));
              }
              refresh();
            })
            .finally(() => setBusy(null));
        },
      },
    ]);

  return (
    <View className="gap-2">
      <AppText accessibilityRole="header" className="font-t3-semibold">
        Runs
      </AppText>
      {query.error === null ? null : (
        <AppText accessibilityRole="alert" className="text-sm text-foreground-muted">
          {query.error}
        </AppText>
      )}
      {rows.length === 0 ? (
        <AppText accessibilityLiveRegion="polite" className="text-sm text-foreground-muted">
          {query.data === null && query.error === null ? "Loading runs…" : `${NO_RUNS_TEXT}.`}
        </AppText>
      ) : (
        rows.map((row) => (
          <View key={row.id} className="gap-1 rounded-xl border border-border p-3">
            <AppText className="font-t3-medium">{row.title}</AppText>
            <AppText className={row.running ? "text-sm text-primary-text" : "text-sm"}>
              {row.state}
            </AppText>
            <AppText className="text-sm text-foreground-muted">{row.detail}</AppText>
            {row.hint === undefined ? null : (
              <AppText className="text-sm text-foreground-muted">{row.hint}</AppText>
            )}
            {row.canEnd && allowed ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`End the run of ${row.agent}`}
                disabled={busy === row.id}
                accessibilityState={{ disabled: busy === row.id }}
                className="min-h-11 justify-center"
                onPress={() => confirmEnd(row.id, row.agent)}
              >
                <AppText className="text-primary-text">
                  {busy === row.id ? "Ending…" : "End run"}
                </AppText>
              </Pressable>
            ) : null}
          </View>
        ))
      )}
      {message === null ? null : <AppText accessibilityLiveRegion="polite">{message}</AppText>}
    </View>
  );
}
