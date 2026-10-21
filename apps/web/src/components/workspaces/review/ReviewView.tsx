import {
  coordinationActorLabel,
  coordinationEventLabel,
  coordinationTimeline,
} from "@t3tools/client-runtime/coordinationTimeline";
import type { EnvironmentId, PeerHubStatus } from "@t3tools/contracts";
import { needsByOpen, taskOwnership } from "@t3tools/client-runtime/peer/work";
import { useNavigate } from "@tanstack/react-router";
import { FileTextIcon } from "lucide-react";
import { useId, useState } from "react";

import { newMessageId } from "../../../lib/utils";
import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import { threadEnvironment } from "../../../state/threads";
import { useAtomCommand } from "../../../state/use-atom-command";
import { formatRelativeTimeLabel } from "../../../timestampFormat";
import { Button } from "../../ui/button";
import { SidebarInset } from "../../ui/sidebar";
import { Textarea } from "../../ui/textarea";
import { PeerDialogMessage } from "../PeerDialog";
import { PeerPageHeader } from "../PeerPageHeader";
import { useCoordinationRefresh } from "../SharedInputs";
import type { PeerWebPlugin } from "../slots.types";
import { useWorkData } from "../useWorkData";
import { failureMessage } from "../WorkspaceAccess";
import type { WorkTaskNode } from "../workTree.logic";
import { HandoffChatContext, type HandoffChat } from "./HandoffChat";
import { handoffChat, reopenTarget, reviewState } from "./review.logic";
import { withFinally } from "~/lib/withFinally";

/**
 * A task in review, for the person who reviews it: what the plugins show of it (the handoff
 * package, its pull requests), its timeline, and the two ways on — Mark done, or Reopen with a
 * note that the person's own agent on it hears.
 */
