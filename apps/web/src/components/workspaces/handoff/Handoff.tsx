import { useState } from "react";
import { ArrowUpRightIcon } from "lucide-react";
import type { EnvironmentId, PeerHandoffPlace, PeerTask, PeerWorkThread } from "@t3tools/contracts";
import {
  canHandOff,
  contextMovedOn,
  isEarlierHandoff,
  outcomeText,
  packageRows,
  keyedLines,
  handoffRevision,
  summaryOf,
} from "@t3tools/client-runtime/peer/handoff";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { useEnvironmentQuery } from "../../../state/query";
import { ensureLocalApi } from "../../../localApi";
import { useOpenLink } from "../../../browser/useOpenLink";
import { Button } from "../../ui/button";
import { Badge } from "../../ui/badge";
import { Dialog, DialogPopup, DialogTitle, DialogDescription } from "../../ui/dialog";
import { failureMessage } from "../WorkspaceAccess";
import { usePeerPluginControl } from "../usePeerPluginControl";
import type {
  TaskSlotProps,
  TaskContextSlotProps,
  PeerSlotProps,
  ProjectSettingsSlotProps,
} from "../slots.types";
export function HandoffAction({
  environmentId,
  place,
  task,
  threads,
  me,
  icon = false,
}: {
  environmentId: EnvironmentId;
  place: PeerHandoffPlace;
  task: PeerTask;
  threads: ReadonlyArray<PeerWorkThread>;
  me: string | null;
  icon?: boolean;
}) {
  const command = useAtomCommand(serverEnvironment.peerHandoffHandOff, { reportFailure: false });
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [lines, setLines] = useState<string[]>([]);
  const label = canHandOff(task, threads, me);
  if (!label) return null;
  const act = async () => {
    setBusy(true);
    try {
      const result = await command({ environmentId, input: place });
      setLines(
        result._tag === "Success"
          ? outcomeText(result.value)
          : [failureMessage(result) ?? "Could not hand off."],
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button
        variant="ghost"
        size={icon ? "icon-sm" : "sm"}
        aria-label={label}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        {icon ? <ArrowUpRightIcon /> : label}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogPopup>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>
            Store the current shared facts for reviewers. Publishing uses this environment’s GitHub
            CLI.
          </DialogDescription>
          <div className="space-y-2 py-3">
            {keyedLines(lines).map(({ id, text: line }) => (
              <p key={id} className="text-sm">
                {line}
              </p>
            ))}
          </div>
          <Button disabled={busy} onClick={() => void act()}>
            {busy ? "Handing off…" : label}
          </Button>
        </DialogPopup>
      </Dialog>
    </>
  );
}
export function HandoffTaskAction(p: TaskSlotProps) {
  const task = p.project?.work.tasks.find((t) => t.id === p.task.id);
  return task && p.project ? (
    <HandoffAction
      environmentId={p.environmentId}
      place={{ workspace: p.workspace, projectId: p.project.project.id, taskId: task.id }}
      task={task}
      threads={p.project.work.threads}
      me={p.status.email}
      icon
    />
  ) : null;
}
export function HandoffBadge(p: TaskSlotProps) {
  if (p.project?.work.tasks.find((t) => t.id === p.task.id)?.status !== "review") return null;
  const n = Math.max(
    0,
    ...summaryOf(p.status.handoff, {
      workspace: p.workspace,
      projectId: p.project!.project.id,
      taskId: p.task.id,
    }).map((s) => s.number),
  );
  return n ? (
    <Badge variant="outline" size="sm" aria-label={`Handoff #${n}`}>
      Handoff #{n}
    </Badge>
  ) : null;
}
export function HandoffSection({
  environmentId,
  status,
  workspace,
  project,
  scope,
}: TaskContextSlotProps) {
  const [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const remove = useAtomCommand(serverEnvironment.peerHandoffWithdraw, { reportFailure: false }),
    openLink = useOpenLink(null);
  const value = status.workspaces
      .find((w) => w.slug === workspace)
      ?.projects.find((p) => p.project.id === project),
    task = value?.work.tasks.find((t) => scope === `task:${t.id}`),
    place = { workspace, projectId: project, taskId: task?.id ?? "" };
  const summaries = summaryOf(status.handoff, place);
  const data = useEnvironmentQuery(
    task && summaries.length
      ? serverEnvironment.peerHandoffRead({
          environmentId,
          input: { ...place, revision: handoffRevision(summaries, revision) },
        })
      : null,
  );
  if (!task || !value) return null;
  const withdraw = async () => {
    if (
      !(await ensureLocalApi().dialogs.confirm(
        "Withdraw your package and remove your published handoff blocks? The task status stays unchanged.",
      ))
    )
      return;
    setBusy(true);
    try {
      const r = await remove({ environmentId, input: place });
      setError(r._tag === "Success" ? outcomeText(r.value).join(" ") : failureMessage(r));
      setRevision((v) => v + 1);
    } finally {
      setBusy(false);
    }
  };
  const current =
    status.coordination.contexts.find(
      (c) => c.workspace === workspace && c.project === project && c.scope === scope,
    )?.version ?? null;
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-medium">
        {isEarlierHandoff(task) ? "Earlier handoff" : "Handoff for review"}
      </h3>
      <HandoffAction
        environmentId={environmentId}
        place={place}
        task={task}
        threads={value.work.threads}
        me={status.email}
      />
      {data.isPending ? <p className="text-sm">Loading handoff…</p> : null}
      {data.error ? (
        <p role="alert">Could not read handoff packages. Reopen this section to retry.</p>
      ) : null}
      {data.data?.map((p) => (
        <div key={p.author} className="space-y-1">
          <p className="text-sm font-medium">
            Handoff #{p.number} ·{" "}
            {value.project.members.find((m) => m.email === p.author)?.name ?? "Teammate"}
          </p>
          {contextMovedOn(p, current) ? (
            <p className="text-sm text-muted-foreground">{contextMovedOn(p, current)}</p>
          ) : null}
          {keyedLines(
            packageRows(
              p,
              (email) => value.project.members.find((m) => m.email === email)?.name ?? "a teammate",
            ),
          ).map(({ id, text: line }) => (
            <p key={id} className="whitespace-pre-wrap text-sm">
              {line}
            </p>
          ))}
          {p.pullRequests
            .filter((url) =>
              /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9][0-9]*$/.test(
                url,
              ),
            )
            .map((url) => (
              <div key={url}>
                <Button variant="ghost" size="sm" onClick={() => void openLink(url)}>
                  {url}
                </Button>
              </div>
            ))}
          {p.author === status.email ? (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void withdraw()}>
              Withdraw
            </Button>
          ) : null}
        </div>
      ))}
      {keyedLines(
        status.handoff?.deliveries
          .filter((o) => o.workspace === workspace && o.project === project && o.task === task.id)
          .flatMap(outcomeText) ?? [],
      ).map(({ id, text: line }) => (
        <p key={id} className="text-sm">
          {line}
        </p>
      ))}
      {error ? (
        <p role="alert" className="text-sm">
          {error}
        </p>
      ) : null}
    </section>
  );
}
const labels = {
  comment: "Pull request comment",
  description: "Pull request description",
  none: "Not at all",
} as const;
export function HandoffSettings({ environmentId, status }: PeerSlotProps) {
  const { owner } = usePeerPluginControl(environmentId);
  const command = useAtomCommand(serverEnvironment.peerHandoffSetTarget, { reportFailure: false }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  if (!owner || !status.handoff) return null;
  return (
    <section className="space-y-2 py-3">
      <h3 className="text-sm font-medium">Handoff publishing</h3>
      <p className="text-sm text-muted-foreground">
        Not at all keeps the package in Peer only. Description publishing is an opt-in setting for
        each project. Withdraw before turning the plugin off to remove published blocks.
      </p>
      {(["comment", "none"] as const).map((target) => (
        <Button
          key={target}
          variant="ghost"
          size="sm"
          disabled={busy}
          aria-pressed={status.handoff?.target === target}
          onClick={() => {
            setBusy(true);
            void command({ environmentId, input: { target } })
              .then((r) => setError(failureMessage(r)))
              .finally(() => setBusy(false));
          }}
        >
          {labels[target]}
        </Button>
      ))}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
export function HandoffProjectSettings({
  environmentId,
  status,
  workspace,
  state,
}: ProjectSettingsSlotProps) {
  const { owner } = usePeerPluginControl(environmentId),
    command = useAtomCommand(serverEnvironment.peerHandoffSetTarget, { reportFailure: false }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  if (!owner || !status.handoff) return null;
  const selected =
    status.handoff.projectTargets[`${workspace.slug}/${state.project.id}`] ?? status.handoff.target;
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">Handoff publishing · {state.project.name}</h3>
      {(["comment", "description", "none"] as const).map((target) => (
        <Button
          key={target}
          variant="ghost"
          size="sm"
          disabled={busy}
          aria-pressed={selected === target}
          onClick={() => {
            setBusy(true);
            void command({
              environmentId,
              input: { workspace: workspace.slug, projectId: state.project.id, target },
            })
              .then((r) => setError(failureMessage(r)))
              .finally(() => setBusy(false));
          }}
        >
          {labels[target]}
        </Button>
      ))}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
