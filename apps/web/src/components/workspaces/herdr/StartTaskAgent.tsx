import type {
  EnvironmentId,
  PeerHubStatus,
  PeerProjectState,
  PeerAgentRequest,
} from "@t3tools/contracts";
import { PEER_REQUEST_REASON_MAX } from "@t3tools/contracts";
import { InboxIcon, PlayIcon } from "lucide-react";
import { useId, useState } from "react";

import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { formatRelativeTimeLabel } from "../../../timestampFormat";
import { Button } from "../../ui/button";
import { Dialog, DialogClose, DialogPopup } from "../../ui/dialog";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../../ui/select";
import { Textarea } from "../../ui/textarea";
import { Toggle, ToggleGroup } from "../../ui/toggle-group";
import {
  PeerCallout,
  PeerDialogBody,
  PeerDialogFooter,
  PeerDialogHeader,
  PeerDialogMessage,
  PeerFenced,
  PeerField,
} from "../PeerDialog";
import { ProjectMark } from "../signals";
import { failureMessage } from "../WorkspaceAccess";
import { personName } from "../workTree.logic";
import { capacityLine, launchGuidance, startInput } from "./StartTaskAgent.logic";

type Harness = "claude" | "codex";

/**
 * A task launch stays explicit: its own checkout, chosen harness, and a visible prompt. With a
 * teammate's request it is how the person accepts it, or declines it with a reason the sender sees.
 */
export function StartTaskAgent({
  environmentId,
  workspace,
  project,
  taskId,
  taskLabel,
  status,
  request,
  initialOpen = false,
  initialView = "accept",
  onDecline,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: string;
  readonly project: PeerProjectState;
  readonly taskId: string;
  readonly taskLabel: string;
  readonly status: PeerHubStatus;
  readonly request?: PeerAgentRequest;
  readonly initialOpen?: boolean;
  readonly initialView?: "accept" | "decline";
  readonly onDecline?: (reason: string) => Promise<string | null>;
  readonly onClose?: () => void;
}) {
  const [open, setOpen] = useState(initialOpen);
  const [busy, setBusy] = useState(false);
  const close = () => {
    setOpen(false);
    onClose?.();
  };
  return (
    <>
      {initialOpen ? null : (
        <Button
          size="icon-xs"
          variant="ghost-muted"
          aria-label={`Start agent on ${taskLabel}`}
          onClick={(event) => {
            event.stopPropagation();
            setOpen(true);
          }}
        >
          <PlayIcon className="size-3.5" />
        </Button>
      )}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (busy) return;
          if (next) setOpen(true);
          else close();
        }}
      >
        <DialogPopup
          className="max-w-xl"
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          {open ? (
            <LaunchForm
              environmentId={environmentId}
              workspace={workspace}
              project={project}
              taskId={taskId}
              taskLabel={taskLabel}
              status={status}
              request={request}
              initialView={initialView}
              onDecline={onDecline}
              busy={busy}
              setBusy={setBusy}
              onDone={close}
            />
          ) : null}
        </DialogPopup>
      </Dialog>
    </>
  );
}

