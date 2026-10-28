/**
 * `peer core tasks` and `peer core take`: a person's tasks and taking one nobody owns, from a
 * terminal, as the person with the Hub session (no broker). The task an invitation named is listed
 * first until it is done. Outcomes follow the peer-cli-contract.
 *
 * @module cli/peerCoreTasks
 */
import { PEER_LOCAL_WORKSPACE, type PeerHubError, type PeerTask } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as PeerHubClient from "../peerHub/core/hub/PeerHubClient.ts";
import * as PeerState from "../peerHub/core/state/PeerState.ts";
import { hubOutcome, type OneShotIo, outcome } from "./peerCoreIo.ts";

export type TaskFilter = "all" | "open" | "mine";

interface ProjectRef {
  readonly workspace: string;
  readonly project: string;
}

export interface TasksInput {
  /** `--project <workspace/project>`. */
  readonly project?: string;
  readonly filter: TaskFilter;
  readonly cwd: string;
  /** No broker runs, so peer-hub.json may be written (a binding by remote, finished invitations). */
  readonly canWrite: boolean;
}

const TASKS_NEXT = "check the project with peer core status, then repeat the command.";

/** `--project`, else the bound folder's project; undefined: every project of the person's. */
const projectOf = (
  input: { readonly project?: string; readonly cwd: string; readonly canWrite: boolean },
  io: OneShotIo,
) =>
  Effect.gen(function* () {
    const state = yield* PeerState.PeerState;
    if (input.project !== undefined) {
      const [workspace, project, ...rest] = input.project.trim().split("/");
      if (workspace === undefined || project === undefined || project === "" || rest.length > 0)
        return yield* outcome(
          "usage",
          `--project takes <workspace>/<project>, not ${input.project}`,
          "name the project as peer core status lists it.",
        );
      yield* state
        .project(workspace, project)
        .pipe(Effect.mapError((error) => outcome("refused", error.detail, TASKS_NEXT)));
      return { workspace, project } satisfies ProjectRef;
    }
    const place = yield* state.placeOf(input.cwd, { bindByRemote: input.canWrite });
    const notice = yield* state.pendingBindingNotice(input.cwd);
    if (notice !== null) yield* io.say(notice);
    return place === null || place.workspace === PEER_LOCAL_WORKSPACE
      ? undefined
      : ({ workspace: place.workspace, project: place.project } satisfies ProjectRef);
  });

/** Each workspace's tasks and their owners, as its Hub says now. */
const readWork = (slugs: ReadonlyArray<string>, command: string) =>
  Effect.gen(function* () {
    const client = yield* PeerHubClient.PeerHubClient;
    const { hubUrl, session } = yield* client.session.pipe(
      Effect.mapError((error) => hubOutcome(error, command, TASKS_NEXT, true)),
    );
    const read = new Map<
      string,
      {
        readonly projects: Readonly<Record<string, ReadonlyArray<PeerTask>>>;
        /** Task id → owner's address per project; undefined: the Hub does not say (no ownership). */
        readonly owners: Readonly<Record<string, Readonly<Record<string, string>>>> | undefined;
      }
    >();
    for (const slug of slugs) {
      const work = yield* client.api
        .work(hubUrl, session, slug)
        .pipe(
          Effect.mapError((error: PeerHubError) => hubOutcome(error, command, TASKS_NEXT, true)),
        );
      const view = yield* client.api.taskOwners(hubUrl, session, slug).pipe(Effect.option);
      read.set(slug, {
        projects: Object.fromEntries(
          Object.entries(work.projects).map(([id, project]) => [id, project.tasks]),
        ),
        owners: Option.isNone(view)
          ? undefined
          : Object.fromEntries(
              Object.entries(view.value.projects).map(([id, project]) => [
                id,
                Object.fromEntries(
                  Object.entries(project.tasks).map(([task, owner]) => [task, owner.owner]),
                ),
              ]),
            ),
      });
    }
    return read;
  });

const label = (task: PeerTask) => task.key ?? task.id;

/** `peer core tasks [--project <ws/id>] [--open|--mine]`. */
export const listTasks = (input: TasksInput, io: OneShotIo) =>
  Effect.gen(function* () {
    const state = yield* PeerState.PeerState;
    const { persisted } = yield* state.read;
    const email = persisted.email?.toLowerCase() ?? null;
    const chosen = yield* projectOf(input, io);
    const refs: ReadonlyArray<ProjectRef> =
      chosen !== undefined
        ? [chosen]
        : persisted.workspaces
            .filter((workspace) => workspace.slug !== PEER_LOCAL_WORKSPACE)
            .flatMap((workspace) =>
              (workspace.manifest?.projects ?? []).map((project) => ({
                workspace: workspace.slug,
                project: project.id,
              })),
            );
    if (refs.length === 0)
      return yield* outcome(
        "refused",
        "you are on no project yet",
        "join a workspace with peer core join <invitation link>, then repeat the command.",
      );
    const work = yield* readWork([...new Set(refs.map((ref) => ref.workspace))], "tasks");
    const invited = persisted.invitedTasks ?? [];
    const finished: Array<{ readonly workspace: string; readonly task: string }> = [];
    let listed = 0;
    for (const ref of refs) {
      const read = work.get(ref.workspace);
      const tasks = read?.projects[ref.project] ?? [];
      const owners = read?.owners?.[ref.project];
      for (const entry of invited)
        if (entry.workspace === ref.workspace && (entry.project ?? ref.project) === ref.project) {
          const task = tasks.find((t) => t.id === entry.task);
          if (task?.status === "done") finished.push(entry);
        }
      const isInvited = (task: PeerTask) =>
        invited.some(
          (entry) =>
            entry.workspace === ref.workspace &&
            (entry.project ?? ref.project) === ref.project &&
            entry.task === task.id,
        );
      const ownerOf = (task: PeerTask) => owners?.[task.id];
      const shown = tasks
        .filter((task) => task.status !== "done")
        .filter((task) =>
          input.filter === "open"
            ? owners !== undefined && ownerOf(task) === undefined
            : input.filter === "mine"
              ? email !== null && ownerOf(task) === email
              : true,
        )
        .toSorted((a, b) => Number(isInvited(b)) - Number(isInvited(a)));
      if (refs.length > 1 && shown.length > 0)
        yield* io.say(`Project: ${ref.workspace}/${ref.project}`);
      for (const task of shown) {
        const owner = owners === undefined ? "owner unknown" : (ownerOf(task) ?? "nobody");
        yield* io.say(
          `${label(task)} · ${task.title} · ${task.status} · ${task.area ?? "no area"} · ${owner}`,
        );
      }
      listed += shown.length;
    }
    if (listed === 0)
      yield* io.say(
        `Tasks: none${input.filter === "open" ? " nobody owns" : input.filter === "mine" ? " of yours" : ""} in ${refs.map((r) => `${r.workspace}/${r.project}`).join(", ")}.`,
      );
    if (input.canWrite && finished.length > 0)
      yield* state
        .updatePersisted((p) => ({
          ...p,
          invitedTasks: (p.invitedTasks ?? []).filter(
            (entry) =>
              !finished.some(
                (done) => done.workspace === entry.workspace && done.task === entry.task,
              ),
          ),
        }))
        .pipe(Effect.ignore);
  });

