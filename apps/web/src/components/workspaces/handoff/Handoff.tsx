import { useState } from "react";
import { ArrowUpRightIcon, PackageCheckIcon } from "lucide-react";
import type {
  EnvironmentId,
  PeerHandoffPackage,
  PeerHandoffPlace,
  PeerProjectState,
  PeerTask,
  PeerWorkThread,
} from "@t3tools/contracts";
import {
  canHandOff,
  contextMovedOn,
  isEarlierHandoff,
  outcomeText,
  keyedLines,
  handoffRevision,
  summaryOf,
} from "@t3tools/client-runtime/peer/handoff";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { useEnvironmentQuery } from "../../../state/query";
import { ensureLocalApi } from "../../../localApi";
import { useOpenLink } from "../../../browser/useOpenLink";
import { cn } from "../../../lib/utils";
import { formatRelativeTimeLabel } from "../../../timestampFormat";
import { Button } from "../../ui/button";
import { Badge } from "../../ui/badge";
import { Dialog, DialogClose, DialogPopup } from "../../ui/dialog";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../../ui/select";
import { SettingsRow } from "../../settings/settingsLayout";
import {
  PeerDialogBody,
  PeerDialogFooter,
  PeerDialogHeader,
  PeerDialogMessage,
} from "../PeerDialog";
import { PeerSectionLabel } from "../PeerPageHeader";
import { NestedRowTitle, SettingsRowError } from "../PeerSettingsRows";
import { TONE_SURFACE } from "../signals";
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
        variant={icon ? "ghost" : "outline"}
        size={icon ? "icon-sm" : "xs"}
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
          <PeerDialogHeader
            icon={PackageCheckIcon}
            tone="delivery"
            title={label}
            context={
              <span>{task.key === undefined ? task.title : `${task.key} · ${task.title}`}</span>
            }
          />
          <PeerDialogBody>
            <p className="text-sm text-muted-foreground">
              Peer stores the task&apos;s shared facts and the exact context versions its agents
              read, as a package for reviewers. Publishing it to pull requests uses this
              environment&apos;s GitHub CLI.
            </p>
            {lines.length === 0 ? null : (
              <div className="flex flex-col gap-1">
                {keyedLines(lines).map(({ id, text: line }) => (
                  <PeerDialogMessage key={id}>{line}</PeerDialogMessage>
                ))}
              </div>
            )}
          </PeerDialogBody>
          <PeerDialogFooter>
            <DialogClose render={<Button variant="outline" disabled={busy} />}>Close</DialogClose>
            <Button disabled={busy} onClick={() => void act()}>
              {busy ? "Handing off…" : label}
            </Button>
          </PeerDialogFooter>
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
    <Badge variant="success" size="sm" aria-label={`Handoff #${n}`}>
      Handoff #{n}
    </Badge>
  ) : null;
}
/**
 * A task's handoff packages, with the way to withdraw one's own: what both the task context page
 * and the review page show of the handoff.
 */
