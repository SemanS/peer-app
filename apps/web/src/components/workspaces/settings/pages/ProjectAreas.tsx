import { useEffect, useId, useRef, useState } from "react";

import { serverEnvironment } from "../../../../state/server";
import { useAtomCommand } from "../../../../state/use-atom-command";
import { stackedThreadToast, toastManager } from "../../../ui/toast";
import { failureMessage } from "../../WorkspaceAccess";
import { DraftSaveBar } from "../DraftBar";
import type { ProjectPageProps } from "../pageProps";
import { AreaList, DeleteAreaPanel } from "../ProjectAreasParts";
import {
  addArea,
  adoptArea,
  areaRows,
  areasOf,
  areasValue,
  failureSummary,
  moveNotes,
  removeArea,
  renameArea,
  reorderAreas,
  tasksToMove,
  type AreaMove,
  type AreasEdit,
  type FailedMove,
} from "../projectAreas.logic";
import { SettingsUnavailableNote } from "../SettingsUnavailable";
import { useSettingsDraft, type SettingsDraft } from "../useSettingsDraft";
import { useSettingsView } from "../useSettingsView";

const NO_MOVES: ReadonlyArray<AreaMove> = [];

/**
 * A project's Areas tab: the parts of the product its tasks sit under, in the order the sidebar and
 * the board list them. Leads and admins reorder them, rename, delete, add and adopt the ones only
 * tasks name; everyone else reads them, with the owners named. Without the settings feature on the
 * Hub the list is the manifest's, read-only.
 *
 * Tasks name their area by its text, so renaming or deleting an area moves its tasks. Those moves
 * are kept beside the draft and made after the list is saved, one task update each (the update the
 * Work menus use). A move that fails leaves its task in the old area, which then shows under
 * "from a task" with its tasks, ready to be moved again or added back; the failure is reported once.
 */
export function ProjectAreas({ environmentId, workspace, state }: ProjectPageProps) {
  const { project } = state;
  const view = useSettingsView(workspace.slug);
  const draft = useSettingsDraft(view, { slice: ["projects", project.id] });
  const updateTask = useAtomCommand(serverEnvironment.peerHubUpdateTask, { reportFailure: false });
  const headingId = useId();
  const [moves, setMoves] = useState<ReadonlyArray<AreaMove>>(NO_MOVES);
  const [running, setRunning] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const tasks = state.work.tasks;
  // The review saves long after this render; the moves it triggers read the tasks as they are then.
  const latest = useRef({ tasks, moves });
  useEffect(() => {
    latest.current = { tasks, moves };
  });

  const areasPath = ["projects", project.id, "areas"];
  // The document has the project once it is read; until then, and without the settings feature,
  // the page shows the manifest's areas and nothing can be changed.
  const inDocument = draft.value !== undefined;
  const areas = inDocument ? areasOf(draft.get(["areas"])) : state.work.areas;
  const mayChange = view.hubHasSettings && inDocument && view.canChange(areasPath);
  // A draft that is back to what is saved has nothing to move; one just saved still has its moves
  // to make, and keeps showing the tasks where they are going.
  const pending = running || draft.dirty > 0 ? moves : NO_MOVES;
  const rows = areaRows(areas, tasks, pending);

  const apply = (next: AreasEdit) => {
    draft.set(["areas"], areasValue(next.areas));
    setMoves(next.moves);
  };
  const edit: AreasEdit = { areas, moves: pending };

  const moveTasks = async () => {
    const planned = tasksToMove(latest.current.tasks, latest.current.moves);
    if (planned.length > 0) {
      setRunning(true);
      const failed: FailedMove[] = [];
      for (const move of planned) {
        const result = await updateTask({
          environmentId,
          input: {
            workspace: workspace.slug,
            projectId: project.id,
            taskId: move.taskId,
            area: move.area,
          },
        });
        const message = failureMessage(result);
        if (message !== null) failed.push({ label: move.label, from: move.from, message });
      }
      if (failed.length > 0) {
        toastManager.add(
          stackedThreadToast({ type: "error", ...failureSummary(failed, planned.length) }),
        );
      }
    }
    setMoves(NO_MOVES);
    setRunning(false);
  };

  // The bar saves through these: the moves wait for the save, and go when the draft goes.
  const saveDraft = {
    dirty: draft.dirty,
    stale: draft.stale,
    operation: draft.operation,
    discard: () => {
      draft.discard();
      setMoves(NO_MOVES);
      setDeleting(null);
    },
    saved: ((saved, outcome) => {
      draft.saved(saved, outcome);
      setDeleting(null);
      // Changes given up for what others saved are not the list now: nothing moves for them.
      if (outcome?.dropped === true) setMoves(NO_MOVES);
      else void moveTasks();
    }) satisfies SettingsDraft["saved"],
  };

  const removing = deleting === null ? undefined : rows.listed.find((row) => row.name === deleting);
  return (
    <>
      <section aria-labelledby={headingId} className="flex max-w-2xl flex-col gap-2.5">
        <h2 id={headingId} className="text-sm font-semibold text-foreground">
          Areas
        </h2>
        <p className="text-sm text-muted-foreground">
          They group {project.name}’s tasks in the sidebar and on the board, in this order.
        </p>
        {!view.hubHasSettings ? (
          <SettingsUnavailableNote />
        ) : inDocument && !mayChange ? (
          <p role="status" className="text-sm text-muted-foreground">
            {view.ownersOf(areasPath)} change this.
          </p>
        ) : null}
        {view.error === null ? null : (
          <p role="alert" className="text-sm text-destructive-foreground">
            {view.error}
          </p>
        )}
        <AreaList
          rows={rows}
          editable={mayChange}
          busy={running}
          onReorder={(name, over) =>
            apply({ areas: reorderAreas(areas, name, over), moves: pending })
          }
          onRename={(from, to) => apply(renameArea(edit, from, to))}
          onDelete={setDeleting}
          onAdopt={(name) => apply(adoptArea(edit, name))}
          onAdd={(name) => apply(addArea(edit, name))}
        />
        {running ? (
          <p role="status" className="text-sm text-muted-foreground">
            Moving tasks…
          </p>
        ) : null}
        {removing === undefined || !mayChange || running ? null : (
          <DeleteAreaPanel
            key={removing.name}
            name={removing.name}
            tasks={removing.tasks}
            targets={areas.filter((name) => name !== removing.name)}
            onConfirm={(to) => {
              apply(removeArea(edit, removing.name, to));
              setDeleting(null);
            }}
            onCancel={() => setDeleting(null)}
          />
        )}
        <p className="text-xs text-muted-foreground">Every task’s menu has Move to area.</p>
      </section>
      <DraftSaveBar
        draft={saveDraft}
        scope={project.name}
        label={`${project.name} · Areas`}
        notes={moveNotes(tasks, pending)}
      />
    </>
  );
}
