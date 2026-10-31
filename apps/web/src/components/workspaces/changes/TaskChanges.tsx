import { taskStack, type TaskStackEntry } from "@t3tools/client-runtime/peer/changes";
import { jujutsuProblem } from "@t3tools/client-runtime/peer/jujutsu";
import { inactivePluginReason } from "@t3tools/client-runtime/peer/plugins";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { PullRequestGlyph } from "../../pullRequest/pullRequestIcons";
import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { withFinally } from "~/lib/withFinally";
import { useRelativeTimeTick } from "../../settings/settingsLayout";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../../ui/alert-dialog";
import { Button } from "../../ui/button";
import { PeerSectionLabel } from "../PeerPageHeader";
import type { TaskSlotProps } from "../slots.types";
import { failureMessage } from "../WorkspaceAccess";
import { ChangeId } from "./ChangeGraph";
import { ShapeIcon } from "./ChangeShape";
import { StateCard } from "./ChangesStates";
import {
  buildsOnText,
  changeName,
  followSession,
  landingText,
  movedModel,
  stackLine,
  stopTarget,
} from "./taskChanges.logic";
import { keyedLines } from "./changeReview.logic";
import { useProjectChanges } from "./useProjectChanges";
import { changeIdParts } from "@t3tools/client-runtime/peer/changes";

function StackRow({
  line,
  last,
}: {
  readonly line: ReturnType<typeof stackLine>;
  readonly last: boolean;
}) {
  return (
    <li
      className={
        "relative flex flex-col gap-0.5 py-2 pl-9 before:absolute before:top-0 before:left-3 before:w-0.5 before:bg-border " +
        (last ? "before:h-1/2" : "before:h-full")
      }
    >
      <ShapeIcon shape={line.shape} className="absolute top-1/2 left-1 size-4.5 -translate-y-1/2" />
      <span className="flex min-w-0 items-center gap-2">
        <ChangeId pre={line.pre} rest={line.rest} />
        <span className="min-w-0 truncate text-sm font-semibold text-foreground">
          {line.subject}
        </span>
      </span>
      <span className="text-xs text-muted-foreground">{line.detail}</span>
    </li>
  );
}

/**
 * The task's changes on its page: the stack in jj's shapes down to trunk, who may touch each, what
 * moved under the task, and how it lands. It speaks for Jujutsu projects only; a Git project's task
 * has no change to show. Setup problems are said with their fix, as on the Changes page.
 */
export function TaskChanges({
  environmentId,
  status,
  workspace,
  project,
  task,
  onJujutsu = false,
}: TaskSlotProps) {
  const projectId = project?.project.id;
  const now = useRelativeTimeTick(30_000);
  const jj = onJujutsu || task.threads.some((thread) => thread.vcs === "jj");
  // A Git project's task has no change to read, so it asks the environment for none.
  const live = useProjectChanges({
    environmentId: projectId === undefined || !jj ? null : environmentId,
    workspace,
    project: projectId ?? "",
  });
  if (projectId === undefined) return null;
  const name = task.key ?? task.id;
  const stack =
    live.view === undefined
      ? undefined
      : taskStack(live.view, name, { me: status.email ?? null, now });
  if (!jj && (stack === undefined || stack.entries.length === 0)) return null;

  const problem = jujutsuProblem(status.jujutsu, projectId);
  return (
    <section aria-labelledby="task-changes" className="flex flex-col gap-2.5">
      <h2 id="task-changes" className="contents">
        <PeerSectionLabel>Changes</PeerSectionLabel>
      </h2>
      {problem !== null ? (
        <StateCard title={problem.title} word={problem.word} tone="warning">
          <p className="text-sm text-muted-foreground">{problem.body}</p>
          <code className="w-fit rounded-md border border-border bg-muted/50 px-2.5 py-1.5 font-mono text-xs text-foreground select-all">
            {problem.fix}
          </code>
        </StateCard>
      ) : stack === undefined ? (
        <p role="status" className="text-sm text-muted-foreground">
          {live.error ?? "Reading the changes of this project…"}
        </p>
      ) : stack.entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No change reports {name} yet. Its change shows here once an agent has worked in it.
        </p>
      ) : (
        <StackBody
          environmentId={environmentId}
          status={status}
          workspace={workspace}
          project={projectId}
          task={task}
          name={name}
          stack={stack}
        />
      )}
    </section>
  );
}

