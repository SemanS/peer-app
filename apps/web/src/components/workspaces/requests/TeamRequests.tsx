import { incomingPeerRequests } from "@t3tools/client-runtime/peer/requests";
import { personName } from "@t3tools/client-runtime/peer/needs-you";
import type { PeerAgentRequest, PeerHubStatus } from "@t3tools/contracts";
import { PEER_REQUEST_REASON_MAX } from "@t3tools/contracts";
import { ChevronRightIcon, InboxIcon, SendIcon } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { cn, randomUUID } from "../../../lib/utils";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { formatRelativeTimeLabel } from "../../../timestampFormat";
import { Button } from "../../ui/button";
import { Dialog, DialogClose, DialogPopup } from "../../ui/dialog";
import { Textarea } from "../../ui/textarea";
import {
  PeerCallout,
  PeerDialogBody,
  PeerDialogFooter,
  PeerDialogHeader,
  PeerDialogMessage,
  PeerFenced,
  PeerField,
} from "../PeerDialog";
import { ProjectMark, TONE_SURFACE } from "../signals";
import type { NeedsYouSlotProps, PeerWebPlugin, ProjectSlotProps } from "../slots.types";
import { projectScopeKey } from "../workBoard.logic";
import { failureMessage } from "../WorkspaceAccess";
import { SentRequests } from "./SentRequests";
import { TaskField, type TaskMode } from "./TaskField";
import { TeammatePicker } from "./TeammatePicker";
import {
  expiryLabel,
  onlineEmails,
  requestTask,
  taskBroughtBy,
  taskOptions,
  teammateOptions,
} from "./requests.logic";

/** The header button of a project: ask a teammate to take a task. */
export function RequestTeammate({ environmentId, project, status }: ProjectSlotProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button
        size="icon-xs"
        variant="ghost-muted"
        aria-label={`Request a teammate on ${project.name}`}
        onClick={() => setOpen(true)}
      >
        <SendIcon className="size-3.5" />
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!busy) setOpen(next);
        }}
      >
        <DialogPopup className="max-w-xl">
          <PeerDialogHeader
            icon={SendIcon}
            tone="team"
            title="Request a teammate"
            context={
              <>
                <ProjectMark
                  name={project.name}
                  colorKey={projectScopeKey(project)}
                  className="size-3.5"
                />
                <span className="text-foreground/80">{project.name}</span>
              </>
            }
            description="The request waits in the Hub until your teammate answers it."
          />
          {open ? (
            <RequestForm
              environmentId={environmentId}
              status={status}
              project={project}
              busy={busy}
              setBusy={setBusy}
            />
          ) : null}
        </DialogPopup>
      </Dialog>
    </>
  );
}

