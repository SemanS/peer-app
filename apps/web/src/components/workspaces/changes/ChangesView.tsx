import {
  changeIdParts,
  changeInspector,
  changeRowModel,
  changesPage,
  scopeRows,
  type ChangesScope,
  type MineInput,
} from "@t3tools/client-runtime/peer/changes";
import { useNavigate } from "@tanstack/react-router";
import { HistoryIcon } from "lucide-react";
import { useState } from "react";

import { PullRequestGlyph } from "../../pullRequest/pullRequestIcons";
import { useClientSettings } from "../../../hooks/useSettings";
import { formatShortTimestamp } from "../../../timestampFormat";
import { useRelativeTimeTick } from "../../settings/settingsLayout";
import { Button } from "../../ui/button";
import { SidebarInset } from "../../ui/sidebar";
import { Toggle, ToggleGroup } from "../../ui/toggle-group";
import { PeerCallout } from "../PeerDialog";
import { PeerPageHeader } from "../PeerPageHeader";
import { useWorkData } from "../useWorkData";
import { ChangeGraph, type LandedRowModel } from "./ChangeGraph";
import { ChangeInspector } from "./ChangeInspector";
import { ChangesNote, GitByBranch, TwoVersionsCard } from "./ChangesStates";
import {
  awaitingReviewIds,
  gitTeammates,
  landedRow,
  selectedId,
  taskOfChange,
} from "./changes.logic";
import { Legend } from "./Legend";
import { useProjectChanges } from "./useProjectChanges";

const SCOPES: ReadonlyArray<{ readonly id: ChangesScope; readonly label: string }> = [
  { id: "everyone", label: "Everyone" },
  { id: "mine", label: "Mine" },
];

const SCOPE_NOTE: Readonly<Record<ChangesScope, string>> = {
  everyone: "Every person's agents in this project",
  mine: "Highlights what you run, own or review",
};

/**
 * Everyone's changes in flight as one graph: who works where, what waits for the person, and the
 * inspector of the selected change. The page says what it cannot show (jj missing or too old, a
 * Hub that predates changes, nothing in flight, a failed read) instead of drawing an empty graph.
 */
