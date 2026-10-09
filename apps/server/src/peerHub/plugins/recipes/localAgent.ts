import type {
  PeerLocalAgent,
  PeerRecipeTarget,
  ProjectId,
  ThreadId,
  PeerRecipesError,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type { PeerSessionView } from "../../core/plugin.ts";
import type { LocalRecipeAgent } from "./RecipeService.ts";
export interface LocalAgentPorts {
  readonly sessions: Effect.Effect<ReadonlyArray<Pick<PeerSessionView, "id" | "pane" | "thread">>>;
  readonly runtimes: Effect.Effect<
    ReadonlyArray<Pick<PeerLocalAgent, "id" | "title" | "paneId" | "status">>
  >;
  readonly level: (id: string) => "A" | "B" | "C";
  readonly shell: (id: ThreadId) => Effect.Effect<
    {
      readonly title: string;
      readonly status: string;
      readonly archivedAt: unknown | null;
      readonly pendingRuntimeRequest: unknown | null;
      readonly projectId: ProjectId;
    } | null,
    PeerRecipesError
  >;
}
export const localRecipeAgent =
  (ports: LocalAgentPorts) =>
  (target: PeerRecipeTarget): Effect.Effect<LocalRecipeAgent | null, PeerRecipesError> =>
    Effect.gen(function* () {
      const sessions = yield* ports.sessions;
      if (target.kind === "herdr") {
        const runtime = (yield* ports.runtimes).find((row) => row.id === target.agentId);
        if (!runtime) return null;
        const session = sessions.find(
          (row) => row.pane === runtime.paneId && `herdr:${row.id}` === runtime.id,
        );
        return {
          title: runtime.title,
          status: runtime.status,
          coordinating: session !== undefined && ports.level(session.id) !== "C",
        };
      }
      const shell = yield* ports.shell(target.threadId);
      if (!shell || shell.archivedAt !== null) return null;
      const session = sessions.find((row) => row.thread === `peer:${target.threadId}`);
      return {
        title: shell.title,
        status: shell.pendingRuntimeRequest === null ? shell.status : "blocked",
        coordinating: session !== undefined && ports.level(session.id) !== "C",
        projectId: shell.projectId,
      };
    });