function RequestForm({
  environmentId,
  status,
  project,
  busy,
  setBusy,
  initialRecipient,
  initialTask,
}: Pick<ProjectSlotProps, "environmentId" | "status" | "project"> & {
  readonly busy: boolean;
  readonly setBusy: (busy: boolean) => void;
  /** Opens with this teammate chosen (their address), e.g. from "Ask Ana" on a task. */
  readonly initialRecipient?: string | undefined;
  /** Opens on this open task (its id). */
  readonly initialTask?: string | undefined;
}) {
  const formId = useId();
  const { workspace, projectId } = project;
  const send = useAtomCommand(serverEnvironment.peerHubSendRequest, { reportFailure: false });
  const updateTask = useAtomCommand(serverEnvironment.peerHubUpdateTask, { reportFailure: false });
  const loadMembers = useAtomCommand(serverEnvironment.peerHubMembers, { reportFailure: false });
  const projectState = status.workspaces
    .find((candidate) => candidate.slug === workspace)
    ?.projects.find((candidate) => candidate.project.id === projectId);
  // The workspace's people who are not on the project: listed so that a missing teammate is
  // explained. A Hub that does not answer leaves the list to the project's members.
  const [elsewhere, setElsewhere] = useState<
    ReadonlyArray<{ readonly email: string; readonly name?: string | null | undefined }>
  >([]);
  useEffect(() => {
    let current = true;
    void loadMembers({ environmentId, input: { workspace } }).then((result) => {
      if (current && result._tag === "Success") setElsewhere(result.value.members);
    });
    return () => {
      current = false;
    };
  }, [environmentId, loadMembers, workspace]);
  const [seenAt] = useState(() => Date.now());
  const teammates = useMemo(
    () =>
      teammateOptions(projectState?.project.members ?? [], status.email, {
        elsewhere,
        online: onlineEmails(projectState?.peers ?? [], seenAt),
      }),
    [elsewhere, projectState, seenAt, status.email],
  );
  const tasks = useMemo(
    () => taskOptions(project.areas.flatMap((area) => area.tasks)),
    [project.areas],
  );
  const areas = project.areas.flatMap((area) => (area.name === null ? [] : [area.name]));
  const [recipient, setRecipient] = useState(initialRecipient ?? "");
  const [mode, setMode] = useState<TaskMode>(
    initialTask !== undefined || tasks.length > 0 ? "existing" : "new",
  );
  const [taskId, setTaskId] = useState(initialTask ?? "");
  const [title, setTitle] = useState("");
  const [area, setArea] = useState("");
  const [prompt, setPrompt] = useState("");
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState<{ readonly text: string; readonly failed: boolean }>();
  // Keep an operation stable after a lost reply; editing the draft starts a new operation.
  const operation = useRef<{ draft: string; id: string } | null>(null);
  const teammate = teammates.find((option) => option.email === recipient);
  const about = requestTask(
    mode === "existing" ? { kind: "existing", taskId } : { kind: "new", title },
    tasks,
  );
  const ready = teammate?.group === "project" && about !== null && prompt.trim() !== "";
  const first = teammate?.name ?? "Your teammate";
  return (
    <>
      <PeerDialogBody>
        <form
          id={formId}
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (busy || sent || !ready || about === null) return;
            const text = prompt.trim();
            const draft = JSON.stringify([recipient, about.task ?? null, about.title, text]);
            if (operation.current?.draft !== draft) operation.current = { draft, id: randomUUID() };
            const op = operation.current.id;
            const known = new Set((status.requests ?? []).map(({ request }) => request.id));
            setBusy(true);
            setMessage(undefined);
            void (async () => {
              const result = await send({
                environmentId,
                input: {
                  workspace,
                  projectId,
                  op,
                  recipient,
                  title: about.title,
                  prompt: text,
                  ...(about.task === undefined ? {} : { task: about.task }),
                },
              });
              const failure = failureMessage(result);
              if (failure !== null || result._tag !== "Success") {
                setMessage({ text: failure ?? "The request was not sent.", failed: true });
                return;
              }
              // The Hub makes a new task without an area; the area is a second, smaller step.
              let areaProblem: string | null = null;
              if (about.task === undefined && area !== "") {
                const brought = taskBroughtBy({
                  known,
                  after: result.value.requests,
                  workspace,
                  project: projectId,
                  sender: status.email,
                  recipient,
                  title: about.title,
                });
                areaProblem =
                  brought === undefined
                    ? "the Hub did not say which task it made"
                    : failureMessage(
                        await updateTask({
                          environmentId,
                          input: { workspace, projectId, taskId: brought, area },
                        }),
                      );
              }
              setMessage({
                text:
                  `Sent. ${first} sees it in Needs you and chooses whether to start their agent.` +
                  (areaProblem === null
                    ? ""
                    : ` The new task is in No area (${areaProblem}); move it to ${area} from its menu.`),
                failed: false,
              });
              setSent(true);
            })().finally(() => setBusy(false));
          }}
        >
          <PeerField label="Teammate" htmlFor={`${formId}-recipient`}>
            <TeammatePicker
              id={`${formId}-recipient`}
              options={teammates}
              value={recipient}
              projectName={project.name}
              workspaceName={project.workspaceName}
              disabled={busy || sent}
              onChange={setRecipient}
            />
          </PeerField>
          <PeerField label="Task">
            <TaskField
              id={`${formId}-task`}
              mode={mode}
              onModeChange={setMode}
              options={tasks}
              taskId={taskId}
              onTaskIdChange={setTaskId}
              title={title}
              onTitleChange={setTitle}
              areas={areas}
              area={area}
              onAreaChange={setArea}
              projectName={project.name}
              disabled={busy || sent}
            />
          </PeerField>
          <PeerField
            label="What do you need?"
            htmlFor={`${formId}-prompt`}
            hint="Their agent gets it as information from you, never as instructions."
          >
            <Textarea
              id={`${formId}-prompt`}
              required
              maxLength={20_000}
              placeholder="For example: Could you take the allergen check? The menu import is done, so the data is there."
              value={prompt}
              disabled={busy || sent}
              onChange={(event) => setPrompt(event.target.value)}
            />
          </PeerField>
          {message === undefined ? null : (
            <PeerDialogMessage tone={message.failed ? "error" : "neutral"}>
              {message.text}
            </PeerDialogMessage>
          )}
        </form>
        <SentRequests environmentId={environmentId} status={status} project={project} />
      </PeerDialogBody>
      <PeerDialogFooter
        note={`${first} gets it in Needs you in Peer. Nothing runs on their computer before they accept.`}
      >
        <DialogClose render={<Button variant="outline" disabled={busy} />}>Close</DialogClose>
        {sent ? (
          <Button
            onClick={() => {
              setSent(false);
              setMessage(undefined);
              setTitle("");
              setTaskId("");
              setPrompt("");
              operation.current = null;
            }}
          >
            New request
          </Button>
        ) : (
          <Button type="submit" form={formId} disabled={busy || !ready}>
            {busy ? "Sending…" : "Send request"}
          </Button>
        )}
      </PeerDialogFooter>
    </>
  );
}

