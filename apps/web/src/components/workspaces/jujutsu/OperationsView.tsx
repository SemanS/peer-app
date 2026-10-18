import { useAtomValue } from "@effect/atom-react";
import { groupOperations } from "@t3tools/client-runtime/peer/jujutsu";
import type { UndoPreview } from "@t3tools/contracts";
import { EyeIcon, Undo2Icon } from "lucide-react";
import { useState } from "react";

import { usePrimaryEnvironment } from "../../../state/environments";
import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { Button } from "../../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../../ui/select";
import { SidebarInset } from "../../ui/sidebar";
import { PeerCallout } from "../PeerDialog";
import { PeerCard, PeerPageHeader } from "../PeerPageHeader";
import { failureMessage, usePeerHubStatus } from "../WorkspaceAccess";
import { personName } from "../workTree.logic";
import { AtOpDialog, type AtOpTarget } from "./AtOpDialog";
import {
  filterChoices,
  filterValue,
  NOTHING_FOR_FILTER,
  operationRows,
  operationsAsked,
  operationsPage,
  undoDialogView,
  undoSummary,
  visibleGroups,
  youOf,
  type OperationRowView,
} from "./operations.logic";
import { UndoDialog } from "./UndoDialog";

interface Undoing {
  readonly operation: string;
  readonly description: string;
  readonly preview: UndoPreview | null;
  readonly error: string | null;
  readonly busy: boolean;
}

/**
 * This computer's operation log for one project, as jj keeps it: who took each step, what it did
 * and which command ran, with undo for one step and a read-only look at the repository as it was.
 * It reads the repository of the computer it runs on; another computer's log stays there.
 */
