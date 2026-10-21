import { useNavigate } from "@tanstack/react-router";
import { useContext, useState } from "react";
import { ArrowUpRightIcon, PackageCheckIcon, TriangleAlertIcon } from "lucide-react";
import type {
  EnvironmentId,
  PeerHandoffPackage,
  PeerHandoffPlace,
  PeerProjectState,
  PeerTask,
  PeerWorkContext,
  PeerWorkThread,
} from "@t3tools/contracts";
import {
  canHandOff,
  contextMovedOn,
  contextWritten,
  currentContextVersion,
  isEarlierHandoff,
  outcomeText,
  inputLabel,
  inputState,
  keyedLines,
  handoffLines,
  handoffRevision,
  shortenedNote,
  summaryOf,
  TARGET_SWITCH_NOTE,
  type ContextMovedOn,
} from "@t3tools/client-runtime/peer/handoff";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { useEnvironmentQuery } from "../../../state/query";
import { ensureLocalApi } from "../../../localApi";
import { useOpenLink } from "../../../browser/useOpenLink";
import { cn } from "../../../lib/utils";
import { formatRelativeTimeLabel } from "../../../timestampFormat";
import { Alert, AlertDescription, AlertTitle } from "../../ui/alert";
import { Button, InlineButton } from "../../ui/button";
import { Badge } from "../../ui/badge";
import { InlineMarkdown } from "../../InlineMarkdown";
import { Dialog, DialogClose, DialogPopup } from "../../ui/dialog";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../../ui/select";
import { SettingsRow } from "../../settings/settingsLayout";
import {
  PeerDialogBody,
  PeerDialogFooter,
  PeerDialogHeader,
  PeerDialogMessage,
} from "../PeerDialog";
import { contextComparison } from "../contextCompare.logic";
import { PeerSectionLabel } from "../PeerPageHeader";
import { HandoffChatContext } from "../review/HandoffChat";
import { NestedRowTitle, SettingsRowError } from "../PeerSettingsRows";
import { failureMessage } from "../WorkspaceAccess";
import { usePeerPluginControl } from "../usePeerPluginControl";
import type {
  TaskSlotProps,
  TaskContextSlotProps,
  PeerSlotProps,
  ProjectSettingsSlotProps,
} from "../slots.types";
import { withFinally } from "~/lib/withFinally";
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
    await withFinally(
      async () => {
        const result = await command({ environmentId, input: place });
        setLines(
          result._tag === "Success"
            ? outcomeText(result.value)
            : [failureMessage(result) ?? "Could not hand off."],
        );
      },
      () => {
        setBusy(false);
      },
    );
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
    await withFinally(
      async () => {
        const r = await remove({ environmentId, input: place });
        // A Withdraw that worked is already among the delivery lines below; only a failure is a note.
        setError(failureMessage(r));
        setRevision((v) => v + 1);
      },
      () => {
        setBusy(false);
      },
    );
  };
  const latest = status.coordination.contexts.find(
    (c) => c.workspace === workspace && c.project === project && c.scope === scope,
  );
  const current = currentContextVersion(status.coordination, place);
  const deliveries =
    task === undefined
      ? []
      : (status.handoff?.deliveries
          .filter((o) => o.workspace === workspace && o.project === project && o.task === task.id)
          .flatMap(outcomeText) ?? []);
  return { value, task, place, data, latest, current, deliveries, withdraw, busy, error };
}

const SECTION_TITLE = {
  State: "Where it stands",
  Provides: "What changed",
  Decisions: "Decisions",
  Blockers: "Risks and blockers",
  Next: "Next",
} as const;

/**
 * The task context changed after the handoff was built: the version it was built from and the
 * latest, with who wrote that and when, and the two ways on: Compare, and the context page.
 */
function ContextMovedBanner({
  moved,
  written,
  onCompare,
  onOpenContext,
}: {
  readonly moved: ContextMovedOn;
  /** After "the latest is v4,": who wrote it and how long ago. */
  readonly written: string;
  readonly onCompare: () => void;
  /** Absent on the context page itself. */
  readonly onOpenContext: (() => void) | undefined;
}) {
  return (
    <Alert variant="warning" role="status">
      <TriangleAlertIcon aria-hidden />
      <AlertTitle>The task context changed after this handoff</AlertTitle>
      <AlertDescription>
        <p>
          It was built from <strong className="font-semibold">v{moved.read}</strong>
          {moved.latest === null ? (
            "; the task context no longer exists."
          ) : (
            <>
              ; the latest is <strong className="font-semibold">v{moved.latest}</strong>
              {written === "" ? "" : `, ${written}`}.
            </>
          )}
        </p>
        {moved.latest === null ? null : (
          <div className="flex flex-wrap gap-2">
            {contextComparison(moved.read, moved.latest) === null ? null : (
              <Button size="xs" variant="warning-outline" onClick={onCompare}>
                Compare v{moved.read} → v{moved.latest}
              </Button>
            )}
            {onOpenContext === undefined ? null : (
              <Button size="xs" variant="outline" onClick={onOpenContext}>
                Open task context
              </Button>
            )}
          </div>
        )}
      </AlertDescription>
    </Alert>
  );
}