function StackBody({
  environmentId,
  status,
  workspace,
  project,
  task,
  name,
  stack,
}: Pick<TaskSlotProps, "environmentId" | "status" | "workspace" | "task"> & {
  readonly project: string;
  readonly name: string;
  readonly stack: ReturnType<typeof taskStack>;
}) {
  const navigate = useNavigate();
  const ids = stack.entries.map((entry) => entry.change.changeId);
  const target = stopTarget(stack);
  const landed = stack.landed;
  const forecast = inactivePluginReason(status, "forecast") === null;
  const lines = stack.entries.map((entry) => stackLine(entry, ids));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col rounded-xl border border-border bg-card px-3 pt-1">
        <ul aria-label="The task's stack">
          {lines.map((line, index) => (
            <StackRow
              key={line.changeId}
              line={line}
              last={landed === undefined && index === lines.length - 1}
            />
          ))}
          {landed === undefined ? null : (
            <li className="relative flex flex-col gap-0.5 py-2 pl-9 before:absolute before:top-0 before:left-3 before:h-1/2 before:w-0.5 before:bg-border">
              <ShapeIcon
                shape="diamond"
                className="absolute top-1/2 left-1 size-4.5 -translate-y-1/2"
              />
              <span className="flex min-w-0 items-center gap-2">
                <ChangeId {...changeIdParts(landed.changeId, [...ids, landed.changeId])} />
                <span className="font-mono text-xs text-muted-foreground">
                  {landed.bookmark.split("@")[0]}
                </span>
                <span className="min-w-0 truncate text-sm text-foreground">
                  {landed.subject}, landed
                </span>
              </span>
            </li>
          )}
        </ul>
        {target === undefined ? null : (
          <div className="-mx-3 mt-1 flex flex-wrap items-center gap-3 border-t border-border px-3 py-2.5">
            <p className="min-w-0 flex-[1_1_20rem] text-xs text-muted-foreground">
              {buildsOnText(target)}
            </p>
            <StopBuilding
              environmentId={environmentId}
              workspace={workspace}
              project={project}
              task={task}
              target={target}
            />
          </div>
        )}
      </div>

      {target === undefined ? null : (
        <Moved
          environmentId={environmentId}
          workspace={workspace}
          project={project}
          target={target}
        />
      )}

      <div className="flex flex-col gap-2.5">
        <PeerSectionLabel>Landing</PeerSectionLabel>
        <div className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
          {target === undefined ? null : (
            <div className="flex gap-3 px-4 py-3">
              <PullRequestGlyph.stack
                aria-hidden
                className="mt-0.5 size-4.5 shrink-0 text-muted-foreground"
              />
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-semibold text-foreground">
                  {landingText(target, name).title}
                </span>
                <span className="text-sm text-muted-foreground">
                  {landingText(target, name).body}
                </span>
              </div>
            </div>
          )}
          {forecast ? (
            <div className="flex flex-wrap items-center gap-3 px-4 py-3">
              <PullRequestGlyph.merged
                aria-hidden
                className="size-4.5 shrink-0 text-muted-foreground"
              />
              <div className="flex min-w-0 flex-[1_1_16rem] flex-col gap-0.5">
                <span className="text-sm font-semibold text-foreground">
                  Whether it still works with the other changes
                </span>
                <span className="text-sm text-muted-foreground">
                  Merge checks run on the integration preview, as advice. They never stop a push.
                </span>
              </div>
              <Button
                size="xs"
                variant="outline"
                onClick={() => void navigate({ href: `/integration/${workspace}/${project}` })}
              >
                Integration preview
              </Button>
            </div>
          ) : (
            <p className="px-4 py-3 text-sm text-muted-foreground">
              Turn on Merge conflict forecast to check whether it still works with the other
              changes.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** What moved under the task: the lines of the change it builds on, since the version it built on. */
function Moved({
  environmentId,
  workspace,
  project,
  target,
}: {
  readonly environmentId: TaskSlotProps["environmentId"];
  readonly workspace: string;
  readonly project: string;
  readonly target: TaskStackEntry;
}) {
  // What moved is the teammate's newest step, so the diff starts at the version before it rather
  // than at a review mark the task's person never made on that change.
  const previous = target.change.versions.at(-2)?.commit;
  const diff = useEnvironmentQuery(
    serverEnvironment.peerChangesReviewDiff({
      environmentId,
      input: {
        workspace,
        project,
        changeId: target.change.changeId,
        mode: "since",
        ...(previous === undefined ? {} : { from: previous }),
      },
    }),
  );
  const model = diff.data === null ? undefined : movedModel(diff.data, target);
  return (
    <section aria-labelledby="task-moved" className="flex flex-col gap-2.5">
      <h2 id="task-moved" className="contents">
        <PeerSectionLabel>What moved under you</PeerSectionLabel>
      </h2>
      <div className="flex flex-col gap-2 rounded-xl border border-border bg-card px-4 py-3">
        {model === undefined ? (
          <p role="status" className="text-sm text-muted-foreground">
            {diff.error ?? `Reading what moved in ${changeName(target)}…`}
          </p>
        ) : (
          <>
            <p className="text-sm font-semibold text-foreground">{model.heading}</p>
            {model.files.length === 0 && diff.data?.state !== "notHere" ? (
              <p className="text-sm text-muted-foreground">Nothing moved under this task yet.</p>
            ) : null}
            {model.files.map((file) => (
              <div key={file.path} className="overflow-hidden rounded-lg border border-border">
                <div className="flex items-center gap-2 bg-muted/50 px-2.5 py-1.5 font-mono text-xs">
                  <span className="min-w-0 flex-1 truncate text-foreground">{file.path}</span>
                  {file.added > 0 ? (
                    <span className="text-success-foreground">+{file.added}</span>
                  ) : null}
                  {file.removed > 0 ? (
                    <span className="text-destructive-foreground">−{file.removed}</span>
                  ) : null}
                </div>
                <pre className="overflow-x-auto py-1 font-mono text-xs">
                  {keyedLines(file.lines).map((line) => (
                    <div
                      key={line.key}
                      className={
                        "px-2.5 whitespace-pre text-foreground " +
                        (line.kind === "add"
                          ? "bg-success/8"
                          : line.kind === "del"
                            ? "bg-destructive/8"
                            : "")
                      }
                    >
                      {line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}
                      {line.text}
                    </div>
                  ))}
                </pre>
              </div>
            ))}
            {model.notes.map((note) => (
              <p key={note} className="text-xs text-muted-foreground">
                {note}
              </p>
            ))}
          </>
        )}
      </div>
    </section>
  );
}

/** Lets the task's agent go back to building on main; jj keeps the step in its operation log. */
function StopBuilding({
  environmentId,
  workspace,
  project,
  task,
  target,
}: Pick<TaskSlotProps, "environmentId" | "workspace" | "task"> & {
  readonly project: string;
  readonly target: TaskStackEntry;
}) {
  const follow = useAtomCommand(serverEnvironment.peerJujutsuFollow, { reportFailure: false });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const session = followSession(task);
  const name = changeName(target);
  const stop = async () => {
    if (session === undefined) return;
    setBusy(true);
    setMessage(null);
    await withFinally(
      async () => {
        const result = await follow({
          environmentId,
          input: { workspace, project, session, stop: true },
        });
        const failed = failureMessage(result);
        if (failed !== null) setMessage(failed);
        else {
          setOpen(false);
          setMessage(
            result._tag === "Success" && result.value.conflicts.length > 0
              ? `Your change now builds on main and holds a conflict in ${result.value.conflicts.join(", ")}.`
              : "Your change now builds on main.",
          );
        }
      },
      () => setBusy(false),
    );
  };
  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        size="xs"
        variant="outline"
        disabled={session === undefined}
        onClick={() => setOpen(true)}
      >
        Stop building on {name}…
      </Button>
      {session === undefined ? (
        <span className="text-xs text-muted-foreground">
          Runs on the computer where your agent works.
        </span>
      ) : null}
      {message === null || open ? null : (
        <span role="status" className="text-xs text-muted-foreground">
          {message}
        </span>
      )}
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop building on {name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Your agent's change moves onto main and no longer follows {name}. Nothing is lost: jj
              keeps this step in its operation log, so it can be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {message === null ? null : (
            <p role="alert" className="px-6 text-sm text-destructive-foreground">
              {message}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Keep building</AlertDialogClose>
            <Button disabled={busy} onClick={() => void stop()}>
              {busy ? "Moving…" : `Stop building on ${name}`}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
}