export function ChangesView({
  workspace,
  project,
}: {
  readonly workspace: string;
  readonly project: string;
}) {
  const { environmentId, status, plugins, tree } = useWorkData();
  const navigate = useNavigate();
  const now = useRelativeTimeTick(30_000);
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const clock = (at: string) => formatShortTimestamp(at, timestampFormat);
  const [scope, setScope] = useState<ChangesScope>("everyone");
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const live = useProjectChanges({ environmentId, workspace, project });

  const node = tree.find((entry) => entry.workspace === workspace && entry.projectId === project);
  const state = status?.workspaces
    .find((entry) => entry.slug === workspace)
    ?.projects.find((entry) => entry.project.id === project);
  const me = status?.email ?? null;
  const base = {
    project,
    now,
    me,
    jujutsu: status?.jujutsu,
    hubSupport: status?.changes?.hubSupport,
    view: live.view,
    gitTeammates: gitTeammates(node),
  };
  const page =
    live.error !== null && live.view === undefined
      ? ({
          kind: "failed",
          title: "Could not read the changes",
          message: live.error,
          footnote: "The page reads them again when the connection is back.",
        } as const)
      : changesPage(base);

  const view = live.view;
  const ready = page.kind === "ready" && view !== undefined ? { page, view } : undefined;
  const context: MineInput & { readonly now: number } = {
    me,
    now,
    marks: view?.marks ?? [],
    awaitingReview: awaitingReviewIds(node, view?.changes ?? [], me),
  };
  const ids = ready?.view.changes.map((row) => row.changeId) ?? [];
  const models = new Map(
    (ready?.view.changes ?? []).map((row) => [
      row.changeId,
      changeRowModel(row, ready?.view.changes ?? [], context),
    ]),
  );
  const landed: LandedRowModel | undefined =
    ready?.view.landed === undefined
      ? undefined
      : (() => {
          const words = landedRow(ready.view.landed, now);
          return {
            landed: ready.view.landed,
            id: changeIdParts(ready.view.landed.changeId, [...ids, ready.view.landed.changeId]),
            ...words,
          };
        })();
  const selected = ready === undefined ? undefined : selectedId(ready.page.graph.rows, picked);
  const selectedRow = ready?.view.changes.find((row) => row.changeId === selected);
  const inspector =
    selectedRow === undefined || ready === undefined
      ? undefined
      : changeInspector(selectedRow, ready.view.changes, context);
  const selectedTask = selectedRow === undefined ? undefined : taskOfChange(node, selectedRow);
  const startAgent = () => void navigate({ to: "/work" });
  const hasForecast = plugins.some((plugin) => plugin.id === "forecast");
  const hasJujutsu = plugins.some((plugin) => plugin.id === "jujutsu");

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <PeerPageHeader
          project={{
            name: node?.name ?? state?.project.name ?? project,
            colorKey: `${workspace}/${project}`,
          }}
          page="Changes"
          actions={
            hasForecast || hasJujutsu ? (
              <>
                {hasJujutsu ? (
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => void navigate({ href: `/operations/${workspace}/${project}` })}
                  >
                    <HistoryIcon aria-hidden />
                    Operations
                  </Button>
                ) : null}
                {hasForecast ? (
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => void navigate({ href: `/integration/${workspace}/${project}` })}
                  >
                    <PullRequestGlyph.merged aria-hidden />
                    Integration preview
                  </Button>
                ) : null}
              </>
            ) : undefined
          }
        />
        <div className="min-h-0 flex-1 overflow-y-auto">
          {status === null || environmentId === null ? (
            <p role="status" className="px-6 py-6 text-sm text-muted-foreground">
              Connecting…
            </p>
          ) : ready === undefined ? (
            <div className="flex flex-col items-start gap-4 px-4 py-6 sm:px-7">
              {page.kind === "ready" ? null : <ChangesNote page={page} onStart={startAgent} />}
            </div>
          ) : (
            <div className="flex flex-col gap-4 px-4 py-5 sm:px-7">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <ToggleGroup
                  aria-label="Show"
                  value={[scope]}
                  onValueChange={(next) => {
                    const value = SCOPES.find((candidate) => candidate.id === next[0]);
                    if (value !== undefined) setScope(value.id);
                  }}
                >
                  {SCOPES.map((candidate) => (
                    <Toggle key={candidate.id} value={candidate.id}>
                      {candidate.label}
                    </Toggle>
                  ))}
                </ToggleGroup>
                <span className="text-sm text-muted-foreground">{SCOPE_NOTE[scope]}</span>
                <span className="ml-auto text-sm text-muted-foreground">{ready.page.summary}</span>
              </div>

              {ready.page.problems.map((problem) => (
                <PeerCallout
                  key={problem.workspace}
                  tone="needs"
                  label={`jj failed in ${problem.workspace}`}
                >
                  <code className="font-mono text-xs break-words">{problem.message}</code>
                  <p className="mt-1 text-muted-foreground">
                    Peer retries at the agent's next tool step.
                  </p>
                </PeerCallout>
              ))}

              {ready.page.twoVersions.map((two) => (
                <TwoVersionsCard
                  key={two.changeId}
                  title={two.title}
                  versionIds={two.versionIds}
                  onShow={() => setPicked(two.changeId)}
                />
              ))}

              <div className="flex flex-wrap items-start gap-6">
                <section className="flex min-w-0 flex-[999_1_32rem] flex-col gap-3">
                  <ChangeGraph
                    graph={ready.page.graph}
                    scoped={scopeRows(ready.page.graph, scope, context)}
                    models={models}
                    landed={landed}
                    selected={selected}
                    onSelect={setPicked}
                  />
                  <GitByBranch rows={ready.page.byBranch} />
                  <Legend />
                </section>
                <div className="flex min-w-0 flex-[1_1_20rem] flex-col">
                  <ChangeInspector
                    model={inspector}
                    idParts={
                      selectedRow === undefined
                        ? undefined
                        : changeIdParts(selectedRow.changeId, ids)
                    }
                    row={selectedRow}
                    landed={
                      landed !== undefined && selected === landed.landed.changeId
                        ? { row: landed, change: landed.landed }
                        : undefined
                    }
                    mine={
                      selectedRow !== undefined &&
                      me !== null &&
                      selectedRow.author.email.toLowerCase() === me.toLowerCase()
                    }
                    taskId={selectedTask?.id}
                    plugins={plugins}
                    slot={{ environmentId, status, workspace, project: state }}
                    clock={clock}
                    canReview={selectedTask !== undefined}
                    onReview={() => {
                      if (selectedTask === undefined) return;
                      void navigate({
                        to: "/review/$workspace/$project/$task",
                        params: { workspace, project, task: selectedTask.id },
                      });
                    }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </SidebarInset>
  );
}
