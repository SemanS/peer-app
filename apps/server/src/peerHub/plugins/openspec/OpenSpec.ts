import {
  PeerHubError,
  type PeerOpenSpecLinkInput,
  type PeerOpenSpecReadInput,
  type PeerOpenSpecReadResult,
  type PeerOpenSpecSaveBriefInput,
  type PeerOpenSpecUnlinkInput,
  type PeerTask,
  type PeerTaskBrief,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { checkoutState } from "../../core/vcs.ts";
import { PeerHubClient } from "../../core/hub/PeerHubClient.ts";
import { PeerState, safeId } from "../../core/state/PeerState.ts";
import { PeerWork } from "../../core/work/PeerWork.ts";
import { briefsHub, type BriefBody } from "./hub.ts";
import { briefPrompt, linkOf } from "./link.ts";
import { listChanges, readSource, type SourceRead } from "./client/read.ts";

const isHubError = Schema.is(PeerHubError);

/** A task's brief and its source as one environment reads them, for the page and for `peer brief`. */
export interface TaskSource {
  readonly task: PeerTask;
  readonly brief: PeerTaskBrief | null;
  readonly served: boolean;
  readonly repositoryId: string | undefined;
  readonly read: SourceRead;
  readonly result: PeerOpenSpecReadResult;
}

export class OpenSpec extends Context.Service<
  OpenSpec,
  {
    readonly read: (
      input: PeerOpenSpecReadInput,
    ) => Effect.Effect<PeerOpenSpecReadResult, PeerHubError>;
    readonly source: (input: PeerOpenSpecReadInput) => Effect.Effect<TaskSource, PeerHubError>;
    readonly link: (
      input: PeerOpenSpecLinkInput,
    ) => Effect.Effect<PeerOpenSpecReadResult, PeerHubError>;
    readonly unlink: (
      input: PeerOpenSpecUnlinkInput,
    ) => Effect.Effect<PeerOpenSpecReadResult, PeerHubError>;
    readonly saveBrief: (
      input: PeerOpenSpecSaveBriefInput,
    ) => Effect.Effect<PeerOpenSpecReadResult, PeerHubError>;
  }
>()("t3/peerHub/plugins/openspec/OpenSpec") {}

const unread = (reason: string): SourceRead => ({
  live: { state: "unavailable", code: "source-unavailable", reason },
});

const make = Effect.gen(function* () {
  const state = yield* PeerState;
  const hub = yield* PeerHubClient;
  const work = yield* PeerWork;
  const briefs = briefsHub(hub);

  // A Hub without briefs, or one that cannot be reached, leaves the live read as it was before
  // briefs existed: the page explains and offers the manual prompt.
  const briefOf = (workspace: string, project: string, task: string) =>
    briefs.get(workspace, project, task).pipe(
      Effect.map((answer) =>
        answer === undefined
          ? { served: false, brief: null }
          : { served: true, brief: answer.brief },
      ),
      Effect.catch(() => Effect.succeed({ served: false, brief: null as PeerTaskBrief | null })),
    );

  const source = Effect.fn("OpenSpec.source")(function* (input: PeerOpenSpecReadInput) {
    yield* hub.session;
    const { workspace, project } = yield* state.project(input.workspace, input.projectId);
    const task = (yield* work.tasks(workspace.slug, project.id)).find(
      (one) => one.id === input.taskId,
    );
    if (task === undefined)
      return yield* new PeerHubError({ detail: "That task does not belong to this project." });
    if (
      input.repositoryId !== undefined &&
      !project.repositories.some((one) => one.id === input.repositoryId)
    )
      return yield* new PeerHubError({
        detail: "That repository does not belong to this project.",
      });
    const { served, brief } = yield* briefOf(workspace.slug, project.id, task.id);
    // The saved link names its repository; a person's choice and a single repository come next.
    const linked = project.repositories.find((one) => one.id === brief?.source?.repository);
    const repositories =
      input.repositoryId !== undefined
        ? project.repositories.filter((one) => one.id === input.repositoryId)
        : linked !== undefined
          ? [linked]
          : project.repositories;
    const repository = repositories.length === 1 ? repositories[0]! : undefined;
    let checkout: string | undefined;
    const read: SourceRead = yield* Effect.gen(function* () {
      if (repository === undefined)
        return unread(
          repositories.length === 0
            ? "This project has no repository."
            : "Choose a repository to read this task's OpenSpec change.",
        );
      if (!safeId(repository.id))
        return yield* new PeerHubError({ detail: "The repository has an unsafe identifier." });
      const runtime = yield* state.read;
      checkout = state.checkoutPath(runtime.persisted, workspace.slug, project.id, repository.id);
      const notReady = {
        ...unread("The project repository is not ready on this environment."),
        noCheckout: true as const,
      };
      if (runtime.checkouts.has(checkout)) return notReady;
      const checkoutStatus = yield* Effect.tryPromise({
        try: () => checkoutState(checkout!),
        catch: () => new PeerHubError({ detail: "Could not inspect the project repository." }),
      });
      if (checkoutStatus.state !== "ready") return notReady;
      return yield* Effect.tryPromise({
        try: () => readSource(checkout!, repository.id, task, brief?.source?.change),
        catch: (error) =>
          isHubError(error)
            ? error
            : new PeerHubError({
                detail: "Could not read the OpenSpec source on this environment.",
              }),
      });
    });
    const base = linkOf(read, brief, served);
    // Choosing another change needs the repository's list; a live, current link does not.
    const listed =
      served && checkout !== undefined && !read.noCheckout && base.state !== "current"
        ? yield* Effect.promise(() =>
            listChanges(checkout!)
              .then((all) => all.slice(0, 500).map((one) => one.name))
              .catch(() => undefined),
          )
        : undefined;
    const link = {
      ...base,
      ...(listed === undefined ? {} : { changes: listed }),
    };
    const repositoryId = repository?.id ?? brief?.source?.repository;
    const result: PeerOpenSpecReadResult =
      read.live.state === "ready"
        ? {
            ...read.live,
            link,
            ...(read.snapshot === undefined ? {} : { snapshot: read.snapshot }),
          }
        : brief !== null && repositoryId !== undefined
          ? {
              state: "brief",
              repositoryId,
              link,
              reason: read.live.reason,
              prompt: briefPrompt(task, brief, link.state),
            }
          : { ...read.live, link };
    return { task, brief, served, repositoryId, read, result } satisfies TaskSource;
  });

  const write = Effect.fn("OpenSpec.write")(function* (
    input: PeerOpenSpecReadInput,
    run: (
      now: TaskSource,
      workspace: string,
    ) => Effect.Effect<
      { readonly brief: PeerTaskBrief } | { readonly conflict: PeerHubError } | null,
      PeerHubError
    >,
  ) {
    const now = yield* source(input);
    if (!now.served)
      return yield* new PeerHubError({
        detail: "The Hub you are signed in to does not keep task briefs yet.",
      });
    const answer = yield* run(now, input.workspace);
    if (answer === null)
      return yield* new PeerHubError({
        detail: "The Hub you are signed in to does not keep task briefs yet.",
      });
    if ("conflict" in answer) return yield* answer.conflict;
    return (yield* source(input)).result;
  });

  const target = (input: PeerOpenSpecLinkInput | PeerOpenSpecUnlinkInput) => ({
    workspace: input.workspace,
    projectId: input.projectId,
    taskId: input.taskId,
  });

  return OpenSpec.of({
    source,
    read: (input) => source(input).pipe(Effect.map((now) => now.result)),
    link: (input) =>
      write(
        {
          ...target(input),
          ...(input.repositoryId === undefined ? {} : { repositoryId: input.repositoryId }),
        },
        Effect.fn("OpenSpec.link")(function* (now, workspace) {
          const change =
            input.change ?? now.brief?.source?.change ?? now.result.link?.proposed?.change;
          if (change === undefined || now.repositoryId === undefined)
            return yield* new PeerHubError({
              detail: "Name the OpenSpec change to link this task to.",
            });
          const runtime = yield* state.read;
          const checkout = state.checkoutPath(
            runtime.persisted,
            workspace,
            input.projectId,
            now.repositoryId,
          );
          const read = yield* Effect.tryPromise({
            try: () => readSource(checkout, now.repositoryId!, now.task, change),
            catch: (error) =>
              isHubError(error)
                ? error
                : new PeerHubError({ detail: "Could not read the OpenSpec source." }),
          });
          if (read.snapshot === undefined)
            return yield* new PeerHubError({
              detail:
                read.live.state === "unavailable" ? read.live.reason : "Cannot read that change.",
            });
          const body: BriefBody = {
            expectedRevision: input.expectedRevision,
            goal: read.snapshot.goal,
            checklist: read.snapshot.checklist,
            ...(now.brief?.notes === undefined ? {} : { notes: now.brief.notes }),
            source: {
              kind: "openspec",
              repository: now.repositoryId,
              change: read.changeId ?? change,
              fingerprint: read.snapshot.fingerprint,
            },
          };
          return yield* briefs.save(workspace, input.projectId, input.taskId, body);
        }),
      ),
    unlink: (input) =>
      write(target(input), (_now, workspace) =>
        briefs.unlink(workspace, input.projectId, input.taskId, input.expectedRevision),
      ),
    saveBrief: (input) =>
      write(target(input), (_now, workspace) =>
        briefs.save(workspace, input.projectId, input.taskId, {
          expectedRevision: input.expectedRevision,
          goal: input.goal,
          checklist: input.checklist,
          ...(input.notes === undefined || input.notes.trim() === "" ? {} : { notes: input.notes }),
        }),
      ),
  });
});
export const layer = Layer.effect(OpenSpec, make);
