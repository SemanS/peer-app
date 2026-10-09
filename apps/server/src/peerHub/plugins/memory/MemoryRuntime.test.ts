import { assert, describe, it } from "@effect/vitest";
import { EnvironmentId, PeerHubError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ProjectionStore from "../../../orchestration-v2/ProjectionStore.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
import type { PeerSessionView } from "../../core/plugin.ts";
import * as PeerState from "../../core/state/PeerState.ts";
import * as MemoryRuntime from "./MemoryRuntime.ts";
import * as MemoryService from "./MemoryService.ts";

/** An agent session coordination knows, on Peer's thread-1 and task krk-1, as plugins see it. */
const agentSession = (agent: "claude" | "codex", native: string): PeerSessionView => ({
  id: `${agent}:${native}`,
  agent,
  adapter: "hooks",
  runtimeGeneration: `generation-${native}`,
  workspace: "acme",
  project: "app",
  repositoryId: "api",
  root: "/checkouts/acme/app/api",
  cwd: "/checkouts/acme/app/api",
  task: "krk-1",
  thread: "peer:thread-1",
  pane: undefined,
  status: "working",
  keeps: false,
  files: [],
  claims: [],
  local: (_plugin, init) => init(),
});

const remember = {
  schemaVersion: 1 as const,
  operationId: "op-1",
  type: "assertion.record" as const,
  claim: "Prices are in cents",
  contextIds: [],
  evidence: [],
};
const publish = {
  schemaVersion: 1 as const,
  operationId: "op-2",
  type: "record.publish" as const,
  id: "assertion-1",
  expectedVersion: 1,
  targetProjectId: "company",
  text: "Prices are in cents",
  reason: "Everyone needs them",
};

/**
 * Memory's runtime over `sessions`, the ones coordination knows, and a memory service that writes
 * down what it is asked. One log holds, in order, what the Hub is told and what memory is asked.
 */
const runtimeOver = (
  sessions: ReadonlyArray<PeerSessionView>,
  reported: Effect.Effect<void, PeerHubError> = Effect.void,
) => {
  const log: Array<string> = [];
  const layer = MemoryRuntime.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(PeerAgents.PeerAgents)({
          inPane: () => undefined,
          level: () => "B",
          sessions: Effect.succeed(sessions),
          report: (workspace) =>
            Effect.sync(() => void log.push(`report ${workspace}`)).pipe(Effect.andThen(reported)),
        }),
        Layer.mock(MemoryService.MemoryService)({
          execute: ({ command }) =>
            Effect.sync(() => {
              log.push(
                `execute ${command.type} as ${command.sessionId}/${command.runtimeGeneration}`,
              );
              return { status: "stored" as const, operationId: command.operationId };
            }),
          receipt: (session, input, scope) =>
            Effect.sync(() => {
              log.push(`receipt ${input.state} of ${session.sessionId} in ${scope?.project}`);
              return {} as never;
            }),
        }),
        // Only the environment's id is read when the runtime is built; nothing else of these is used.
        Layer.mock(PeerState.PeerState)({
          environmentId: EnvironmentId.make("ana-laptop"),
        } as never),
        Layer.mock(PeerHubClient.PeerHubClient)({} as never),
        Layer.mock(ProjectionStore.ProjectionStoreV2)({}),
        Layer.mock(ProjectService.ProjectService)({}),
      ),
    ),
  );
  return { layer, log };
};

const NO_SESSION =
  "This runtime has no registered Peer memory session. Its coordination hooks must start first.";