export interface TakeInput {
  readonly task: string;
  readonly project?: string;
  readonly cwd: string;
  readonly canWrite: boolean;
}

/** `peer core take <task> [--project <ws/id>]`: the person becomes the owner of a task nobody owns. */
export const takeTask = (input: TakeInput, io: OneShotIo) =>
  Effect.gen(function* () {
    const state = yield* PeerState.PeerState;
    const client = yield* PeerHubClient.PeerHubClient;
    const { persisted } = yield* state.read;
    const wanted = input.task.trim();
    if (wanted === "")
      return yield* outcome("usage", "take needs a task", "name it as peer core tasks lists it.");
    const email = persisted.email?.toLowerCase() ?? null;
    if (email === null)
      return yield* outcome(
        "refused",
        "nobody is signed in here",
        "sign in with peer core login <email>, then repeat the command.",
      );
    const chosen = yield* projectOf(input, io);
    const invitedProject = persisted.invitedTasks?.find(
      (entry) => entry.task === wanted && entry.project !== undefined,
    );
    const candidates: ReadonlyArray<ProjectRef> =
      chosen !== undefined
        ? [chosen]
        : invitedProject?.project !== undefined
          ? [{ workspace: invitedProject.workspace, project: invitedProject.project }]
          : persisted.workspaces
              .filter((workspace) => workspace.slug !== PEER_LOCAL_WORKSPACE)
              .flatMap((workspace) =>
                (workspace.manifest?.projects ?? []).map((project) => ({
                  workspace: workspace.slug,
                  project: project.id,
                })),
              );
    const work = yield* readWork([...new Set(candidates.map((ref) => ref.workspace))], "take");
    const found = candidates.flatMap((ref) => {
      const task = (work.get(ref.workspace)?.projects[ref.project] ?? []).find(
        (t) => t.id === wanted || t.key === wanted,
      );
      return task === undefined ? [] : [{ ...ref, task }];
    });
    if (found.length === 0)
      return yield* outcome(
        "refused",
        `no task ${wanted} in ${candidates.map((r) => `${r.workspace}/${r.project}`).join(", ") || "your projects"}`,
        "find it with peer core tasks, then repeat the command.",
      );
    if (found.length > 1)
      return yield* outcome(
        "usage",
        `${wanted} is a task of ${found.map((f) => `${f.workspace}/${f.project}`).join(" and ")}`,
        "choose one with --project <workspace>/<project>.",
      );
    const { workspace, project, task } = found[0]!;
    const where = `${workspace}/${project}`;
    if (task.status === "done")
      return yield* outcome(
        "refused",
        `${label(task)} is done`,
        "take a task that is not done; peer core tasks lists them.",
      );
    const owner = work.get(workspace)?.owners?.[project]?.[task.id];
    const named = (address: string) => `${state.nameOf(workspace, address)} (${address})`;
    const handOver = `ask them to hand it over, or a lead of ${where} to name you.`;
    if (owner === email) {
      yield* io.say(`You own ${label(task)} · ${task.title} already (${where}).`);
      return;
    }
    if (owner !== undefined)
      return yield* outcome("refused", `${label(task)} is owned by ${named(owner)}`, handOver);
    const { hubUrl, session } = yield* client.session.pipe(
      Effect.mapError((error) => hubOutcome(error, "take", TASKS_NEXT, true)),
    );
    const answer = yield* client.api
      .takeTask(hubUrl, session, workspace, project, task.id, { owner: email })
      .pipe(
        Effect.mapError((error) =>
          hubOutcome(
            error,
            "take",
            error.refused === true
              ? `ask a lead of ${where} to name you the owner.`
              : "run peer core tasks to see who owns it, and repeat the command only if it is still nobody.",
            false,
          ),
        ),
      );
    if ("ownedBy" in answer)
      return yield* outcome(
        "refused",
        `${label(task)} is owned by ${named(answer.ownedBy)}`,
        handOver,
      );
    // Someone else's take reached the Hub first.
    if (answer.owner !== null && answer.owner.owner !== email)
      return yield* outcome(
        "refused",
        `${label(task)} is owned by ${named(answer.owner.owner)}`,
        handOver,
      );
    yield* io.say(`You own ${label(task)} · ${task.title} now (${where}).`);
  });