/**
 * Opens a request addressed to the person: the task launcher to accept it (and start their agent)
 * or decline it with a reason, or, where no agent can start here, the dialog that declines it.
 */
export function RequestReview({
  environmentId,
  status,
  plugins,
  workspace,
  request,
  view,
  onClose,
}: NeedsYouSlotProps & {
  readonly workspace: string;
  readonly request: PeerAgentRequest;
  readonly view: "accept" | "decline";
  readonly onClose: () => void;
}) {
  const dismiss = useAtomCommand(serverEnvironment.peerHubDismissRequest, {
    reportFailure: false,
  });
  const project = status.workspaces
    .find((candidate) => candidate.slug === workspace)
    ?.projects.find((candidate) => candidate.project.id === request.project);
  const decline = async (reason: string) =>
    failureMessage(
      await dismiss({
        environmentId,
        input: {
          workspace,
          projectId: request.project,
          requestId: request.id,
          ...(reason === "" ? {} : { reason }),
        },
      }),
    );
  const Launcher = plugins.find((plugin) => plugin.taskLauncher !== undefined)?.taskLauncher;
  if (Launcher !== undefined && project !== undefined) {
    return (
      <Launcher
        environmentId={environmentId}
        workspace={workspace}
        project={project}
        taskId={request.task}
        taskLabel={request.title}
        status={status}
        request={request}
        initialOpen
        initialView={view}
        onDecline={decline}
        onClose={onClose}
      />
    );
  }
  return (
    <DeclineRequestDialog
      status={status}
      workspace={workspace}
      request={request}
      noLauncher={Launcher === undefined}
      onDecline={decline}
      onClose={onClose}
    />
  );
}

/** Declines a request where no agent can start to accept it: the sender sees the reason. */
function DeclineRequestDialog({
  status,
  workspace,
  request,
  noLauncher,
  onDecline,
  onClose,
}: {
  readonly status: PeerHubStatus;
  readonly workspace: string;
  readonly request: PeerAgentRequest;
  /** No plugin starts agents here (herdr agents are off). */
  readonly noLauncher: boolean;
  readonly onDecline: (reason: string) => Promise<string | null>;
  readonly onClose: () => void;
}) {
  const formId = useId();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sender = personName(status, workspace, request.sender);
  const project = status.workspaces
    .find((candidate) => candidate.slug === workspace)
    ?.projects.find((candidate) => candidate.project.id === request.project);
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogPopup className="max-w-xl">
        <PeerDialogHeader
          icon={InboxIcon}
          tone="team"
          title={`Team request from ${sender}`}
          context={
            <>
              {project === undefined ? null : (
                <>
                  <ProjectMark
                    name={project.project.name}
                    colorKey={`${workspace}/${project.project.id}`}
                    className="size-3.5"
                  />
                  <span className="text-foreground/80">{project.project.name}</span>
                  <span aria-hidden>·</span>
                </>
              )}
              <span>{formatRelativeTimeLabel(request.createdAt)}</span>
              <span aria-hidden>·</span>
              <span>waits only for you</span>
            </>
          }
        />
        <PeerDialogBody>
          <form
            id={formId}
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (busy) return;
              setBusy(true);
              setError(null);
              void onDecline(reason.trim())
                .then((failure) => {
                  if (failure === null) onClose();
                  else setError(failure);
                })
                .finally(() => setBusy(false));
            }}
          >
            <PeerFenced who={sender}>
              <span className="font-medium">{request.title}</span>
              {"\n"}
              {request.prompt}
            </PeerFenced>
            {noLauncher ? (
              <PeerCallout tone="neutral">
                Accepting starts your agent on it, which needs herdr agents. They are turned off on
                this environment.
              </PeerCallout>
            ) : null}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <label htmlFor={`${formId}-reason`} className="text-sm text-foreground">
                  Tell {sender} why (optional). {sender} sees exactly this.
                </label>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {reason.length}/{PEER_REQUEST_REASON_MAX}
                </span>
              </div>
              <Textarea
                id={`${formId}-reason`}
                autoFocus
                value={reason}
                disabled={busy}
                maxLength={PEER_REQUEST_REASON_MAX}
                onChange={(event) => setReason(event.target.value)}
              />
            </div>
            {error === null ? null : <PeerDialogMessage tone="error">{error}</PeerDialogMessage>}
          </form>
        </PeerDialogBody>
        <PeerDialogFooter note="The request closes for both of you. Nothing runs on your computer.">
          <DialogClose render={<Button variant="outline" disabled={busy} />}>Cancel</DialogClose>
          <Button type="submit" form={formId} disabled={busy}>
            {busy ? "Declining…" : "Decline request"}
          </Button>
        </PeerDialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

