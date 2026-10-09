/**
 * Memory's background work while the plugin is active. Every 15 seconds, and for a workspace at
 * once when the Hub says its memory changed, it ends the app-run runtimes whose thread stopped,
 * synchronizes each project's memory (the local queue is sent in order, with its original
 * operation ids) and imports the knowledge each project approved in Git since. Turning memory off
 * forgets the app-run runtimes and what was imported, and leaves its local data as it is.
 *
 * @module peerHub/plugins/memory/run
 */
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";

import * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
import type { PeerHubListener } from "../../core/plugin.ts";
import * as PeerState from "../../core/state/PeerState.ts";
import * as MemoryKnowledge from "./knowledge.ts";
import * as MemoryRuntime from "./MemoryRuntime.ts";
import * as MemoryService from "./MemoryService.ts";
import { MemoryAuth } from "./MemoryTransport.ts";

export const makeBackground = Effect.gen(function* () {
  const memory = yield* MemoryService.MemoryService;
  const runtime = yield* MemoryRuntime.MemoryRuntime;
  const auth = yield* MemoryAuth;
  const state = yield* PeerState.PeerState;
  const client = yield* PeerHubClient.PeerHubClient;
  /** Workspaces the Hub pinged; `run` refreshes them, so the event stream never waits on memory. */
  const pinged = yield* Queue.unbounded<string>();
  /** Approved revisions imported already, by person, scope, repository and commit. */
  const imported = new Set<string>();

  /** Refreshes every workspace, or `only` one. */
  const refresh = Effect.fn("Memory.refresh")(function* (only?: string) {
    if (Option.isNone(yield* client.session.pipe(Effect.option))) return;
    yield* runtime.prune;
    const persisted = (yield* state.read).persisted;
    for (const workspace of persisted.workspaces) {
      if ((only !== undefined && workspace.slug !== only) || workspace.manifest === null) continue;
      const { manifest } = workspace;
      const company = manifest.knowledge.company;
      const scopes = [
        ...manifest.projects.map((project) => ({
          workspace: workspace.slug,
          project: project.id,
          repositories: project.repositories.map((repo) => ({
            repositoryId: repo.id,
            root: state.checkoutPath(persisted, workspace.slug, project.id, repo.id),
            branch: repo.branch,
          })),
        })),
        {
          workspace: workspace.slug,
          project: "company",
          repositories:
            company === undefined
              ? []
              : [
                  {
                    repositoryId: "company",
                    root: state.knowledgePath(workspace.slug),
                    branch: company.branch,
                  },
                ],
        },
      ];
      for (const scope of scopes) {
        const synced = yield* memory.synchronize(scope).pipe(Effect.option);
        if (Option.isNone(synced) || !synced.value.available || synced.value.mode === "legacy")
          continue;
        for (const repo of scope.repositories) {
          const revision = yield* MemoryKnowledge.approvedRevision(repo.root, repo.branch).pipe(
            Effect.option,
          );
          if (Option.isNone(revision)) continue;
          const key = `${persisted.email}/${scope.workspace}/${scope.project}/${repo.repositoryId}/${revision.value}`;
          if (imported.has(key)) continue;
          const result = yield* memory
            .importKnowledge({
              workspace: scope.workspace,
              project: scope.project,
              repositoryId: repo.repositoryId,
              commit: revision.value,
              reviewRef: repo.branch,
            })
            .pipe(Effect.provideService(MemoryAuth, auth), Effect.option);
          if (
            Option.isSome(result) &&
            result.value.operations.every((operation) => operation.status === "stored")
          )
            imported.add(key);
        }
      }
    }
  });

  /** The plugin's `run`: the 15 s refresh, and the pinged workspaces as they come. */
  const run = Effect.all(
    [
      Effect.forever(
        Effect.sleep("15 seconds").pipe(
          Effect.andThen(refresh()),
          Effect.ignoreCause({ log: true }),
        ),
      ),
      Effect.forever(
        Effect.gen(function* () {
          const first = yield* Queue.take(pinged);
          const rest = yield* Queue.clear(pinged);
          for (const workspace of new Set([first, ...rest])) yield* refresh(workspace);
        }).pipe(Effect.ignoreCause({ log: true })),
      ),
    ],
    { concurrency: "unbounded", discard: true },
  );

  /** Pings this environment caused count too: another of its windows may have written. */
  const hubChanges: PeerHubListener = {
    changes: ["memory.changed"],
    ownEcho: true,
    onPing: (ping) => Queue.offer(pinged, ping.workspace).pipe(Effect.asVoid),
  };

  /** Writes nothing and sends nothing: the queue, projections and checkpoints wait for memory. */
  const turnOff = runtime.forget.pipe(Effect.andThen(Effect.sync(() => imported.clear())));

  return { refresh, run, hubChanges, turnOff };
});
