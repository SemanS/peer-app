import { useAtomValue } from "@effect/atom-react";
import { buildWorkTree } from "@t3tools/client-runtime/peer/work";
import { personName as emailName } from "@t3tools/client-runtime/peer/jujutsu";
import type { EnvironmentId, PeerHubStatus, PeerProjectState } from "@t3tools/contracts";
import { useState } from "react";

import { useThreadShells } from "../../../state/entities";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { Button } from "../../ui/button";
import { useRelativeTimeTick } from "../../settings/settingsLayout";
import { usePeerPlugins } from "../slots";
import type { PairActionProps } from "../slots.types";
import { failureMessage } from "../WorkspaceAccess";
import { personName } from "../workTree.logic";
import {
  followOutcome,
  localSessions,
  pairAction,
  type PairAction,
  type PairActionTask,
} from "./pairActions.logic";

type Message = { readonly text: string; readonly failed: boolean };

/**
 * What a forecast pair's card offers for the change started later: build it on the other change
 * where the pair merges clean and fails the check, resolve a conflict together, and, on a computer
 * where the later side does not run, ask its person to do either. Nothing here rewrites either
 * side's change.
 */
export function PairActions({ environmentId, status, workspace, project, pair }: PairActionProps) {
  const plugins = usePeerPlugins(status);
  const projectId = project?.project.id ?? pair.project;
  const action: PairAction =
    project === undefined
      ? { kind: "none" }
      : pairAction({
          pair,
          tasks: project.work.tasks,
          sessions: localSessions({ status, workspace, project }),
          me: status.email,
          nameOf: (email) =>
            project === undefined ? emailName(email) : personName(project, email),
        });
  const hasRequests = plugins.some((plugin) => plugin.requestTeammate !== undefined);
  const Launcher = plugins.find((plugin) => plugin.taskLauncher !== undefined)?.taskLauncher;
  const follow = useAtomCommand(serverEnvironment.peerJujutsuFollow, { reportFailure: false });
  const integrate = useAtomCommand(serverEnvironment.peerJujutsuIntegrate, {
    reportFailure: false,
  });
  const canFollow = useAtomValue(serverEnvironment.peerJujutsuFollow.permissionAtom(environmentId));
  const canIntegrate = useAtomValue(
    serverEnvironment.peerJujutsuIntegrate.permissionAtom(environmentId),
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [asking, setAsking] = useState(false);
  const [launch, setLaunch] = useState<string | null>(null);

  if (action.kind === "none") return null;
  if (action.kind === "ask" && !hasRequests) return null;
  if (action.kind === "resolve" && Launcher === undefined) return null;

  const run = (job: () => Promise<Message | null>) => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    void job()
      .then(setMessage)
      .finally(() => setBusy(false));
  };

  const build = (built: Extract<PairAction, { kind: "build" }>) =>
    run(async () => {
      const result = await follow({
        environmentId,
        input: { workspace, project: projectId, session: built.session, task: built.onto.id },
      });
      const failure = failureMessage(result);
      if (failure !== null) return { text: failure, failed: true };
      return result._tag === "Success"
        ? { text: followOutcome(result.value, built), failed: false }
        : null;
    });

  const resolve = (resolving: Extract<PairAction, { kind: "resolve" }>) =>
    run(async () => {
      const result = await integrate({
        environmentId,
        input: { workspace, project: projectId, ...resolving.integrate },
      });
      const failure = failureMessage(result);
      if (failure !== null) return { text: failure, failed: true };
      if (result._tag === "Success") setLaunch(result.value.bookmark);
      return null;
    });

  return (
    <div className="flex flex-col items-start gap-1.5">
      {action.kind === "build" ? (
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !canFollow}
          onClick={() => build(action)}
        >
          {busy ? "Building…" : action.label}
        </Button>
      ) : action.kind === "resolve" ? (
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !canIntegrate}
          onClick={() => resolve(action)}
        >
          {busy ? "Making the integration…" : action.label}
        </Button>
      ) : (
        <>
          <Button size="sm" variant="outline" onClick={() => setAsking(true)}>
            {action.label}
          </Button>
          <p className="text-xs text-muted-foreground">{action.note}</p>
        </>
      )}
      {message === null ? null : (
        <p
          role={message.failed ? "alert" : "status"}
          className={
            message.failed ? "text-xs text-destructive-foreground" : "text-xs text-muted-foreground"
          }
        >
          {message.text}
        </p>
      )}
      {action.kind === "ask" && asking ? (
        <AskDialog
          environmentId={environmentId}
          status={status}
          workspace={workspace}
          projectId={projectId}
          task={action.task}
          recipient={action.recipient}
          instruction={action.instruction}
          onClose={() => setAsking(false)}
        />
      ) : null}
      {action.kind === "resolve" && launch !== null && Launcher !== undefined && project ? (
        <Launcher
          environmentId={environmentId}
          status={status}
          workspace={workspace}
          project={project}
          taskId={action.later.id}
          taskLabel={action.later.label}
          baseBranch={launch}
          initialOpen
          onClose={() => setLaunch(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * The existing request to a teammate, opened on the later side's task with the person and the
 * instruction filled in. The work tree it needs is built only while the dialog is open.
 */
function AskDialog({
  environmentId,
  status,
  workspace,
  projectId,
  task,
  recipient,
  instruction,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly workspace: string;
  readonly projectId: PeerProjectState["project"]["id"];
  readonly task: PairActionTask;
  readonly recipient: string;
  readonly instruction: string;
  readonly onClose: () => void;
}) {
  const plugins = usePeerPlugins(status);
  const threadShells = useThreadShells();
  const now = useRelativeTimeTick(30_000);
  const Dialog = plugins.find((plugin) => plugin.requestTeammate !== undefined)?.requestTeammate;
  const node = buildWorkTree({ status, localThreads: threadShells, now }).find(
    (candidate) => candidate.workspace === workspace && candidate.projectId === projectId,
  );
  if (Dialog === undefined || node === undefined) return null;
  return (
    <Dialog
      environmentId={environmentId}
      status={status}
      project={node}
      task={task}
      prefill={{ recipient, prompt: instruction }}
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    />
  );
}
