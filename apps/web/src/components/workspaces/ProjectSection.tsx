import type { EnvironmentId, PeerHubStatus } from "@t3tools/contracts";
import { ChevronRightIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ContextRow, TaskRow } from "./TaskRow";
import { ThreadList } from "./ThreadCard";
import type { PeerWebPlugin } from "./slots";
import {
  projectCheckout,
  type ProjectCheckout,
  useOpenWorkspaceProject,
} from "./useOpenWorkspaceProject";
import { reportFailure, type Scope, type WorkActions } from "./useWorkActions";
import type { WorkProjectNode } from "./workTree.logic";

export function ProjectSection({
  environmentId,
  status,
  project,
  plugins,
  showWorkspace,
  activeThread,
  actions,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly project: WorkProjectNode;
  readonly plugins: ReadonlyArray<PeerWebPlugin>;
  readonly showWorkspace: boolean;
  readonly activeThread: string | null;
  readonly actions: WorkActions;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [adding, setAdding] = useState(false);
  const state = status.workspaces
    .find((w) => w.slug === project.workspace)
    ?.projects.find((p) => p.project.id === project.projectId);
  const checkout = state === undefined ? undefined : projectCheckout(state);
  const t3ProjectId = checkout?.projectId;
  const scope = { workspace: project.workspace, projectId: project.projectId };
  const opener = useOpenWorkspaceProject({ environmentId, ...scope, name: project.name });

  return (
    <section aria-label={project.name}>
      <div className="group/project flex items-center gap-1 pr-1">
        <button
          type="button"
          className="flex h-7 min-w-0 flex-1 items-center gap-1 rounded-md px-1 text-left text-xs font-semibold tracking-wide text-sidebar-foreground uppercase hover:bg-sidebar-row-hover"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((value) => !value)}
        >
          <ChevronRightIcon
            className={cn("size-3.5 shrink-0 text-muted-foreground", !collapsed && "rotate-90")}
          />
          <span className="truncate">{project.name}</span>
          {showWorkspace ? (
            <span className="truncate font-normal text-muted-foreground normal-case">
              · {project.workspaceName}
            </span>
          ) : null}
        </button>
        {plugins.map(({ id, projectActions: Actions }) =>
          Actions === undefined ? null : (
            <Actions
              key={id}
              environmentId={environmentId}
              status={status}
              project={project}
              activeThread={activeThread}
            />
          ),
        )}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost-muted"
                aria-label={`Add a task to ${project.name}`}
                onClick={() => {
                  setCollapsed(false);
                  setAdding(true);
                }}
              />
            }
          >
            <PlusIcon className="size-3.5" />
          </TooltipTrigger>
          <TooltipPopup side="top">Add a task</TooltipPopup>
        </Tooltip>
      </div>
      {collapsed ? null : (
        <div className="flex flex-col gap-1 pl-1">
          {adding ? (
            <NewTaskForm
              environmentId={environmentId}
              scope={scope}
              areas={project.areas.flatMap((a) => (a.name === null ? [] : [a.name]))}
              onDone={() => setAdding(false)}
            />
          ) : null}
          {plugins.map(({ id, projectRows: Rows }) =>
            Rows === undefined ? null : (
              <Rows
                key={id}
                environmentId={environmentId}
                status={status}
                project={project}
                activeThread={activeThread}
              />
            ),
          )}
          {checkout !== undefined && checkout.projectId === undefined ? (
            <NotOpenHere
              environmentId={environmentId}
              status={status}
              plugins={plugins}
              checkout={checkout}
              opening={opener.opening}
              onOpen={() => void opener.open()}
            />
          ) : null}
          {project.areas.map((area) => (
            <div key={area.name ?? "—"}>
              <p className="px-2 pt-1.5 pb-0.5 text-xs font-medium text-muted-foreground">
                {area.name ?? "Other tasks"}
              </p>
              {area.tasks.length === 0 ? (
                <p className="px-2 py-0.5 text-xs text-muted-foreground/70">No tasks</p>
              ) : (
                <ul className="flex flex-col gap-px">
                  {area.tasks.map((task) => (
                    <TaskRow
                      key={task.id}
                      environmentId={environmentId}
                      projectState={state}
                      status={status}
                      scope={scope}
                      task={task}
                      tasks={project.tasks}
                      plugins={plugins}
                      t3ProjectId={t3ProjectId}
                      activeThread={activeThread}
                      actions={actions}
                    />
                  ))}
                </ul>
              )}
            </div>
          ))}
          {project.unsorted.some((thread) => thread.mine) || project.context !== undefined ? (
            <div>
              <p className="px-2 pt-1.5 pb-0.5 text-xs font-medium text-muted-foreground">
                Not on a task
              </p>
              <ul className="flex flex-col">
                {project.context === undefined ? null : (
                  <ContextRow
                    context={project.context}
                    label="Shared context"
                    activeThread={activeThread}
                  />
                )}
                <ThreadList
                  scope={scope}
                  threads={project.unsorted}
                  taskId={null}
                  tasks={project.tasks}
                  plugins={plugins}
                  activeThread={activeThread}
                  actions={actions}
                />
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

/**
 * A workspace project not open on this computer: clone and open it, or say
 * why that failed, with GitHub to connect when the account was the reason.
 */
function NotOpenHere({
  environmentId,
  status,
  plugins,
  checkout,
  opening,
  onOpen,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly plugins: ReadonlyArray<PeerWebPlugin>;
  readonly checkout: ProjectCheckout;
  readonly opening: boolean;
  readonly onOpen: () => void;
}) {
  const busy = opening || checkout.cloning;
  const failed = !busy && checkout.errors.length > 0;
  return (
    <div className="flex flex-col gap-1.5 px-2 py-1">
      <div className="flex items-start gap-2 text-xs text-muted-foreground">
        <span className={cn("min-w-0 flex-1", failed && "text-destructive")}>
          {failed
            ? checkout.errors.join(" ")
            : checkout.missing
              ? "Not on this computer yet."
              : "On this computer, not open yet."}
        </span>
        <Button size="xs" variant="outline" disabled={busy} onClick={onOpen}>
          {busy
            ? checkout.missing
              ? "Cloning…"
              : "Opening…"
            : failed
              ? "Try again"
              : checkout.missing
                ? "Clone & open"
                : "Open"}
        </Button>
      </div>
      {plugins.map(({ id, notOpenHere: Fix }) =>
        Fix === undefined ? null : (
          <Fix
            key={id}
            environmentId={environmentId}
            status={status}
            checkout={checkout}
            failed={failed}
            onRetry={onOpen}
          />
        ),
      )}
    </div>
  );
}

function NewTaskForm({
  environmentId,
  scope,
  areas,
  onDone,
}: {
  readonly environmentId: EnvironmentId;
  readonly scope: Scope;
  readonly areas: ReadonlyArray<string>;
  readonly onDone: () => void;
}) {
  const createTask = useAtomCommand(serverEnvironment.peerHubCreateTask, { reportFailure: false });
  const [title, setTitle] = useState("");
  const [key, setKey] = useState("");
  const [area, setArea] = useState(areas[0] ?? "");
  const [busy, setBusy] = useState(false);
  const listId = `peer-areas-${scope.workspace}-${scope.projectId}`;
  return (
    <form
      className="flex flex-col gap-1.5 rounded-md border border-sidebar-border p-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy || title.trim() === "") return;
        setBusy(true);
        void createTask({
          environmentId,
          input: {
            ...scope,
            title: title.trim(),
            ...(key.trim() === "" ? {} : { key: key.trim() }),
            ...(area.trim() === "" ? {} : { area: area.trim() }),
          },
        })
          .then((result) => {
            if (reportFailure("Could not add the task", result)) onDone();
          })
          .finally(() => setBusy(false));
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onDone();
      }}
    >
      <Input
        size="sm"
        nativeInput
        autoFocus
        placeholder="Task, e.g. Split Payments"
        aria-label="Task title"
        value={title}
        readOnly={busy}
        onChange={(event) => setTitle(event.currentTarget.value)}
      />
      <div className="flex gap-1.5">
        <Input
          className="w-24"
          size="sm"
          nativeInput
          placeholder="KRK-812"
          aria-label="Tracker key (optional)"
          value={key}
          readOnly={busy}
          onChange={(event) => setKey(event.currentTarget.value)}
        />
        <Input
          className="min-w-0 flex-1"
          size="sm"
          nativeInput
          placeholder="Area"
          aria-label="Area"
          list={listId}
          value={area}
          readOnly={busy}
          onChange={(event) => setArea(event.currentTarget.value)}
        />
        <datalist id={listId}>
          {areas.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </div>
      <div className="flex justify-end gap-1">
        <Button type="button" size="xs" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="xs" disabled={busy || title.trim() === ""}>
          {busy ? "Adding…" : "Add task"}
        </Button>
      </div>
    </form>
  );
}