/** A section's lines: one bullet each, the agent's inline markdown read as such. */
function HandoffLines({ lines }: { readonly lines: ReadonlyArray<string> }) {
  return (
    <ul className="flex list-disc flex-col gap-1 pl-4 text-sm text-foreground">
      {handoffLines(lines).map(({ id, text }) => (
        <li key={id}>
          <InlineMarkdown text={text} />
        </li>
      ))}
    </ul>
  );
}

/** One package's authored result and risks, followed by its supporting facts and provenance. */
function HandoffPackageView({
  pkg,
  state,
  workspace,
  latest,
  current,
  me,
  mine,
  busy,
  onContextPage,
  onWithdraw,
}: {
  readonly pkg: PeerHandoffPackage;
  readonly state: PeerProjectState;
  readonly workspace: string;
  /** The task's context as it is now; none once it no longer exists. */
  readonly latest: PeerWorkContext | undefined;
  /** Its version, as `currentContextVersion` reads it: undefined when this computer cannot tell. */
  readonly current: number | null | undefined;
  readonly me: string | null;
  readonly mine: boolean;
  readonly busy: boolean;
  /** The package is on the task's context page, which a link to that page would only reload. */
  readonly onContextPage: boolean;
  readonly onWithdraw: () => void;
}) {
  const openLink = useOpenLink(null);
  const navigate = useNavigate();
  const nameOf = (email: string) =>
    state.project.members.find((m) => m.email === email)?.name ?? "a teammate";
  const moved = contextMovedOn(pkg, current);
  const chat = useContext(HandoffChatContext);
  const project = state.project.id;
  const openContext = (scope: string) =>
    void navigate({
      to: "/context/$workspace/$project/$scope",
      params: { workspace, project, scope },
    });
  const compareContext = (scope: string, compare: number) =>
    void navigate({
      to: "/context/$workspace/$project/$scope",
      params: { workspace, project, scope },
      search: { compare },
    });
  const sections =
    pkg.context?.sections.filter((section) => handoffLines(section.lines).length > 0) ?? [];
  const orderedSections = ["Blockers", "State", "Provides", "Decisions", "Next"].flatMap((name) =>
    sections.filter((section) => section.name === name),
  );
  const staleInputs = pkg.inputs.filter((input) => inputState(input) !== "current");
  const pulls = pkg.pullRequests.filter((url) =>
    /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9][0-9]*$/.test(url),
  );
  return (
    <article
      aria-label={`Handoff #${pkg.number}`}
      className="flex min-w-0 flex-col gap-4 [overflow-wrap:anywhere]"
    >
      {pkg.context?.gist ? (
        <p className="text-base leading-relaxed text-foreground">
          <InlineMarkdown text={pkg.context.gist} />
        </p>
      ) : null}
      {moved === null ? null : (
        <ContextMovedBanner
          moved={moved}
          written={[
            contextWritten(latest, nameOf, me),
            latest === undefined ? "" : formatRelativeTimeLabel(latest.updatedAt),
          ]
            .filter(Boolean)
            .join(" ")}
          onCompare={() => compareContext(moved.context, moved.read)}
          onOpenContext={onContextPage ? undefined : () => openContext(moved.context)}
        />
      )}
      {staleInputs.length === 0 ? null : (
        <section
          aria-label="Changed handoff inputs"
          className="flex flex-col gap-2 border-l-2 border-warning pl-3"
        >
          <h3 className="text-sm font-semibold text-warning-foreground">
            Some inputs have changed
          </h3>
          <HandoffInputs inputs={staleInputs} onCompare={compareContext} />
        </section>
      )}
      {pkg.overlaps.length === 0 ? null : (
        <ul
          aria-label="Overlapping work"
          className="flex flex-col gap-1 text-sm text-warning-foreground"
        >
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
      {orderedSections.length === 0 ? null : (
        <div className="flex flex-col divide-y divide-border/60">
          {orderedSections.map((section) => (
            <section
              key={section.name}
              className={cn(
                "flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0",
                section.name === "Blockers" && "border-l-2 border-warning pl-3",
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <h3
                  className={cn(
                    "text-sm font-semibold",
                    section.name === "Blockers" ? "text-warning-foreground" : "text-foreground",
                  )}
                >
                  {SECTION_TITLE[section.name]}
                </h3>
                {section.shortened ? (
                  <Badge variant="secondary" size="sm">
                    shortened
                  </Badge>
                ) : null}
              </div>
              <HandoffLines lines={section.lines} />
              {section.shortened ? (
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  {shortenedNote(mine ? null : nameOf(pkg.author))}
                  {mine && chat !== null ? (
                    <InlineButton onClick={chat.open}>Open chat</InlineButton>
                  ) : null}
                </p>
              ) : null}
            </section>
          ))}
        </div>
      )}
      {pulls.length === 0 ? null : (
        <div className="flex flex-wrap gap-1.5">
          {pulls.map((url) => (
            <Button key={url} size="xs" variant="outline" onClick={() => void openLink(url)}>
              PR #{url.split("/").at(-1)}
            </Button>
          ))}
        </div>
      )}
      <details className="border-t border-border/60 pt-3">
        <summary className="cursor-pointer rounded-sm text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
          Handoff #{pkg.number} · Sources and details
        </summary>
        <div className="flex flex-col gap-4 pt-3">
          <p className="text-xs text-muted-foreground">
            {mine ? "You" : nameOf(pkg.author)} ({pkg.author}) ·{" "}
            {pkg.source === "agent" ? "built by the agent" : "built by a person"} ·{" "}
            <time dateTime={pkg.composedAt}>{pkg.composedAt}</time>
            {pkg.context === null ? null : ` · task context v${pkg.context.version}`}
          </p>
          {pkg.inputs.length === 0 ? null : (
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-foreground">What the agent read</h3>
              <HandoffInputs inputs={pkg.inputs} onCompare={compareContext} />
            </section>
          )}
          {(pkg.context?.projectLines.length ?? 0) === 0 ? null : (
            <div className="flex flex-col gap-1">
              <p className="text-xs font-semibold text-muted-foreground">For the project</p>
              <HandoffLines lines={pkg.context!.projectLines} />
            </div>
          )}
          {mine ? (
            <div>
              <Button size="xs" variant="ghost" disabled={busy} onClick={onWithdraw}>
                Withdraw
              </Button>
            </div>
          ) : null}
        </div>
      </details>
    </article>
  );
}

function HandoffInputs({
  inputs,
  onCompare,
}: {
  readonly inputs: PeerHandoffPackage["inputs"];
  readonly onCompare: (scope: string, version: number) => void;
}) {
  return (
    <ul className="flex flex-col gap-2 text-sm">
      {inputs.map((input) => {
        const readState = inputState(input);
        return (
          <li key={input.scope} className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="min-w-0 flex-1 basis-60 text-foreground">{inputLabel(input)}</span>
            <span
              className={
                readState === "current" ? "text-muted-foreground" : "text-warning-foreground"
              }
            >
              {readState === "gone"
                ? `v${input.readVersion} · no longer exists`
                : readState === "current"
                  ? `v${input.readVersion} · current`
                  : `read v${input.readVersion} · v${input.currentVersion} now`}
            </span>
            {readState === "changed" &&
            contextComparison(input.readVersion, input.currentVersion ?? undefined) !== null ? (
              <Button
                size="xs"
                variant="outline"
                onClick={() => onCompare(input.scope, input.readVersion)}
              >
                Compare
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** A task's handoff on its context page: the packages and the way to hand off or update. */
export function HandoffSection(props: TaskContextSlotProps) {
  const { environmentId, status } = props;
  const { value, task, place, data, latest, current, deliveries, withdraw, busy, error } =
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
        workspace={place.workspace}
        latest={latest}
        current={current}
        me={status.email}
        busy={busy}
        onContextPage
        onWithdraw={() => void withdraw()}
      />
      <HandoffNotes deliveries={deliveries} error={error} />
    </section>
  );
}

/** A task's handoff on its review page: the package reviewers read, built when it went to review. */
export function HandoffReview(props: TaskContextSlotProps) {
  const { environmentId, status } = props;
  const { value, task, place, data, latest, current, deliveries, withdraw, busy, error } =
    useHandoffPackages(props);
  if (!task || !value) return null;
  return (
    <section aria-label="Handoff package" className="flex flex-col gap-3">
      <h2 className="text-base font-semibold text-foreground">Decision brief</h2>
      <HandoffPackages
        data={data}
        value={value}
        workspace={place.workspace}
        latest={latest}
        current={current}
        me={status.email}
        busy={busy}
        onContextPage={false}
        onWithdraw={() => void withdraw()}
      />
      <div>
        <HandoffAction
          environmentId={environmentId}
          place={place}
          task={task}
          threads={value.work.threads}
          me={status.email}
        />
      </div>
      <HandoffNotes deliveries={deliveries} error={error} />
    </section>
  );
}

function HandoffPackages({
  data,
  value,
  workspace,
  latest,
  current,
  me,
  busy,
  onContextPage,
  onWithdraw,
}: {
  readonly data: ReturnType<typeof useHandoffPackages>["data"];
  readonly value: PeerProjectState;
  readonly workspace: string;
  readonly latest: PeerWorkContext | undefined;
  readonly current: number | null | undefined;
  readonly me: string | null;
  readonly busy: boolean;
  readonly onContextPage: boolean;
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
          workspace={workspace}
          latest={latest}
          current={current}
          me={me}
          mine={pkg.author === me}
          busy={busy}
          onContextPage={onContextPage}
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
      description={`Not at all keeps the package in Peer only. Description publishing is an opt-in setting for each project. ${TARGET_SWITCH_NOTE} Withdraw before turning the plugin off to remove published blocks.`}
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
      description={`Where ${state.project.name}’s handoff packages appear besides Peer. ${TARGET_SWITCH_NOTE}`}
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
