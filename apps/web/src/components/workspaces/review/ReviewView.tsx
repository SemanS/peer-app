import {
  coordinationActorLabel,
  coordinationEventLabel,
  coordinationTimeline,
} from "@t3tools/client-runtime/coordinationTimeline";
import type { EnvironmentId, PeerHubStatus } from "@t3tools/contracts";
import { needsByOpen, taskOwnership } from "@t3tools/client-runtime/peer/work";
import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import { useNavigate } from "@tanstack/react-router";
import { FileTextIcon } from "lucide-react";
import { useId, useState } from "react";

import { useStableCallback } from "../../../hooks/useStableCallback";
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
import { ReviewDecisionContext, type ReviewDecision } from "./ReviewDecision";
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
        {status === null ||
        environmentId === null ||
        hubTask === undefined ||
        task === undefined ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            {status === null || environmentId === null ? (
              <p role="status" className="px-6 py-6 text-sm text-muted-foreground">
                Connecting…
              </p>
            ) : (
              <p className="px-6 py-6 text-sm text-muted-foreground">
                This task is no longer on the project.
              </p>
            )}
          </div>
        ) : (
          <ReviewBody
            environmentId={environmentId}
            status={status}
            plugins={plugins}
            workspace={workspace}
            project={project}
            task={task}
            title={hubTask.title}
            done={hubTask.status === "done"}
            chat={chat}
          />
        )}
      </div>
    </SidebarInset>
  );
}

/**
 * The review of a task that is on the project: what the plugins show of it, with the page's two
 * ways on offered to a decision line one of them draws, and the bar at the bottom.
 */
function ReviewBody({
  environmentId,
  status,
  plugins,
  workspace,
  project,
  task,
  title,
  done,
  chat,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly plugins: ReadonlyArray<PeerWebPlugin>;
  readonly workspace: string;
  readonly project: string;
  readonly task: WorkTaskNode;
  readonly title: string;
  readonly done: boolean;
  readonly chat: HandoffChat | null;
}) {
  const actions = useReviewActions({ environmentId, workspace, project, task });
  const [claims, setClaims] = useState(0);
  // A decision line's effect depends on it, so it keeps one identity.
  const claim = useStableCallback(() => {
    setClaims((count) => count + 1);
    return () => setClaims((count) => count - 1);
  });
  const decision: ReviewDecision = {
    markDone: () => void actions.markDone(),
    reopen: actions.startReopen,
    reopenLabel: actions.reopenLabel,
    busy: actions.busy,
    done,
    claim,
  };
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex min-h-full min-w-0 flex-col px-4 py-5 sm:px-7">
          <div className="flex min-w-0 flex-col gap-5">
            <div className="flex max-w-3xl flex-col gap-6">
              <h1 className="text-lg font-semibold tracking-tight text-foreground [overflow-wrap:anywhere]">
                {title}
              </h1>
              <HandoffChatContext value={chat}>
                <ReviewDecisionContext value={decision}>
                  {plugins.map(({ id, taskReview: Section }) =>
                    Section === undefined ? null : (
                      <Section
                        key={id}
                        environmentId={environmentId}
                        status={status}
                        workspace={workspace}
                        project={project}
                        scope={`task:${task.id}`}
                        contextText={null}
                      />
                    ),
                  )}
                </ReviewDecisionContext>
              </HandoffChatContext>
              {noReviewSections(plugins) ? (
                <p className="text-sm text-muted-foreground">
                  Turn on Handoff or GitHub in Settings → Peer → Coordination & plugins to see the
                  package and the pull requests here.
                </p>
              ) : null}
              <ReviewTimeline
                environmentId={environmentId}
                status={status}
                workspace={workspace}
                project={project}
                task={task.id}
              />
            </div>
          </div>
        </div>
      </div>
      <div className="max-h-[55dvh] shrink-0 overflow-y-auto border-t border-border bg-background px-4 py-3 sm:px-7">
        <ReviewActionsBar
          actions={actions}
          workspace={workspace}
          project={project}
          task={task}
          chat={chat}
          done={done}
          decisionShown={claims > 0}
        />
      </div>
    </>
  );
}

function noReviewSections(plugins: ReadonlyArray<PeerWebPlugin>): boolean {
  return plugins.every((plugin) => plugin.taskReview === undefined);
}