export function ReviewView({
  workspace,
  project,
  task: taskId,
}: {
  readonly workspace: string;
  readonly project: string;
  readonly task: string;
}) {
  const { environmentId, status, plugins, tree, actions, needs } = useWorkData();
  const needOf = needsByOpen(needs);
  const node = tree.find((p) => p.workspace === workspace && p.projectId === project);
  const area = node?.areas.find((candidate) => candidate.tasks.some((t) => t.id === taskId));
  const task = area?.tasks.find((t) => t.id === taskId);
  const found = task === undefined ? null : handoffChat(task);
  const chat: HandoffChat | null =
    found === null ? null : { title: found.title, open: () => actions.open(found.open) };
  const state = status?.workspaces
    .find((w) => w.slug === workspace)
    ?.projects.find((p) => p.project.id === project);
  const hubTask = state?.work.tasks.find((t) => t.id === taskId);
  const projectName = node?.name ?? state?.project.name ?? project;
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <PeerPageHeader
          project={{ name: projectName, colorKey: `${workspace}/${project}` }}
          task={hubTask === undefined ? undefined : { key: hubTask.key, title: hubTask.title }}
          page="Review"
          state={
            task === undefined || node === undefined
              ? undefined
              : reviewState(task, needOf, taskOwnership(node, task, area?.name ?? null).review)
          }
        />
        <div className="min-h-0 flex-1 overflow-y-auto">
          {status === null || environmentId === null ? (
            <p role="status" className="px-6 py-6 text-sm text-muted-foreground">
              Connecting…
            </p>
          ) : hubTask === undefined || task === undefined ? (
            <p className="px-6 py-6 text-sm text-muted-foreground">
              This task is no longer on the project.
            </p>
          ) : (
            <div className="flex min-h-full min-w-0 flex-col px-4 py-5 sm:px-7">
              <div className="flex min-w-0 flex-col gap-5">
                <div className="flex max-w-3xl flex-col gap-6">
                  <h1 className="text-lg font-semibold tracking-tight text-foreground [overflow-wrap:anywhere]">
                    {hubTask.title}
                  </h1>
                  <HandoffChatContext value={chat}>
                    {plugins.map(({ id, taskReview: Section }) =>
                      Section === undefined ? null : (
                        <Section
                          key={id}
                          environmentId={environmentId}
                          status={status}
                          workspace={workspace}
                          project={project}
                          scope={`task:${taskId}`}
                          contextText={null}
                        />
                      ),
                    )}
                  </HandoffChatContext>
                  {noReviewSections(plugins) ? (
                    <p className="text-sm text-muted-foreground">
                      Turn on Handoff or GitHub in Settings → Peer → Coordination & plugins to see
                      the package and the pull requests here.
                    </p>
                  ) : null}
                  <ReviewTimeline
                    environmentId={environmentId}
                    status={status}
                    workspace={workspace}
                    project={project}
                    task={taskId}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
        {environmentId === null || hubTask === undefined || task === undefined ? null : (
          <div className="max-h-[55dvh] shrink-0 overflow-y-auto border-t border-border bg-background px-4 py-3 sm:px-7">
            <ReviewActions
              environmentId={environmentId}
              workspace={workspace}
              project={project}
              task={task}
              chat={chat}
              done={hubTask.status === "done"}
            />
          </div>
        )}
      </div>
    </SidebarInset>
  );
}

function noReviewSections(plugins: ReadonlyArray<PeerWebPlugin>): boolean {
  return plugins.every((plugin) => plugin.taskReview === undefined);
}

/** Mark done, or reopen with a note to the person's own agent on the task. */
function ReviewActions({
  environmentId,
  workspace,
  project,
  task,
  chat,
  done,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: string;
  readonly project: string;
  readonly task: WorkTaskNode;
  readonly chat: HandoffChat | null;
  readonly done: boolean;
}) {
  const formId = useId();
  const navigate = useNavigate();
  const { threads } = useWorkData();
  const updateTask = useAtomCommand(serverEnvironment.peerHubUpdateTask, { reportFailure: false });
  const startTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const promptAgent = useAtomCommand(serverEnvironment.peerHubPromptAgent, {
    reportFailure: false,
  });
  const [writing, setWriting] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ readonly text: string; readonly failed: boolean }>();
  const place = { workspace, projectId: project, taskId: task.id };

  const setStatus = async (next: "done" | "open") => {
    const failure = failureMessage(
      await updateTask({ environmentId, input: { ...place, status: next } }),
    );
    if (failure !== null) setMessage({ text: failure, failed: true });
    return failure === null;
  };

  const markDone = async () => {
    setBusy(true);
    setMessage(undefined);
    await withFinally(
      async () => {
        if (await setStatus("done")) setMessage({ text: "Marked done.", failed: false });
      },
      () => {
        setBusy(false);
      },
    );
  };

  const reopen = async () => {
    const text = note.trim();
    if (text === "") return;
    setBusy(true);
    setMessage(undefined);
    await withFinally(
      async () => {
        if (!(await setStatus("open"))) return;
        const target = reopenTarget(task);
        if (target.kind === "thread") {
          const shell = threads.find(
            (thread) =>
              thread.environmentId === target.environmentId && thread.id === target.threadId,
          );
          const failure =
            shell === undefined
              ? "Its thread is no longer on this computer."
              : failureMessage(
                  await startTurn({
                    environmentId: target.environmentId,
                    input: {
                      threadId: target.threadId,
                      message: { messageId: newMessageId(), role: "user", text, attachments: [] },
                      runtimeMode: shell.runtimeMode,
                      interactionMode: shell.interactionMode,
                      dispatchMode: "auto",
                    },
                  }),
                );
          setMessage(
            failure === null
              ? { text: `Reopened. Your thread “${target.title}” got the note.`, failed: false }
              : {
                  text: `Reopened, but the note did not reach your thread: ${failure}`,
                  failed: true,
                },
          );
        } else if (target.kind === "herdr") {
          const failure = failureMessage(
            await promptAgent({ environmentId, input: { agentId: target.agentId, text } }),
          );
          setMessage(
            failure === null
              ? { text: `Reopened. Your agent “${target.title}” got the note.`, failed: false }
              : {
                  text: `Reopened, but the note did not reach your agent: ${failure}`,
                  failed: true,
                },
          );
        } else {
          setMessage({
            text: "Reopened. No agent of yours on this task got the note.",
            failed: false,
          });
        }
        setNote("");
        setWriting(false);
      },
      () => {
        setBusy(false);
      },
    );
  };

  return (
    <section aria-label="Review decision" className="flex flex-col gap-3">
      {writing ? (
        <form
          id={formId}
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void reopen();
          }}
        >
          <label htmlFor={`${formId}-note`} className="text-sm text-foreground">
            What should change? Your agent on this task gets it as your next message.
          </label>
          <Textarea
            id={`${formId}-note`}
            autoFocus
            value={note}
            disabled={busy}
            maxLength={4_000}
            onChange={(event) => setNote(event.target.value)}
          />
        </form>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {writing ? (
          <>
            <Button type="submit" form={formId} disabled={busy || note.trim() === ""}>
              {busy ? "Reopening…" : "Reopen and send"}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setWriting(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button disabled={busy || done} onClick={() => void markDone()}>
              {done ? "Done" : "Mark task done"}
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => setWriting(true)}>
              Reopen with a note…
            </Button>
            {chat === null ? null : (
              <Button variant="outline" onClick={chat.open}>
                Open chat
              </Button>
            )}
          </>
        )}
        <span className="flex-1" />
        {task.context === undefined ? null : (
          <Button
            variant="ghost"
            onClick={() =>
              void navigate({
                to: "/context/$workspace/$project/$scope",
                params: { workspace, project, scope: `task:${task.id}` },
              })
            }
          >
            <FileTextIcon aria-hidden className="text-peer-knowledge-foreground" />
            Task context
          </Button>
        )}
      </div>
      {message === undefined ? null : (
        <PeerDialogMessage tone={message.failed ? "error" : "neutral"}>
          {message.text}
        </PeerDialogMessage>
      )}
    </section>
  );
}

/** What happened on the task lately, newest first, from the hub's coordination history. */
function ReviewTimeline({
  environmentId,
  status,
  workspace,
  project,
  task,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly workspace: string;
  readonly project: string;
  readonly task: string;
}) {
  const history = useEnvironmentQuery(
    serverEnvironment.peerHubCoordEvents({
      environmentId,
      input: { workspace, project, task, limit: 30 },
    }),
  );
  useCoordinationRefresh(history.refresh);
  const sessions = status.coordination.sessions.filter(
    (session) => session.workspace === workspace && session.project === project,
  );
  const events = history.data === null ? [] : coordinationTimeline(history.data).slice(0, 10);
  return (
    <details className="min-w-0">
      <summary className="cursor-pointer rounded-sm text-sm font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        Task history
      </summary>
      <section aria-label="Timeline" className="flex flex-col gap-3 pt-4 [overflow-wrap:anywhere]">
        {history.error !== null ? (
          <p className="text-xs text-muted-foreground">{history.error}</p>
        ) : history.data === null ? (
          <p role="status" className="text-xs text-muted-foreground">
            Loading…
          </p>
        ) : events.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nothing happened on this task yet.</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {events.map((event) => (
              <li key={event.id} className="flex min-w-0 gap-2.5">
                <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-success" />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm text-foreground">{coordinationEventLabel(event)}</span>
                  <span className="text-xs text-muted-foreground">
                    {[coordinationActorLabel(event, sessions), formatRelativeTimeLabel(event.at)]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </details>
  );
}