function LaunchForm({
  environmentId,
  workspace,
  project,
  taskId,
  taskLabel,
  status,
  request,
  initialView,
  onDecline,
  busy,
  setBusy,
  onDone,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: string;
  readonly project: PeerProjectState;
  readonly taskId: string;
  readonly taskLabel: string;
  readonly status: PeerHubStatus;
  readonly request: PeerAgentRequest | undefined;
  readonly initialView: "accept" | "decline";
  readonly onDecline: ((reason: string) => Promise<string | null>) | undefined;
  readonly busy: boolean;
  readonly setBusy: (busy: boolean) => void;
  readonly onDone: () => void;
}) {
  const formId = useId();
  const start = useAtomCommand(serverEnvironment.peerHubStartAgent, { reportFailure: false });
  const [view, setView] = useState(
    request !== undefined && onDecline !== undefined ? initialView : "accept",
  );
  const [started, setStarted] = useState(false);
  const [harness, setHarness] = useState<Harness>("claude");
  const repositories = project.repositories.filter((repo) => repo.state === "ready");
  const [repositoryId, setRepositoryId] = useState(repositories[0]?.id ?? "");
  const repository =
    repositories.find((repo) => repo.id === repositoryId) ?? repositories[0] ?? undefined;
  const task = project.work.tasks.find((candidate) => candidate.id === taskId);
  const instructionLabel = [task?.key, task?.title ?? taskLabel].filter(Boolean).join(": ");
  const [prompt, setPrompt] = useState(
    request === undefined ? taskLabel : `${instructionLabel}.`.slice(0, 2_000),
  );
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<{ readonly text: string; readonly failed: boolean }>();
  const guidance = launchGuidance(status, project);
  const { blocked } = guidance;
  const capacity = capacityLine(project, harness);
  const sender = request === undefined ? undefined : personName(project, request.sender);
  const colorKey = `${workspace}/${project.project.id}`;

  const accept = () => {
    if (busy || started || blocked !== null || prompt.trim() === "") return;
    setBusy(true);
    setMessage(undefined);
    void start({
      environmentId,
      input: {
        ...startInput(request, prompt),
        workspace,
        projectId: project.project.id,
        taskId,
        repositoryId: repository?.id ?? "",
        harness,
      },
    })
      .then((result) => {
        const failure = failureMessage(result);
        if (failure !== null) setMessage({ text: failure, failed: true });
        else if (result._tag === "Success") {
          setStarted(true);
          setMessage({
            text:
              result.value.promptError ??
              "Agent started in its own checkout. Find it under this task or in Needs you.",
            failed: result.value.promptError !== undefined,
          });
        }
      })
      .finally(() => setBusy(false));
  };

  const decline = () => {
    if (busy || onDecline === undefined) return;
    setBusy(true);
    setMessage(undefined);
    void onDecline(reason.trim())
      .then((failure) => {
        if (failure === null) onDone();
        else setMessage({ text: failure, failed: true });
      })
      .finally(() => setBusy(false));
  };

  const context = (
    <>
      <ProjectMark name={project.project.name} colorKey={colorKey} className="size-3.5" />
      <span className="text-foreground/80">{project.project.name}</span>
      <span aria-hidden>·</span>
      {request === undefined ? (
        <span className="truncate">{taskLabel}</span>
      ) : (
        <>
          <span>{formatRelativeTimeLabel(request.createdAt)}</span>
          <span aria-hidden>·</span>
          <span>waits only for you</span>
        </>
      )}
    </>
  );

  if (view === "decline" && request !== undefined && sender !== undefined) {
    return (
      <>
        <PeerDialogHeader
          icon={InboxIcon}
          tone="team"
          title={`Team request from ${sender}`}
          context={context}
        />
        <PeerDialogBody>
          <form
            id={formId}
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              decline();
            }}
          >
            <PeerFenced who={sender}>
              <span className="font-medium">{request.title}</span>
              {"\n"}
              {request.prompt}
            </PeerFenced>
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
                placeholder="For example: I'm on the release today. Can it wait until Monday?"
                onChange={(event) => setReason(event.target.value)}
              />
            </div>
            {message === undefined ? null : (
              <PeerDialogMessage tone={message.failed ? "error" : "neutral"}>
                {message.text}
              </PeerDialogMessage>
            )}
          </form>
        </PeerDialogBody>
        <PeerDialogFooter
          secondary={
            <Button variant="ghost" disabled={busy} onClick={() => setView("accept")}>
              Back
            </Button>
          }
          note="The request closes for both of you. Nothing runs on your computer."
        >
          <Button type="submit" form={formId} disabled={busy}>
            {busy ? "Declining…" : "Decline request"}
          </Button>
        </PeerDialogFooter>
      </>
    );
  }

  return (
    <>
      <PeerDialogHeader
        icon={request === undefined ? PlayIcon : InboxIcon}
        tone={request === undefined ? "working" : "team"}
        title={sender === undefined ? "Start an agent on this task" : `Team request from ${sender}`}
        context={context}
      />
      <PeerDialogBody>
        <form
          id={formId}
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            accept();
          }}
        >
          {request === undefined || sender === undefined ? null : (
            <PeerFenced who={sender}>
              <span className="font-medium">{request.title}</span>
              {"\n"}
              {request.prompt}
            </PeerFenced>
          )}
          {blocked === null ? null : (
            <PeerCallout tone="needs">
              <span className="flex flex-col gap-1">
                <span role="status">{blocked}</span>
                {guidance.installLink ? (
                  <a
                    className="text-sm underline underline-offset-2"
                    href="https://herdr.dev/docs/install/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Install herdr on this environment
                  </a>
                ) : null}
              </span>
            </PeerCallout>
          )}
          <PeerField label="Task">
            <p className="pt-1.5 text-sm text-foreground">{instructionLabel}</p>
          </PeerField>
          <PeerField
            label="Runs in"
            htmlFor={repositories.length > 1 ? `${formId}-repo` : undefined}
          >
            {repositories.length > 1 ? (
              <Select
                value={repository?.id ?? ""}
                items={repositories.map((repo) => ({ value: repo.id, label: repo.id }))}
                disabled={busy}
                onValueChange={(value) => {
                  if (value !== null) setRepositoryId(value);
                }}
              >
                <SelectTrigger id={`${formId}-repo`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  {repositories.map((repo) => (
                    <SelectItem key={repo.id} value={repo.id}>
                      {repo.id}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            ) : null}
            {repository === undefined ? (
              <p className="pt-1.5 text-sm text-muted-foreground">Not on this computer yet.</p>
            ) : (
              <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 pt-1.5 text-sm">
                <span className="min-w-0 truncate font-mono text-xs text-foreground">
                  {repository.path}
                </span>
                <span className="text-xs text-muted-foreground">
                  a new branch from {repository.branch}
                </span>
              </p>
            )}
          </PeerField>
          <PeerField label="Agent">
            <ToggleGroup
              aria-label="Agent"
              value={[harness]}
              disabled={busy}
              onValueChange={(next) => {
                const value = next[0];
                if (value === "claude" || value === "codex") setHarness(value);
              }}
            >
              <Toggle value="claude">Claude Code</Toggle>
              <Toggle value="codex">Codex</Toggle>
            </ToggleGroup>
          </PeerField>
          <PeerField label="Capacity">
            <p
              className={
                capacity.allowed
                  ? "pt-1.5 text-sm text-foreground"
                  : "pt-1.5 text-sm text-warning-foreground"
              }
            >
              {capacity.line}
            </p>
          </PeerField>
          <PeerField
            label={request === undefined ? "First prompt" : "Your instruction"}
            htmlFor={`${formId}-prompt`}
            hint={
              request === undefined
                ? undefined
                : `${sender ?? "Your teammate"}'s words reach your agent fenced, after your instruction.`
            }
          >
            <Textarea
              id={`${formId}-prompt`}
              value={prompt}
              disabled={busy}
              maxLength={request === undefined ? 20_000 : 2_000}
              onChange={(event) => setPrompt(event.target.value)}
            />
          </PeerField>
          {message === undefined ? null : (
            <PeerDialogMessage tone={message.failed ? "error" : "neutral"}>
              {message.text}
            </PeerDialogMessage>
          )}
        </form>
      </PeerDialogBody>
      <PeerDialogFooter
        secondary={
          request !== undefined && onDecline !== undefined && !started ? (
            <Button variant="ghost" disabled={busy} onClick={() => setView("decline")}>
              Decline…
            </Button>
          ) : undefined
        }
        note={
          request === undefined || sender === undefined
            ? "Peer creates a feature branch in its own checkout on this computer. The running session shows whether its Mod or hooks enforce coordination."
            : `${sender} sees “Accepted by you”. Nothing runs on your computer before you accept.`
        }
      >
        <DialogClose render={<Button variant="outline" disabled={busy} />}>
          {started ? "Close" : "Cancel"}
        </DialogClose>
        <Button
          type="submit"
          form={formId}
          disabled={busy || started || blocked !== null || prompt.trim() === ""}
        >
          {busy
            ? "Starting…"
            : started
              ? "Started"
              : request === undefined
                ? "Start agent"
                : "Accept & start"}
        </Button>
      </PeerDialogFooter>
    </>
  );
}