function useHandoffPackages({
  environmentId,
  status,
  workspace,
  project,
  scope,
}: TaskContextSlotProps) {
  const [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const remove = useAtomCommand(serverEnvironment.peerHandoffWithdraw, { reportFailure: false });
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
  const deliveries =
    task === undefined
      ? []
      : (status.handoff?.deliveries
          .filter((o) => o.workspace === workspace && o.project === project && o.task === task.id)
          .flatMap(outcomeText) ?? []);
  return { value, task, place, data, current, deliveries, withdraw, busy, error };
}

const SECTION_TITLE = {
  State: "Where it stands",
  Provides: "What changed",
  Decisions: "Decisions",
  Blockers: "Risks and blockers",
  Next: "Next",
} as const;

/** One package: its sections as cards, the inputs its agent read, overlaps, pull requests. */
function HandoffPackageView({
  pkg,
  state,
  current,
  mine,
  busy,
  onWithdraw,
}: {
  readonly pkg: PeerHandoffPackage;
  readonly state: PeerProjectState;
  readonly current: number | null;
  readonly mine: boolean;
  readonly busy: boolean;
  readonly onWithdraw: () => void;
}) {
  const openLink = useOpenLink(null);
  const nameOf = (email: string) =>
    state.project.members.find((m) => m.email === email)?.name ?? "a teammate";
  const moved = contextMovedOn(pkg, current);
  const sections = pkg.context?.sections.filter((section) => section.lines.length > 0) ?? [];
  const pulls = pkg.pullRequests.filter((url) =>
    /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9][0-9]*$/.test(url),
  );
  return (
    <article aria-label={`Handoff #${pkg.number}`} className="flex flex-col gap-3">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="font-medium text-foreground">
          Handoff #{pkg.number} · {mine ? "yours" : nameOf(pkg.author)}
        </span>
        <span className="text-xs text-muted-foreground">
          {pkg.source === "agent" ? "built by the agent" : "built by a person"},{" "}
          {formatRelativeTimeLabel(pkg.composedAt)}
        </span>
      </p>
      {moved === null ? null : <p className="text-xs text-warning-foreground">{moved}</p>}
      {pkg.context?.gist ? <p className="text-sm text-foreground">{pkg.context.gist}</p> : null}
      {sections.length + pkg.inputs.length === 0 ? null : (
        <div className="grid gap-3 md:grid-cols-2">
          {sections.map((section) => (
            <div
              key={section.name}
              className={cn(
                "flex flex-col gap-1.5 rounded-xl border p-3.5",
                section.name === "Blockers" ? TONE_SURFACE.needs : "border-border bg-card",
              )}
            >
              <p
                className={cn(
                  "text-xs font-semibold",
                  section.name === "Blockers" ? "text-warning-foreground" : "text-muted-foreground",
                )}
              >
                {SECTION_TITLE[section.name]}
                {section.shortened ? " (shortened)" : ""}
              </p>
              <ul className="flex list-disc flex-col gap-1 pl-4 text-sm text-foreground">
                {keyedLines(section.lines).map(({ id, text }) => (
                  <li key={id}>{text}</li>
                ))}
              </ul>
            </div>
          ))}
          {pkg.inputs.length === 0 ? null : (
            <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-card p-3.5">
              <p className="text-xs font-semibold text-muted-foreground">Inputs the agent read</p>
              <ul className="flex flex-col gap-1 text-sm">
                {pkg.inputs.map((input) => (
                  <li key={input.scope} className="flex flex-wrap gap-x-1.5">
                    <span className="text-foreground">
                      {input.key ?? input.title ?? input.scope} task context
                    </span>
                    {input.currentVersion === null ? (
                      <span className="text-muted-foreground">
                        v{input.readVersion} · no longer exists
                      </span>
                    ) : input.currentVersion === input.readVersion ? (
                      <span className="text-success-foreground">
                        v{input.readVersion} · current
                      </span>
                    ) : (
                      <span className="text-warning-foreground">
                        read v{input.readVersion} · v{input.currentVersion} now
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {(pkg.context?.projectLines.length ?? 0) === 0 ? null : (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold text-muted-foreground">For the project</p>
          <ul className="flex list-disc flex-col gap-1 pl-4 text-sm text-foreground">
            {keyedLines(pkg.context!.projectLines).map(({ id, text }) => (
              <li key={id}>{text}</li>
            ))}
          </ul>
        </div>
      )}
      {pkg.overlaps.length === 0 ? null : (
        <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
          {pkg.overlaps.map((overlap) => (
            <li key={`${overlap.at}:${overlap.files.join(",")}`}>
              Overlap {overlap.state} with{" "}
              {overlap.partner === null ? "a teammate" : nameOf(overlap.partner)}:{" "}
              <span className="font-mono">{overlap.files.join(", ")}</span>
              {overlap.agreement ? ` · ${overlap.agreement}` : ""}
            </li>
          ))}
        </ul>
      )}
      {pulls.length === 0 && !mine ? null : (
        <div className="flex flex-wrap gap-1.5">
          {pulls.map((url) => (
            <Button key={url} size="xs" variant="outline" onClick={() => void openLink(url)}>
              PR #{url.split("/").at(-1)}
            </Button>
          ))}
          {mine ? (
            <Button size="xs" variant="ghost" disabled={busy} onClick={onWithdraw}>
              Withdraw
            </Button>
          ) : null}
        </div>
      )}
    </article>
  );
}

/** A task's handoff on its context page: the packages and the way to hand off or update. */
export function HandoffSection(props: TaskContextSlotProps) {
  const { environmentId, status } = props;
  const { value, task, place, data, current, deliveries, withdraw, busy, error } =
    useHandoffPackages(props);
  if (!task || !value) return null;
  return (
    <section aria-label="Handoff" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PeerSectionLabel>
          {isEarlierHandoff(task) ? "Earlier handoff" : "Handoff for review"}
        </PeerSectionLabel>
        <HandoffAction
          environmentId={environmentId}
          place={place}
          task={task}
          threads={value.work.threads}
          me={status.email}
        />
      </div>
      <HandoffPackages
        data={data}
        value={value}
        current={current}
        me={status.email}
        busy={busy}
        onWithdraw={() => void withdraw()}
      />
      <HandoffNotes deliveries={deliveries} error={error} />
    </section>
  );
}

/** A task's handoff on its review page: the package reviewers read, built when it went to review. */
export function HandoffReview(props: TaskContextSlotProps) {
  const { environmentId, status } = props;
  const { value, task, place, data, current, deliveries, withdraw, busy, error } =
    useHandoffPackages(props);
  if (!task || !value) return null;
  const latest = data.data?.reduce<PeerHandoffPackage | undefined>(
    (newest, pkg) =>
      newest === undefined || Date.parse(pkg.composedAt) > Date.parse(newest.composedAt)
        ? pkg
        : newest,
    undefined,
  );
  return (
    <section aria-label="Handoff package" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="text-lg font-semibold text-foreground">Handoff package</h2>
          <p className="text-xs text-muted-foreground">
            {latest === undefined
              ? "Built when the task goes to review, from the team's facts and the exact versions its agents read."
              : `Built ${formatRelativeTimeLabel(latest.composedAt)}, from the team's facts and the exact versions the agent read.`}
          </p>
        </div>
        <HandoffAction
          environmentId={environmentId}
          place={place}
          task={task}
          threads={value.work.threads}
          me={status.email}
        />
      </div>
      <HandoffPackages
        data={data}
        value={value}
        current={current}
        me={status.email}
        busy={busy}
        onWithdraw={() => void withdraw()}
      />
      <HandoffNotes deliveries={deliveries} error={error} />
    </section>
  );
}

function HandoffPackages({
  data,
  value,
  current,
  me,
  busy,
  onWithdraw,
}: {
  readonly data: ReturnType<typeof useHandoffPackages>["data"];
  readonly value: PeerProjectState;
  readonly current: number | null;
  readonly me: string | null;
  readonly busy: boolean;
  readonly onWithdraw: () => void;
}) {
  if (data.isPending) return <p className="text-sm text-muted-foreground">Loading handoff…</p>;
  if (data.error)
    return (
      <p role="alert" className="text-sm text-muted-foreground">
        Could not read handoff packages. Reopen this page to retry.
      </p>
    );
  if (!data.data?.length)
    return <p className="text-sm text-muted-foreground">No handoff package yet.</p>;
  return (
    <div className="flex flex-col gap-5">
      {data.data.map((pkg) => (
        <HandoffPackageView
          key={pkg.author}
          pkg={pkg}
          state={value}
          current={current}
          mine={pkg.author === me}
          busy={busy}
          onWithdraw={onWithdraw}
        />
      ))}
    </div>
  );
}

function HandoffNotes({
  deliveries,
  error,
}: {
  readonly deliveries: ReadonlyArray<string>;
  readonly error: string | null;
}) {
  if (deliveries.length === 0 && error === null) return null;
  return (
    <div className="flex flex-col gap-1">
      {keyedLines(deliveries).map(({ id, text: line }) => (
        <p key={id} className="text-xs text-muted-foreground">
          {line}
        </p>
      ))}
      {error ? (
        <p role="alert" className="text-xs text-muted-foreground">
          {error}
        </p>
      ) : null}
    </div>
  );
}
const labels = {
  comment: "Pull request comment",
  description: "Pull request description",
  none: "Not at all",
} as const;
type HandoffTarget = keyof typeof labels;
const isTarget = (value: unknown): value is HandoffTarget =>
  typeof value === "string" && value in labels;

/** Where handoff packages get published, as a settings control. */
function TargetSelect({
  label,
  targets,
  value,
  disabled,
  onChange,
}: {
  label: string;
  targets: ReadonlyArray<HandoffTarget>;
  value: HandoffTarget;
  disabled: boolean;
  onChange: (target: HandoffTarget) => void;
}) {
  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (isTarget(next) && next !== value) onChange(next);
      }}
    >
      <SelectTrigger size="sm" aria-label={label}>
        <SelectValue>{(current: HandoffTarget) => labels[current]}</SelectValue>
      </SelectTrigger>
      <SelectPopup align="end" alignItemWithTrigger={false}>
        {targets.map((target) => (
          <SelectItem key={target} value={target}>
            {labels[target]}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

export function HandoffSettings({ environmentId, status }: PeerSlotProps) {
  const { owner } = usePeerPluginControl(environmentId);
  const command = useAtomCommand(serverEnvironment.peerHandoffSetTarget, { reportFailure: false }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  if (!owner || !status.handoff) return null;
  return (
    <SettingsRow
      title="Handoff publishing"
      description="Not at all keeps the package in Peer only. Description publishing is an opt-in setting for each project. Withdraw before turning the plugin off to remove published blocks."
      status={error ? <SettingsRowError>{error}</SettingsRowError> : null}
      control={
        <TargetSelect
          label="Handoff publishing"
          targets={["comment", "none"]}
          value={status.handoff.target}
          disabled={busy}
          onChange={(target) => {
            setBusy(true);
            void command({ environmentId, input: { target } })
              .then((r) => setError(failureMessage(r)))
              .finally(() => setBusy(false));
          }}
        />
      }
    />
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
    <SettingsRow
      title={<NestedRowTitle under="project">Handoff publishing</NestedRowTitle>}
      description={`Where ${state.project.name}’s handoff packages appear besides Peer.`}
      status={error ? <SettingsRowError>{error}</SettingsRowError> : null}
      control={
        <TargetSelect
          label={`Handoff publishing for ${state.project.name}`}
          targets={["comment", "description", "none"]}
          value={selected}
          disabled={busy}
          onChange={(target) => {
            setBusy(true);
            void command({
              environmentId,
              input: { workspace: workspace.slug, projectId: state.project.id, target },
            })
              .then((r) => setError(failureMessage(r)))
              .finally(() => setBusy(false));
          }}
        />
      }
    />
  );
}
