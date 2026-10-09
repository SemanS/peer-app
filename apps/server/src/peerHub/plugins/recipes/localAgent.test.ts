import { expect, it } from "@effect/vitest";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { localRecipeAgent, type LocalAgentPorts } from "./localAgent.ts";
it.effect(
  "authoritatively distinguishes own live sessions from observed, archived, deleted and blocked targets",
  () =>
    Effect.gen(function* () {
      let level: "A" | "B" | "C" = "B",
        archived = false,
        exists = true,
        blocked = false;
      const ports: LocalAgentPorts = {
        sessions: Effect.succeed([
          { id: "claude:one", pane: "p", thread: undefined },
          { id: "codex:two", pane: undefined, thread: "peer:thread" },
        ]),
        runtimes: Effect.succeed([
          { id: "herdr:claude:one", title: "Mine", paneId: "p", status: "working" },
          { id: "herdr:observed", title: "Observed", paneId: "other", status: "working" },
        ]),
        level: () => level,
        shell: () =>
          Effect.sync(() =>
            exists
              ? {
                  title: "Thread",
                  status: "running",
                  archivedAt: archived ? {} : null,
                  pendingRuntimeRequest: blocked ? {} : null,
                  projectId: ProjectId.make("p"),
                }
              : null,
          ),
      };
      const local = localRecipeAgent(ports);
      expect(yield* local({ kind: "herdr", agentId: "herdr:claude:one" })).toMatchObject({
        title: "Mine",
        coordinating: true,
      });
      expect(yield* local({ kind: "herdr", agentId: "herdr:observed" })).toMatchObject({
        coordinating: false,
      });
      expect(yield* local({ kind: "herdr", agentId: "colleague" })).toBeNull();
      level = "C";
      expect(yield* local({ kind: "herdr", agentId: "herdr:claude:one" })).toMatchObject({
        coordinating: false,
      });
      level = "B";
      const target = { kind: "thread" as const, threadId: ThreadId.make("thread") };
      expect(yield* local(target)).toMatchObject({ coordinating: true, projectId: "p" });
      blocked = true;
      expect(yield* local(target)).toMatchObject({ status: "blocked" });
      archived = true;
      expect(yield* local(target)).toBeNull();
      archived = false;
      exists = false;
      expect(yield* local(target)).toBeNull();
    }),
);
