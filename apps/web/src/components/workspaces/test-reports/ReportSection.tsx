import { useAtomValue } from "@effect/atom-react";
import {
  draftItems,
  draftOf,
  itemMark,
  markDisagrees,
  ownReport,
  staleOwnerLine,
  type ReportDraft,
} from "@t3tools/client-runtime/peer/test-reports";
import type {
  PeerTask,
  PeerTestReport,
  PeerTestReportItem,
  PeerTestReportResult,
} from "@t3tools/contracts";
import { useState } from "react";

import { ensureLocalApi } from "../../../localApi";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { formatRelativeTimeLabel } from "../../../timestampFormat";
import { withFinally } from "~/lib/withFinally";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../../ui/select";
import { Textarea } from "../../ui/textarea";
import { PeerStackedField } from "../PeerDialog";
import { PeerSectionLabel } from "../PeerPageHeader";
import type { TaskSlotProps } from "../slots.types";
import { assignRights, authorLine, reportFailure } from "./testReports.logic";
import { useTestReports } from "./useTestReports";

const RESULT_BADGE = { pass: "success", fail: "error", mixed: "warning" } as const;
const KIND_WORD = { pass: "Passed", fail: "Failed", unverified: "Unverified" } as const;
const RESULTS: ReadonlyArray<PeerTestReportResult> = ["pass", "fail", "mixed"];
/** The owner select's value for an item nobody answers for; no address looks like it. */
const NO_OWNER = "no-owner";
/** Its value for an item its author left to a dependent task; choosing a person or "No owner" replaces that. */
const LEFT_TO_TASK = "left-to-task";

type Member = { readonly email: string; readonly name: string };

/**
 * A task's test reports on its page: every author's newest report with its result, its items and
 * where each claim comes from ("seen run by Peer, passed, 14:02" or "author-reported"), and the
 * owner of every unverified item. The person files, replaces or removes their own report; the
 * task's owner, a lead or an admin gives an unverified item an owner. The Hub decides each change,
 * and a save made from a report that was replaced meanwhile is refused with the newer one shown.
 */
export function ReportSection(props: TaskSlotProps) {
  const state = props.project;
  const project = state?.project;
  if (state === undefined || project === undefined) return null;
  return (
    <TaskReports
      environmentId={props.environmentId}
      status={props.status}
      workspace={props.workspace}
      project={project.id}
      members={project.members}
      task={props.task.id}
      taskName={props.task.key ?? props.task.title}
      tasks={state.work.tasks}
    />
  );
}

