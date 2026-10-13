import { useAtomValue } from "@effect/atom-react";
import { personName } from "@t3tools/client-runtime/peer/work";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../../components/AppText";
import { serverEnvironment } from "../../../state/server";
import { environmentSession } from "../../../state/session";
import { useAtomCommand } from "../../../state/use-atom-command";
import type { PeerTaskProps } from "../slotTypes";
import { AgreementCard } from "./AgreementCard";
import {
  agreementsSection,
  canChangeAgreements,
  failureWords,
  type AgreementAction,
  type AgreementRow,
} from "./agreements.logic";
import { useAgreementsView } from "./useAgreementsView";

/** The time, for "settled 12 min ago", moved on every minute. */
function useMinuteClock(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function ReadError({
  message,
  onRetry,
}: {
  readonly message: string;
  readonly onRetry: () => void;
}) {
  return (
    <View className="gap-1">
      <Text accessibilityRole="alert" className="text-danger-foreground">
        {message}
      </Text>
      <Pressable accessibilityRole="button" onPress={onRetry}>
        <Text className="text-primary">Retry</Text>
      </Pressable>
    </View>
  );
}

/**
 * Agreements of the selected task: what the agents of two tasks agreed when they settled an
 * overlap, as web lists them, with Close (as handled or not needed) and Reopen. Nothing in it stops
 * an edit or a merge. Absent while the task has none, and while Agreements is off or the Hub does
 * not serve it. A close or a reopen that fails says why under its row and leaves the row as it was.
 */
export function PeerTaskAgreements({
  environmentId,
  status,
  workspace,
  project,
  task,
  disabled,
  onBusyChange,
}: PeerTaskProps) {
  const now = useMinuteClock();
  const session = useAtomValue(environmentSession.sessionStateValueAtom(environmentId));
  const { view, error, refresh, apply } = useAgreementsView({
    environmentId,
    status,
    workspace,
    project: project.project.id,
  });
  const close = useAtomCommand(serverEnvironment.peerAgreementsClose, { reportFailure: false });
  const reopen = useAtomCommand(serverEnvironment.peerAgreementsReopen, { reportFailure: false });
  const [acting, setActing] = useState<{
    readonly id: string;
    readonly action: AgreementAction;
  } | null>(null);
  const [failure, setFailure] = useState<{ readonly id: string; readonly message: string } | null>(
    null,
  );
  const section = agreementsSection({
    status,
    workspace,
    projectId: project.project.id,
    taskId: task.id,
    tasks: project.work.tasks,
    personLabel: (email) => personName(project, email),
    view,
    error,
    now,
    canChange: canChangeAgreements(session?.scopes),
  });
  if (section.kind === "none") return null;

  const act = async (row: AgreementRow, action: AgreementAction) => {
    if (disabled || acting !== null) return;
    setActing({ id: row.id, action });
    setFailure(null);
    onBusyChange(true);
    try {
      const target = { workspace, project: row.project, id: row.id };
      const result =
        action === "reopen"
          ? await reopen({ environmentId, input: target })
          : await close({ environmentId, input: { ...target, why: action } });
      if (result._tag === "Success") {
        apply(result.value.agreement);
      } else if (!isAtomCommandInterrupted(result)) {
        setFailure({
          id: row.id,
          message: failureWords(squashAtomCommandFailure(result), action),
        });
      }
      // The Hub's list is the truth: a failure may mean the row was out of date.
      refresh();
    } finally {
      setActing(null);
      onBusyChange(false);
    }
  };

  return (
    <View className="gap-2">
      <Text accessibilityRole="header" className="font-t3-medium text-foreground">
        Agreements
      </Text>
      <Text className="text-sm text-foreground-muted">
        What the agents of two tasks agreed when they settled an overlap. Nothing here stops an edit
        or a merge.
      </Text>
      {section.kind === "loading" ? (
        <Text className="text-foreground-muted">Loading agreements…</Text>
      ) : null}
      {section.kind === "failed" ? <ReadError message={section.message} onRetry={refresh} /> : null}
      {section.kind === "list" ? (
        <>
          {section.error === null ? null : <ReadError message={section.error} onRetry={refresh} />}
          {section.rows.map((row) => (
            <AgreementCard
              key={row.id}
              row={row}
              disabled={disabled || acting !== null}
              acting={acting?.id === row.id ? acting.action : null}
              error={failure?.id === row.id ? failure.message : null}
              onAct={(action) => void act(row, action)}
            />
          ))}
          {section.note === null ? null : (
            <Text className="text-sm text-foreground-muted">{section.note}</Text>
          )}
        </>
      ) : null}
    </View>
  );
}