/** Mark done, or reopen with a note to the person's own agent on the task. */
export function ReviewActions({
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
  const actions = useReviewActions({ environmentId, workspace, project, task });
  return (
    <ReviewActionsBar
      actions={actions}
      workspace={workspace}
      project={project}
      task={task}
      chat={chat}
      done={done}
      decisionShown={false}
    />
  );
}

/** The state and the moves of a review's decision: marking done, and reopening with a note. */
function useReviewActions({
  environmentId,
  workspace,
  project,
  task,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: string;
  readonly project: string;
  readonly task: WorkTaskNode;
}) {
  const formId = useId();
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
  const target = reopenTarget(task);
  const targetThread =
    target.kind === "thread"
      ? threads.find(
          (thread) =>
            thread.environmentId === target.environmentId && thread.id === target.threadId,
        )
      : undefined;
  const recipient =
    target.kind === "thread"
      ? targetThread === undefined
        ? null
        : { ...target, shell: targetThread }
      : target.kind === "herdr"
        ? target
        : null;

  const setStatus = async (next: "done" | "open") => {
    const result = await updateTask({ environmentId, input: { ...place, status: next } });
    if (result._tag === "Success") return true;
    setMessage({
      text: isAtomCommandInterrupted(result)
        ? "Task update was interrupted. Its status could not be confirmed."
        : (failureMessage(result) ?? "Could not update the task."),
      failed: true,
    });
    return false;
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
    if (recipient === null) {
      setMessage({
        text: "Your agent is no longer available. Your note has not been sent and is still here.",
        failed: true,
      });
      return;
    }
    setBusy(true);
    setMessage(undefined);
    await withFinally(
      async () => {
        if (!(await setStatus("open"))) return;
        if (recipient.kind === "thread") {
          const result = await startTurn({
            environmentId: recipient.environmentId,
            input: {
              threadId: recipient.threadId,
              message: { messageId: newMessageId(), role: "user", text, attachments: [] },
              runtimeMode: recipient.shell.runtimeMode,
              interactionMode: recipient.shell.interactionMode,
              dispatchMode: "auto",
            },
          });
          if (isAtomCommandInterrupted(result)) {
            setMessage({
              text: "Reopened, but note delivery was interrupted and could not be confirmed. Your note is still here.",
              failed: true,
            });
            return;
          }
          const failure = failureMessage(result);
          setMessage(
            failure === null
              ? { text: `Reopened. Your thread “${recipient.title}” got the note.`, failed: false }
              : {
                  text: `Reopened, but the note did not reach your thread: ${failure}`,
                  failed: true,
                },
          );
          if (failure !== null) return;
        } else {
          const result = await promptAgent({
            environmentId,
            input: { agentId: recipient.agentId, text },
          });
          if (isAtomCommandInterrupted(result)) {
            setMessage({
              text: "Reopened, but note delivery was interrupted and could not be confirmed. Your note is still here.",
              failed: true,
            });
            return;
          }
          const failure = failureMessage(result);
          setMessage(
            failure === null
              ? { text: `Reopened. Your agent “${recipient.title}” got the note.`, failed: false }
              : {
                  text: `Reopened, but the note did not reach your agent: ${failure}`,
                  failed: true,
                },
          );
          if (failure !== null) return;
        }
        setNote("");
        setWriting(false);
      },
      () => {
        setBusy(false);
      },
    );
  };

  const reopenWithoutNote = async () => {
    setBusy(true);
    setMessage(undefined);
    await withFinally(
      async () => {
        if (await setStatus("open"))
          setMessage({ text: "Reopened. No message was sent.", failed: false });
      },
      () => setBusy(false),
    );
  };

  const hasRecipient = recipient !== null;
  const startReopen = () => {
    if (hasRecipient) setWriting(true);
    else void reopenWithoutNote();
  };

  return {
    formId,
    writing,
    setWriting,
    note,
    setNote,
    busy,
    message,
    recipient,
    markDone,
    reopen,
    reopenWithoutNote,
    startReopen,
    reopenLabel: !hasRecipient
      ? "Reopen task"
      : note.trim() === ""
        ? "Reopen with a note…"
        : "Continue note…",
  };
}

/**
 * The bar at the bottom of a review: the note being written, Mark done and Reopen unless a
 * decision line above offers them, the original chat and the task context.
 */
function ReviewActionsBar({
  actions,
  workspace,
  project,
  task,
  chat,
  done,
  decisionShown,
}: {
  readonly actions: ReturnType<typeof useReviewActions>;
  readonly workspace: string;
  readonly project: string;
  readonly task: WorkTaskNode;
  readonly chat: HandoffChat | null;
  readonly done: boolean;
  readonly decisionShown: boolean;
}) {
  const navigate = useNavigate();
  const {
    formId,
    writing,
    setWriting,
    note,
    setNote,
    busy,
    message,
    recipient,
    markDone,
    reopen,
    reopenWithoutNote,
  } = actions;
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
            What should change?
          </label>
          <p
            id={`${formId}-recipient`}
            role={recipient === null ? "status" : undefined}
            className="text-sm text-muted-foreground"
          >
            {recipient === null
              ? "Your agent is no longer available. Your note is kept here; reconnect your agent before sending."
              : `Your agent “${recipient.title}” gets this as your next message.`}
          </p>
          <Textarea
            id={`${formId}-note`}
            aria-describedby={`${formId}-recipient`}
            autoFocus
            value={note}
            disabled={busy}
            maxLength={4_000}
            onChange={(event) => setNote(event.target.value)}
          />
        </form>
      ) : null}
      <p className="text-sm text-muted-foreground">
        Task status is an administrative choice. Agent handoff checks run through peer review and
        peer done.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {writing ? (
          <>
            <Button
              type="submit"
              form={formId}
              disabled={busy || recipient === null || note.trim() === ""}
            >
              {busy ? "Reopening…" : "Reopen and send"}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setWriting(false)}>
              Close
            </Button>
          </>
        ) : (
          <>
            {decisionShown ? null : (
              <>
                <Button disabled={busy || done} onClick={() => void markDone()}>
                  {done ? "Done" : "Mark task done"}
                </Button>
                {recipient === null ? (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => void reopenWithoutNote()}
                  >
                    Reopen task
                  </Button>
                ) : (
                  <Button variant="outline" disabled={busy} onClick={() => setWriting(true)}>
                    {note.trim() === "" ? "Reopen with a note…" : "Continue note…"}
                  </Button>
                )}
              </>
            )}
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
      {!writing && recipient === null && !decisionShown ? (
        <p className="text-sm text-muted-foreground">
          No agent of yours is available on this task. Reopening only changes its status; no message
          will be sent.
        </p>
      ) : null}
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