/**
 * What teammates asked of you, in Needs you: a card each, like the sidebar's other Needs you cards.
 * A card opens the request: the task launcher to accept or decline it, or, without one (herdr agents
 * are off), the dialog that declines it.
 */
export function RequestsInbox({ environmentId, status, plugins }: NeedsYouSlotProps) {
  const [opened, setOpened] = useState<{
    readonly workspace: string;
    readonly request: PeerAgentRequest;
    readonly view: "accept" | "decline";
  } | null>(null);
  // Labels use the local clock when this status renders; no timer repaints the list.
  // oxlint-disable-next-line react/purity -- Expiry is a render-time snapshot; requests status replaces expired rows without a timer.
  const now = Date.now();
  const requests = incomingPeerRequests(status);
  const accepted = (status.requests ?? []).filter(
    (row) => row.request.recipient === status.email && row.request.status === "accepted",
  );
  return (
    <>
      <ul aria-label="Team requests" className="flex flex-col gap-1">
        {requests.map((row) => (
          <RequestCard
            key={`${row.workspace}/${row.request.id}`}
            status={status}
            plugins={plugins}
            workspace={row.workspace}
            request={row.request}
            now={now}
            onOpen={(view) => setOpened({ ...row, view })}
          />
        ))}
      </ul>
      {accepted.length === 0 ? null : (
        <details className="group/accepted px-2 text-xs text-muted-foreground">
          <summary className="flex cursor-pointer list-none items-center gap-1 py-1 hover:text-foreground">
            <ChevronRightIcon
              aria-hidden
              className="size-3 shrink-0 group-open/accepted:rotate-90"
            />
            Accepted team requests · {accepted.length}
          </summary>
          <p className="py-1">
            Acceptance takes ownership. Inspect the task and herdr before starting another agent.
          </p>
          {accepted.map(({ workspace, request }) => (
            <div key={`${workspace}/${request.id}`} className="py-1.5">
              <p className="font-medium text-foreground">{request.title}</p>
              <p>{personName(status, workspace, request.sender)}</p>
            </div>
          ))}
        </details>
      )}
      {opened === null ? null : (
        <RequestReview
          key={`${opened.workspace}/${opened.request.id}/${opened.view}`}
          environmentId={environmentId}
          status={status}
          plugins={plugins}
          workspace={opened.workspace}
          request={opened.request}
          view={opened.view}
          onClose={() => setOpened(null)}
        />
      )}
    </>
  );
}

/** One request in Needs you: who asks, for what, on which project, and how long it waits. */
function RequestCard({
  status,
  plugins,
  workspace,
  request,
  now,
  onOpen,
}: {
  readonly status: PeerHubStatus;
  readonly plugins: ReadonlyArray<PeerWebPlugin>;
  readonly workspace: string;
  readonly request: PeerAgentRequest;
  readonly now: number;
  readonly onOpen: (view: "accept" | "decline") => void;
}) {
  const canStart = plugins.some((plugin) => plugin.taskLauncher !== undefined);
  const project = status.workspaces
    .find((candidate) => candidate.slug === workspace)
    ?.projects.find((candidate) => candidate.project.id === request.project);
  const expiry = expiryLabel(request, now);
  return (
    <li className="list-none">
      <button
        type="button"
        className="flex w-full min-w-0 items-start gap-2.5 rounded-lg border border-sidebar-border/70 bg-sidebar-control-surface px-2.5 py-2 text-left outline-none select-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        onClick={() => onOpen(canStart ? "accept" : "decline")}
      >
        <span
          aria-hidden
          className={cn(
            "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border",
            TONE_SURFACE.team,
          )}
        >
          <InboxIcon className="size-3.5 text-peer-team-foreground" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-sm font-medium text-foreground">{request.title}</span>
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            {project === undefined ? null : (
              <>
                <ProjectMark
                  name={project.project.name}
                  colorKey={`${workspace}/${project.project.id}`}
                  className="size-3"
                />
                <span className="max-w-24 shrink-0 truncate">{project.project.name}</span>
              </>
            )}
            <span className="shrink-0 font-medium text-peer-team-foreground">
              Request from {personName(status, workspace, request.sender)}
            </span>
            <span className="truncate">· {formatRelativeTimeLabel(request.createdAt)}</span>
          </span>
          {expiry === undefined ? null : (
            <span className="text-2xs text-muted-foreground">{expiry}</span>
          )}
        </span>
      </button>
    </li>
  );
}
