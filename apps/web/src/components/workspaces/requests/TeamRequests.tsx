import { incomingPeerRequests } from "@t3tools/client-runtime/peer/requests";
import type { PeerAgentRequest } from "@t3tools/contracts";
import { SendIcon } from "lucide-react";
import { useRef, useState } from "react";

import { randomUUID } from "../../../lib/utils";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { Button } from "../../ui/button";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../../ui/dialog";
import { usePeerPlugins, type PeerSlotProps, type ProjectSlotProps } from "../slots";
import { failureMessage } from "../WorkspaceAccess";

/** The header button of a project: ask a teammate to take a task. */
export function RequestTeammate({ environmentId, project, status }: ProjectSlotProps) {
  const { workspace, projectId, name } = project;
  const send = useAtomCommand(serverEnvironment.peerHubSendRequest, { reportFailure: false });
  const [open, setOpen] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Keep an operation stable after a lost reply; editing the draft starts a new operation.
  const operation = useRef<{ draft: string; id: string } | null>(null);
  const outbox = (status.requests ?? [])
    .filter(
      (row) =>
        row.workspace === workspace &&
        row.request.project === projectId &&
        row.request.sender === status.email,
    )
    .slice(0, 8);
  return (
    <>
      <Button
        size="icon-xs"
        variant="ghost-muted"
        aria-label={`Request a teammate on ${name}`}
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
        <DialogPopup>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (busy || sent || !recipient.trim() || !title.trim() || !prompt.trim()) return;
              const draft = JSON.stringify([recipient.trim(), title.trim(), prompt.trim()]);
              if (operation.current?.draft !== draft)
                operation.current = { draft, id: randomUUID() };
              setBusy(true);
              setMessage(null);
              void send({
                environmentId,
                input: {
                  workspace,
                  projectId,
                  op: operation.current.id,
                  recipient: recipient.trim(),
                  title: title.trim(),
                  prompt: prompt.trim(),
                },
              })
                .then((result) => {
                  const failure = failureMessage(result);
                  setMessage(
                    failure ??
                      "Sent. Your teammate will see the request in Needs you and choose whether to start their agent.",
                  );
                  if (failure === null) setSent(true);
                })
                .finally(() => setBusy(false));
            }}
          >
            <DialogHeader>
              <DialogTitle>Request a teammate</DialogTitle>
              <DialogDescription>
                {name}. The request stays in the Hub until your teammate answers it.
              </DialogDescription>
            </DialogHeader>
            <label className="flex flex-col gap-1.5 text-sm">
              Teammate's workspace email
              <input
                type="email"
                required
                value={recipient}
                disabled={busy || sent}
                onChange={(event) => setRecipient(event.target.value)}
                className="rounded-md border border-input bg-background px-2 py-1.5"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              Task title
              <input
                required
                maxLength={120}
                value={title}
                disabled={busy || sent}
                onChange={(event) => setTitle(event.target.value)}
                className="rounded-md border border-input bg-background px-2 py-1.5"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              Request
              <textarea
                required
                maxLength={20_000}
                value={prompt}
                disabled={busy || sent}
                onChange={(event) => setPrompt(event.target.value)}
                className="min-h-24 rounded-md border border-input bg-background px-2 py-1.5"
              />
            </label>
            {message === null ? null : (
              <p role="status" className="text-sm">
                {message}
              </p>
            )}
            {outbox.length === 0 ? null : (
              <ul aria-label="Sent requests" className="text-xs text-muted-foreground">
                {outbox.map(({ request }) => (
                  <li key={request.id}>
                    {request.title} · {request.recipient} · {request.status}
                  </li>
                ))}
              </ul>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                Close
              </Button>
              {sent ? (
                <Button
                  type="button"
                  onClick={() => {
                    setSent(false);
                    setMessage(null);
                    setTitle("");
                    setPrompt("");
                    operation.current = null;
                  }}
                >
                  New request
                </Button>
              ) : (
                <Button type="submit" disabled={busy}>
                  {busy ? "Sending…" : "Send request"}
                </Button>
              )}
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>
    </>
  );
}

/**
 * What teammates asked of you, in Needs you. Reviewing a request opens the task launcher with the
 * request's prompt; without one (herdr agents are off) a request can only be dismissed.
 */
export function RequestsInbox({ environmentId, status }: PeerSlotProps) {
  const plugins = usePeerPlugins(status);
  const canStart = plugins.some((plugin) => plugin.taskLauncher !== undefined);
  const dismiss = useAtomCommand(serverEnvironment.peerHubDismissRequest, { reportFailure: false });
  const [selected, setSelected] = useState<{ workspace: string; request: PeerAgentRequest } | null>(
    null,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requests = incomingPeerRequests(status);
  const accepted = (status.requests ?? []).filter(
    (row) => row.request.recipient === status.email && row.request.status === "accepted",
  );
  const project = status.workspaces
    .find((w) => w.slug === selected?.workspace)
    ?.projects.find((p) => p.project.id === selected?.request.project);
  return (
    <>
      <ul aria-label="Team requests" className="flex flex-col gap-1">
        {requests.map((row) => (
          <li
            key={`${row.workspace}/${row.request.id}`}
            className="rounded-md border border-sidebar-border px-2.5 py-2"
          >
            <p className="truncate text-xs text-muted-foreground">
              {row.request.sender} · {row.workspace}
            </p>
            <p className="text-sm font-medium">{row.request.title}</p>
            {canStart ? null : (
              <>
                <p className="mt-1 text-xs break-words whitespace-pre-wrap text-muted-foreground">
                  {row.request.prompt}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Starting it needs herdr agents, which are turned off on this environment.
                </p>
              </>
            )}
            <div className="mt-1 flex gap-1">
              {canStart ? (
                <Button
                  size="xs"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => setSelected(row)}
                >
                  Review request
                </Button>
              ) : null}
              <Button
                size="xs"
                variant="ghost-muted"
                disabled={busy !== null}
                onClick={() => {
                  setBusy(row.request.id);
                  setError(null);
                  void dismiss({
                    environmentId,
                    input: {
                      workspace: row.workspace,
                      projectId: row.request.project,
                      requestId: row.request.id,
                    },
                  })
                    .then((result) => setError(failureMessage(result)))
                    .finally(() => setBusy(null));
                }}
              >
                Dismiss
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {accepted.length === 0 ? null : (
        <details className="px-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer">Accepted team requests · {accepted.length}</summary>
          <p className="py-1">
            Acceptance takes ownership. Inspect the task and herdr before starting another agent.
          </p>
          {accepted.map(({ workspace, request }) => (
            <div key={`${workspace}/${request.id}`} className="py-2">
              <p className="font-medium text-foreground">{request.title}</p>
              <p>
                {request.sender} · {workspace}
              </p>
              <p className="mt-1 whitespace-pre-wrap break-words">{request.prompt}</p>
            </div>
          ))}
        </details>
      )}
      {error === null ? null : (
        <p role="alert" className="px-2 text-xs text-destructive">
          {error}
        </p>
      )}
      {selected === null || project === undefined
        ? null
        : plugins.map(({ taskLauncher: Launcher }) =>
            Launcher === undefined ? null : (
              <Launcher
                key={`${selected.workspace}/${selected.request.id}`}
                environmentId={environmentId}
                workspace={selected.workspace}
                project={project}
                taskId={selected.request.task}
                taskLabel={selected.request.title}
                status={status}
                request={selected.request}
                initialOpen
                onClose={() => setSelected(null)}
              />
            ),
          )}
    </>
  );
}