export function OperationsView({
  workspace,
  project,
}: {
  readonly workspace: string;
  readonly project: string;
}) {
  const primary = usePrimaryEnvironment();
  const environmentId =
    primary !== null && primary.connection.phase === "connected" ? primary.environmentId : null;
  const status = usePeerHubStatus(environmentId);
  const state = status?.workspaces
    .find((candidate) => candidate.slug === workspace)
    ?.projects.find((candidate) => candidate.project.id === project);
  const unasked = operationsPage({
    project: state,
    state: status?.jujutsu,
    read: { loaded: true, error: null, count: 1 },
  });
  const list = useEnvironmentQuery(
    environmentId === null || !operationsAsked(unasked.kind)
      ? null
      : serverEnvironment.peerJujutsuOperations({
          environmentId,
          input: { workspace, project },
        }),
  );
  const operations = list.data?.operations ?? [];
  const page = operationsPage({
    project: state,
    state: status?.jujutsu,
    read: { loaded: list.data !== null, error: list.error, count: operations.length },
  });
  const groups = groupOperations(operations);
  const choices = filterChoices(operations);
  const [filter, setFilter] = useState("all");
  const chosen = filterValue(filter, choices);
  const you = youOf(status?.email ?? null);
  const rows = operationRows(visibleGroups(groups, chosen), { you });
  const canUndo = useAtomValue(serverEnvironment.peerJujutsuUndo.permissionAtom(environmentId));
  const previewUndo = useAtomCommand(serverEnvironment.peerJujutsuPreviewUndo, {
    reportFailure: false,
  });
  const undo = useAtomCommand(serverEnvironment.peerJujutsuUndo, { reportFailure: false });
  const [undoing, setUndoing] = useState<Undoing | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [looking, setLooking] = useState<{
    readonly target: AtOpTarget;
    readonly which: "after" | "before";
  } | null>(null);

  const owner =
    state === undefined || status === null || status.email === null
      ? "this computer"
      : `${personName(state, status.email)}'s computer`;

  const startUndo = (row: NonNullable<OperationRowView["undo"]>) => {
    if (environmentId === null) return;
    setSummary(null);
    setUndoing({ ...row, preview: null, error: null, busy: false });
    void previewUndo({
      environmentId,
      input: { workspace, project, operation: row.operation },
    }).then((result) => {
      const failure = failureMessage(result);
      setUndoing((current) => {
        if (current === null || current.operation !== row.operation) return current;
        if (failure !== null) return { ...current, error: failure };
        return result._tag === "Success" ? { ...current, preview: result.value } : current;
      });
    });
  };

  const confirmUndo = () => {
    if (environmentId === null || undoing === null || undoing.busy) return;
    const { operation, description } = undoing;
    setUndoing({ ...undoing, busy: true, error: null });
    void undo({ environmentId, input: { workspace, project, operation } }).then((result) => {
      const failure = failureMessage(result);
      if (failure !== null || result._tag !== "Success") {
        setUndoing((current) =>
          current === null
            ? current
            : { ...current, busy: false, error: failure ?? "The step was not undone." },
        );
        return;
      }
      setUndoing(null);
      setSummary(undoSummary(result.value, description));
      list.refresh();
    });
  };

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <PeerPageHeader
          project={
            state === undefined
              ? undefined
              : { name: state.project.name, colorKey: `${workspace}/${project}` }
          }
          page="Operations"
          actions={
            page.kind === "ready" || choices.length > 1 ? (
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                Show
                <Select
                  value={chosen}
                  items={choices}
                  onValueChange={(value) => {
                    if (value !== null) setFilter(value);
                  }}
                >
                  <SelectTrigger aria-label="Show" className="min-w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup>
                    {choices.map((choice) => (
                      <SelectItem key={choice.value} value={choice.value}>
                        {choice.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </label>
            ) : undefined
          }
        />
        <div className="min-h-0 flex-1 scrollbar-gutter-both overflow-y-auto">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-6">
            <div className="flex flex-col gap-1.5">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                Operations on {owner}
              </h1>
              <p className="max-w-3xl text-sm text-muted-foreground">
                Every step in this repository, from jj's operation log. Each agent, and Peer itself,
                writes under its own name, so one step can be undone without touching the rest.
              </p>
            </div>
            {summary === null ? null : (
              <div role="status">
                <PeerCallout tone="delivery">{summary}</PeerCallout>
              </div>
            )}
            <Body
              page={page}
              rows={rows}
              canUndo={canUndo}
              onRetry={list.refresh}
              onUndo={startUndo}
              onLook={(row) => {
                const operation = groups.find((group) => group.id === row.id)?.operations[0];
                setLooking({
                  target: {
                    description: operation?.description ?? row.title,
                    after: row.view.after,
                    before: row.view.before,
                  },
                  which: "after",
                });
              }}
            />
            {page.kind === "ready" ? (
              <p className="text-xs text-muted-foreground">
                Each computer keeps its own operation log. A teammate's steps live on their
                computer; here they arrive as Peer's fetches.
              </p>
            ) : null}
          </div>
        </div>
      </div>
      {undoing === null ? null : (
        <UndoDialog
          view={undoing.preview === null ? null : undoDialogView(undoing.preview, { you })}
          loading={undoing.preview === null && undoing.error === null}
          error={undoing.error}
          busy={undoing.busy}
          onConfirm={confirmUndo}
          onClose={() => setUndoing(null)}
        />
      )}
      {looking === null || environmentId === null ? null : (
        <AtOpDialog
          environmentId={environmentId}
          workspace={workspace}
          project={project}
          target={looking.target}
          which={looking.which}
          onWhichChange={(which) => setLooking({ ...looking, which })}
          onClose={() => setLooking(null)}
        />
      )}
    </SidebarInset>
  );
}

function Body({
  page,
  rows,
  canUndo,
  onRetry,
  onUndo,
  onLook,
}: {
  readonly page: ReturnType<typeof operationsPage>;
  readonly rows: ReadonlyArray<OperationRowView>;
  readonly canUndo: boolean;
  readonly onRetry: () => void;
  readonly onUndo: (row: NonNullable<OperationRowView["undo"]>) => void;
  readonly onLook: (row: OperationRowView) => void;
}) {
  switch (page.kind) {
    case "unknown":
      return (
        <p role="status" className="text-sm text-muted-foreground">
          This project is not in your workspaces, so there is no checkout here to read.
        </p>
      );
    case "git":
      return (
        <PeerCard aria-label="Needs a Jujutsu checkout">
          <h2 className="text-sm font-medium text-foreground">
            Operations needs a Jujutsu checkout
          </h2>
          <p className="text-sm text-muted-foreground">
            This project's checkout on this computer is Git, which keeps no operation log. Git
            projects are not affected; the page reads a colocated jj repository.
          </p>
        </PeerCard>
      );
    case "problem":
      return (
        <PeerCard aria-label={page.note.title}>
          <h2 className="text-sm font-medium text-foreground">{page.note.title}</h2>
          <p className="text-sm text-muted-foreground">{page.note.body}</p>
          <code className="w-fit rounded-md border border-border bg-muted/40 px-2 py-1 font-mono text-xs text-foreground">
            {page.note.fix}
          </code>
        </PeerCard>
      );
    case "loading":
      return (
        <p role="status" className="text-sm text-muted-foreground">
          Reading the operation log on this computer…
        </p>
      );
    case "failed":
      return (
        <PeerCard aria-label="The log could not be read">
          <p role="alert" className="text-sm text-destructive-foreground">
            {page.message}
          </p>
          <Button size="sm" variant="outline" className="w-fit" onClick={onRetry}>
            Try again
          </Button>
        </PeerCard>
      );
    case "empty":
      return (
        <p className="text-sm text-muted-foreground">
          No steps yet. They show here as agents work in this repository.
        </p>
      );
    case "ready":
      return rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{NOTHING_FOR_FILTER}</p>
      ) : (
        <ol
          aria-label="Operations, newest first"
          className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-card"
        >
          {rows.map((row) => (
            <li
              key={row.id}
              className="grid gap-x-4 gap-y-2 px-4 py-3.5 md:grid-cols-[4.5rem_14rem_minmax(0,1fr)_auto]"
            >
              <span className="pt-0.5 font-mono text-xs text-muted-foreground">{row.time}</span>
              <span className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden
                  className="flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-2xs font-semibold text-foreground"
                >
                  {row.actor.initial}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {row.actor.label}
                  </span>
                  <span className="block truncate font-mono text-xs text-muted-foreground">
                    {row.actor.detail}
                  </span>
                </span>
              </span>
              <span className="flex min-w-0 flex-col gap-1">
                <span className="text-sm font-medium text-foreground">{row.title}</span>
                <span className="font-mono text-xs break-words text-muted-foreground">
                  {row.commands}
                </span>
                {row.note === null ? null : (
                  <span className="text-xs text-muted-foreground">{row.note}</span>
                )}
              </span>
              <span className="flex items-start gap-1.5">
                <Button
                  size="icon-sm"
                  variant="outline"
                  aria-label="See the repository as it was after this step"
                  onClick={() => onLook(row)}
                >
                  <EyeIcon />
                </Button>
                {row.undo !== null && canUndo ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (row.undo !== null) onUndo(row.undo);
                    }}
                  >
                    <Undo2Icon />
                    Undo this step…
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
        </ol>
      );
  }
}