function TaskReports({
  environmentId,
  status,
  workspace,
  project,
  members,
  task,
  taskName,
  tasks,
}: Pick<TaskSlotProps, "environmentId" | "status"> & {
  readonly workspace: string;
  readonly project: string;
  readonly members: ReadonlyArray<Member>;
  readonly task: string;
  readonly taskName: string;
  readonly tasks: ReadonlyArray<Pick<PeerTask, "id" | "key" | "title">>;
}) {
  const { reports, error, refresh } = useTestReports({
    environmentId,
    status,
    workspace,
    project,
    task,
  });
  const mayFile = useAtomValue(serverEnvironment.peerTestsFile.permissionAtom(environmentId));
  const mayRemove = useAtomValue(serverEnvironment.peerTestsRemove.permissionAtom(environmentId));
  const maySetOwner = useAtomValue(
    serverEnvironment.peerTestsSetOwner.permissionAtom(environmentId),
  );
  const file = useAtomCommand(serverEnvironment.peerTestsFile, { reportFailure: false });
  const remove = useAtomCommand(serverEnvironment.peerTestsRemove, { reportFailure: false });
  const setOwner = useAtomCommand(serverEnvironment.peerTestsSetOwner, { reportFailure: false });
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const place = { workspace, project, task };
  const me = status.email;
  const own = ownReport(reports ?? [], me);
  const canAssign = maySetOwner && assignRights(status, place);
  const taskLabel = (id: string) => {
    const found = tasks.find((candidate) => candidate.id === id);
    return found === undefined ? id : (found.key ?? found.title);
  };
  const name = (email: string) =>
    members.find((member) => member.email.toLowerCase() === email.toLowerCase())?.name ??
    email.split("@")[0] ??
    email;

  const run = async (action: () => Promise<string | null>) => {
    setBusy(true);
    setFailure(null);
    setNotice(null);
    await withFinally(
      async () => {
        setFailure(await action());
      },
      () => setBusy(false),
    );
  };
  const save = (draft: ReportDraft) =>
    run(async () => {
      const result = await file({
        environmentId,
        input: {
          ...place,
          result: draft.result,
          summary: draft.summary.trim(),
          items: draftItems(draft),
        },
      });
      const failed = reportFailure(result);
      if (failed === null) {
        setEditing(false);
        refresh();
      }
      return failed;
    });
  const removeOwn = (report: PeerTestReport) =>
    run(async () => {
      const yes = await ensureLocalApi().dialogs.confirm(
        `Remove your test report ${report.number} on ${taskName}? An agent on the task can file a new one.`,
      );
      if (!yes) return null;
      const result = await remove({ environmentId, input: place });
      if (result._tag === "Success") refresh();
      return reportFailure(result);
    });
  const assign = (report: PeerTestReport, index: number, owner: string | null) =>
    run(async () => {
      const result = await setOwner({
        environmentId,
        input: { ...place, author: report.author, index, number: report.number, owner },
      });
      if (result._tag === "Success") {
        setNotice(staleOwnerLine(result.value));
        refresh();
      }
      return reportFailure(result);
    });

  return (
    <section aria-label="Test reports" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <PeerSectionLabel>Test reports</PeerSectionLabel>
        <p className="max-w-prose text-sm text-muted-foreground">
          What this task was tested against. “Seen run by Peer” means Peer saw the agent’s session
          run that exact command; everything else is what its author says. An agent finishes the
          task only once every unverified item has an owner.
        </p>
      </div>
      {error === null ? null : (
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="text-sm text-destructive-foreground">
            {error}
          </p>
          <Button variant="outline" size="sm" onClick={refresh}>
            Retry
          </Button>
        </div>
      )}
      {notice === null ? null : (
        <p role="status" className="text-sm text-warning-foreground">
          {notice}
        </p>
      )}
      {failure === null ? null : (
        <p role="alert" className="text-sm text-destructive-foreground">
          {failure}
        </p>
      )}
      {reports === undefined ? (
        error === null ? (
          <p role="status" className="text-sm text-muted-foreground">
            Reading the test reports…
          </p>
        ) : null
      ) : reports.length === 0 ? (
        <p className="text-sm text-muted-foreground">No test report was filed on this task yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {reports.map((report) => {
            const mine = report === own;
            return (
              <ReportRow
                key={report.author}
                report={report}
                author={authorLine(report, me, name)}
                busy={busy}
                members={members}
                name={name}
                taskLabel={taskLabel}
                canAssign={canAssign}
                onReplace={mine && mayFile && !editing ? () => setEditing(true) : undefined}
                onRemove={mine && mayRemove ? () => void removeOwn(report) : undefined}
                onAssign={(index, owner) => void assign(report, index, owner)}
              />
            );
          })}
        </ul>
      )}
      {editing ? (
        <ReportForm
          initial={draftOf(own)}
          replacing={own?.number}
          busy={busy}
          onSave={(draft) => void save(draft)}
          onCancel={() => setEditing(false)}
        />
      ) : own === undefined && mayFile && reports !== undefined ? (
        <div className="flex">
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            File a report
          </Button>
        </div>
      ) : null}
    </section>
  );
}