describe("the runtime memory binds an agent's operations to", () => {
  it.effect(
    "is the session coordination knows by its native id, once the Hub has heard of it",
    () => {
      const test = runtimeOver([agentSession("claude", "one"), agentSession("codex", "two")]);
      return Effect.gen(function* () {
        const runtime = yield* MemoryRuntime.MemoryRuntime;
        const bound = yield* runtime.agent("one");
        assert.deepStrictEqual(bound, {
          workspace: "acme",
          project: "app",
          sessionId: "claude:one",
          environmentId: "ana-laptop",
          runtimeGeneration: "generation-one",
          workId: "peer:thread-1",
          taskId: "krk-1",
          repositoryId: "api",
          adapter: "claude",
          root: "/checkouts/acme/app/api",
        });
        // The session's own id, with its agent in front, names it as well.
        assert.deepStrictEqual(yield* runtime.agent("claude:one"), bound);
        assert.strictEqual((yield* runtime.agent("two")).sessionId, "codex:two");
        assert.deepStrictEqual(test.log, ["report acme", "report acme", "report acme"]);
      }).pipe(Effect.provide(test.layer));
    },
  );

  it.effect("is none when the id names no session, or the sessions of two agents", () => {
    const test = runtimeOver([agentSession("claude", "shared"), agentSession("codex", "shared")]);
    return Effect.gen(function* () {
      const runtime = yield* MemoryRuntime.MemoryRuntime;
      for (const id of ["shared", "unknown", ""]) {
        assert.strictEqual((yield* runtime.agent(id).pipe(Effect.flip)).detail, NO_SESSION);
      }
      // The Hub hears of nothing the runtime could not name, and the full ids still name them.
      assert.deepStrictEqual(test.log, []);
      assert.strictEqual((yield* runtime.agent("codex:shared")).sessionId, "codex:shared");
    }).pipe(Effect.provide(test.layer));
  });

  it.effect("stops an operation when the Hub could not be told of the session", () => {
    const test = runtimeOver(
      [agentSession("claude", "one")],
      Effect.fail(new PeerHubError({ detail: "The broker stopped." })),
    );
    return Effect.gen(function* () {
      const runtime = yield* MemoryRuntime.MemoryRuntime;
      const failure = yield* runtime
        .execute("one", { workspace: "acme", project: "app", command: remember })
        .pipe(Effect.flip);
      assert.strictEqual(failure.detail, "The broker stopped.");
      assert.deepStrictEqual(test.log, ["report acme"]);
    }).pipe(Effect.provide(test.layer));
  });

  it.effect("acts as its session in its own project, and only as an agent may", () => {
    const test = runtimeOver([agentSession("claude", "one")]);
    return Effect.gen(function* () {
      const runtime = yield* MemoryRuntime.MemoryRuntime;
      const written = yield* runtime.execute("one", {
        workspace: "acme",
        project: "app",
        command: remember,
      });
      assert.strictEqual(written.status, "stored");
      const elsewhere = yield* runtime
        .execute("one", { workspace: "acme", project: "other", command: remember })
        .pipe(Effect.flip);
      assert.strictEqual(
        elsewhere.detail,
        "The memory operation must belong to this runtime's project.",
      );
      const needsPerson = yield* runtime
        .execute("one", { workspace: "acme", project: "app", command: publish })
        .pipe(Effect.flip);
      assert.strictEqual(
        needsPerson.detail,
        "This memory review or publication operation requires a person in Peer.",
      );
      // The operation names the session it came from; the other two were refused after the report.
      assert.deepStrictEqual(test.log, [
        "report acme",
        "execute assertion.record as claude:one/generation-one",
        "report acme",
        "report acme",
      ]);
    }).pipe(Effect.provide(test.layer));
  });

  it.effect("acknowledges for its session in its own project or the company's", () => {
    const test = runtimeOver([agentSession("claude", "one")]);
    return Effect.gen(function* () {
      const runtime = yield* MemoryRuntime.MemoryRuntime;
      const receipt = { state: "acknowledged" as const, projectionId: "projection-1", records: [] };
      yield* runtime.receipt("one", receipt);
      yield* runtime.receipt("one", { ...receipt, project: "company" });
      for (const scope of [{ project: "other" }, { workspace: "elsewhere" }]) {
        const failure = yield* runtime.receipt("one", { ...receipt, ...scope }).pipe(Effect.flip);
        assert.strictEqual(
          failure.detail,
          "The receipt must belong to this runtime's project or company scope.",
        );
      }
      assert.deepStrictEqual(test.log, [
        "report acme",
        "receipt acknowledged of claude:one in app",
        "report acme",
        "receipt acknowledged of claude:one in company",
        "report acme",
        "report acme",
      ]);
    }).pipe(Effect.provide(test.layer));
  });
});