/** Items keyed by their words, a repeat by its occurrence; `index` is the position the Hub names. */
function itemKeys(items: ReadonlyArray<PeerTestReportItem>) {
  const seen = new Map<string, number>();
  return items.map((item, index) => {
    const base = `${item.kind}:${item.text}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return { item, index, key: `${base}:${n}` };
  });
}

function ReportRow({
  report,
  author,
  busy,
  members,
  name,
  taskLabel,
  canAssign,
  onReplace,
  onRemove,
  onAssign,
}: {
  readonly report: PeerTestReport;
  readonly author: string;
  readonly busy: boolean;
  readonly members: ReadonlyArray<Member>;
  readonly name: (email: string) => string;
  /** A task an item is left to, as its key or title. */
  readonly taskLabel: (id: string) => string;
  readonly canAssign: boolean;
  readonly onReplace: (() => void) | undefined;
  readonly onRemove: (() => void) | undefined;
  readonly onAssign: (index: number, owner: string | null) => void;
}) {
  return (
    <li className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className="text-sm font-medium text-foreground">Report {report.number}</span>
        <Badge variant={RESULT_BADGE[report.result]}>{report.result}</Badge>
        <span className="text-xs text-muted-foreground">
          {author} · <time dateTime={report.at}>{formatRelativeTimeLabel(report.at)}</time>
          {report.shortened === true ? " · shortened by the Hub" : ""}
        </span>
        {onReplace === undefined && onRemove === undefined ? null : (
          <span className="ml-auto flex gap-1.5">
            {onReplace === undefined ? null : (
              <Button size="xs" variant="outline" disabled={busy} onClick={onReplace}>
                Replace
              </Button>
            )}
            {onRemove === undefined ? null : (
              <Button size="xs" variant="ghost-muted" disabled={busy} onClick={onRemove}>
                Remove
              </Button>
            )}
          </span>
        )}
      </div>
      <p className="max-w-prose text-sm leading-relaxed break-words text-foreground">
        {report.summary}
      </p>
      {report.items.length === 0 ? null : (
        <ul aria-label={`Items of report ${report.number}`} className="flex flex-col gap-1.5">
          {itemKeys(report.items).map(({ item, index, key }) => (
            <ItemRow
              key={key}
              item={item}
              busy={busy}
              members={members}
              name={name}
              taskLabel={taskLabel}
              canAssign={canAssign}
              onAssign={(owner) => onAssign(index, owner)}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function ItemRow({
  item,
  busy,
  members,
  name,
  taskLabel,
  canAssign,
  onAssign,
}: {
  readonly item: PeerTestReportItem;
  readonly busy: boolean;
  readonly members: ReadonlyArray<Member>;
  readonly name: (email: string) => string;
  readonly taskLabel: (id: string) => string;
  readonly canAssign: boolean;
  readonly onAssign: (owner: string | null) => void;
}) {
  const mark = itemMark(item);
  // Left to a dependent task by its author: shown as such; a person who names an owner takes it over.
  const leftTo = item.kind === "unverified" && item.owner === undefined ? item.task : undefined;
  return (
    <li className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-sm">
      <span className="w-20 shrink-0 text-xs text-muted-foreground">{KIND_WORD[item.kind]}</span>
      <span className="min-w-0 flex-1 basis-48 break-words text-foreground">{item.text}</span>
      {mark === null ? null : (
        <span
          className={
            markDisagrees(item)
              ? "text-xs text-warning-foreground"
              : "text-xs text-muted-foreground"
          }
        >
          {mark}
        </span>
      )}
      {leftTo === undefined ? null : (
        <span className="text-xs text-muted-foreground">Left to {taskLabel(leftTo)}</span>
      )}
      {item.kind !== "unverified" ? null : canAssign ? (
        <OwnerSelect item={item} busy={busy} members={members} name={name} onAssign={onAssign} />
      ) : leftTo !== undefined ? null : (
        <span
          className={
            item.owner === undefined
              ? "text-xs text-warning-foreground"
              : "text-xs text-muted-foreground"
          }
        >
          {item.owner === undefined ? "Needs an owner" : `Owner ${name(item.owner)}`}
        </span>
      )}
    </li>
  );
}

/** The owner of one unverified item, for the task's owner, a lead or an admin to change. */
function OwnerSelect({
  item,
  busy,
  members,
  name,
  onAssign,
}: {
  readonly item: PeerTestReportItem;
  readonly busy: boolean;
  readonly members: ReadonlyArray<Member>;
  readonly name: (email: string) => string;
  readonly onAssign: (owner: string | null) => void;
}) {
  const leftToTask = item.owner === undefined && item.task !== undefined;
  const value = item.owner ?? (leftToTask ? LEFT_TO_TASK : NO_OWNER);
  // Someone who left the project still shows as the owner the Hub keeps.
  const people =
    item.owner === undefined ||
    members.some((member) => member.email.toLowerCase() === item.owner!.toLowerCase())
      ? members
      : [...members, { email: item.owner, name: name(item.owner) }];
  return (
    <div className="w-44 shrink-0">
      <Select
        value={value}
        disabled={busy}
        onValueChange={(next) => {
          if (typeof next !== "string" || next === value) return;
          onAssign(next === NO_OWNER ? null : next);
        }}
      >
        <SelectTrigger size="xs" aria-label={`Owner of “${item.text}”`}>
          <SelectValue>
            {item.owner !== undefined
              ? name(item.owner)
              : leftToTask
                ? "Left to a task"
                : "Needs an owner"}
          </SelectValue>
        </SelectTrigger>
        <SelectPopup>
          {leftToTask ? <SelectItem value={LEFT_TO_TASK}>Left to a task</SelectItem> : null}
          <SelectItem value={NO_OWNER}>No owner</SelectItem>
          {people.map((member) => (
            <SelectItem key={member.email} value={member.email}>
              {member.name}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </div>
  );
}

/** The person's own report, filed or replaced; one check per line. */
function ReportForm({
  initial,
  replacing,
  busy,
  onSave,
  onCancel,
}: {
  readonly initial: ReportDraft;
  readonly replacing: number | undefined;
  readonly busy: boolean;
  readonly onSave: (draft: ReportDraft) => void;
  readonly onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const edit = (field: keyof Omit<ReportDraft, "result">) => (value: string) =>
    setDraft((current) => ({ ...current, [field]: value }));
  const ready = draft.summary.trim() !== "";
  return (
    <form
      aria-label={replacing === undefined ? "File a test report" : "Replace your test report"}
      className="flex max-w-prose flex-col gap-3 border-t border-border/60 pt-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) onSave(draft);
      }}
    >
      <div className="flex flex-wrap gap-3">
        <div className="w-36">
          <PeerStackedField label="Result" htmlFor="test-report-result">
            <Select
              value={draft.result}
              disabled={busy}
              onValueChange={(next) => {
                if (next === "pass" || next === "fail" || next === "mixed")
                  setDraft((current) => ({ ...current, result: next }));
              }}
            >
              <SelectTrigger id="test-report-result" size="sm">
                <SelectValue>{draft.result}</SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {RESULTS.map((result) => (
                  <SelectItem key={result} value={result}>
                    {result}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </PeerStackedField>
        </div>
        <div className="min-w-0 flex-1 basis-60">
          <PeerStackedField label="Summary" htmlFor="test-report-summary">
            <Input
              id="test-report-summary"
              value={draft.summary}
              disabled={busy}
              maxLength={300}
              onChange={(event) => edit("summary")(event.target.value)}
            />
          </PeerStackedField>
        </div>
      </div>
      <Lines
        id="test-report-passed"
        label="Passed"
        hint="One check per line."
        value={draft.passed}
        busy={busy}
        onChange={edit("passed")}
      />
      <Lines
        id="test-report-failed"
        label="Failed"
        hint="One check per line."
        value={draft.failed}
        busy={busy}
        onChange={edit("failed")}
      />
      <Lines
        id="test-report-unverified"
        label="Not verified"
        hint="One per line; end a line with @name to give it an owner."
        value={draft.unverified}
        busy={busy}
        onChange={edit("unverified")}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={busy || !ready}>
          {replacing === undefined ? "File report" : `Replace report ${replacing}`}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Lines({
  id,
  label,
  hint,
  value,
  busy,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly value: string;
  readonly busy: boolean;
  readonly onChange: (value: string) => void;
}) {
  return (
    <PeerStackedField label={label} htmlFor={id} hint={hint}>
      <Textarea
        id={id}
        size="sm"
        value={value}
        disabled={busy}
        onChange={(event) => onChange(event.target.value)}
      />
    </PeerStackedField>
  );
}
