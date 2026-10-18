// @effect-diagnostics nodeBuiltinImport:off - real jj in temporary repositories.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";

import { operationName, protectionKeys, remember, MINE_MAX } from "./config.ts";
import {
  bobsJujutsu,
  isolatedHome,
  jj,
  repository,
  sessionIn,
  workspaceConfig,
} from "./fixtures.test.ts";

const homeDir = isolatedHome();
const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.scoped, Effect.provide(NodeServices.layer));

const opLog = (cwd: string) =>
  jj(cwd, "op", "log", "--no-graph", "--ignore-working-copy", "-T", 'user ++ "\\n"');

describe("an agent workspace's jj configuration", () => {
  it.effect("names the agent's steps, and sets the author only where jj has none", () =>
    Effect.gen(function* () {
      const repo = repository({ person: false });
      const bob = repo.workspace("ORD-12-3f2a1b2c");
      const { service } = yield* bobsJujutsu();

      yield* service.sessionStart(sessionIn(bob, { agent: "codex" }));

      const config = workspaceConfig(bob);
      assert.include(config, 'operation.username = "bob·codex"');
      assert.include(config, "snapshot.auto-update-stale = true");
      assert.include(config, 'user.email = "bob@acme.test"');
      jj(bob, "new", "-m", "work");
      assert.include(opLog(bob), "bob·codex@");
    }).pipe(run),
  );

  it.effect("keeps the person's own author when jj has one", () =>
    Effect.gen(function* () {
      const repo = repository({ person: true });
      const bob = repo.workspace("ORD-12-aaaaaaaa");
      const { service } = yield* bobsJujutsu();

      yield* service.sessionStart(sessionIn(bob));

      const config = workspaceConfig(bob);
      assert.include(config, 'operation.username = "bob·codex"');
      assert.notInclude(config, "user.email");
      assert.notInclude(config, "user.name");
      assert.include(jj(bob, "config", "get", "user.email"), "person@home.test");
    }).pipe(run),
  );

  it.effect("writes nothing in the repository's default workspace", () =>
    Effect.gen(function* () {
      const repo = repository({ person: false });
      const { service } = yield* bobsJujutsu();
      const before = NodeFS.readdirSync(NodePath.join(homeDir, ".config", "jj"));

      yield* service.sessionStart(sessionIn(repo.main));
      jj(repo.main, "status");

      assert.strictEqual(workspaceConfig(repo.main), "");
      assert.deepStrictEqual(NodeFS.readdirSync(NodePath.join(homeDir, ".config", "jj")), before);
      assert.notInclude(opLog(repo.main), "bob·");
    }).pipe(run),
  );

  it.live("configures a task workspace when it is made, before its agent's first step", () =>
    Effect.gen(function* () {
      const repo = repository({ person: false });
      const bob = repo.workspace("ORD-12-bbbbbbbb");
      const { service } = yield* bobsJujutsu();
      yield* Effect.forkScoped(service.run);

      yield* service.taskWorktreeCreated({
        kind: "task-worktree-created",
        workspace: "acme",
        project: "pay",
        repository: "api",
        task: "krk-1",
        thread: "herdr:1",
        root: bob,
        identity: "x",
      });
      for (let attempt = 0; attempt < 100 && !workspaceConfig(bob).includes("operation"); attempt++)
        yield* Effect.sleep(50);

      assert.include(workspaceConfig(bob), "operation.username");
    }).pipe(run),
  );

  it.effect("removes every key it wrote when the plugin is turned off", () =>
    Effect.gen(function* () {
      const repo = repository({ person: false });
      const bob = repo.workspace("ORD-12-cccccccc");
      const { service } = yield* bobsJujutsu();
      yield* service.sessionStart(sessionIn(bob));
      assert.notStrictEqual(workspaceConfig(bob), "");

      yield* service.turnOff;

      assert.strictEqual(workspaceConfig(bob).trim(), "");
      assert.strictEqual((yield* service.status).agentWorkspaces, 0);
    }).pipe(run),
  );
});

describe("the keys as values", () => {
  it("names a step by the local part of the address", () => {
    assert.strictEqual(operationName("bob@acme.test", "codex"), "bob·codex");
  });

  it("renders whole aliases, and an empty set as none()", () => {
    const keys = Object.fromEntries(protectionKeys(["aaa"], []));
    assert.strictEqual(keys['revset-aliases."peer_mine()"'], "change_id(aaa)");
    assert.strictEqual(keys['revset-aliases."peer_others()"'], "none()");
    assert.strictEqual(
      keys['revset-aliases."immutable_heads()"'],
      "builtin_immutable_heads() | (peer_others() ~ peer_mine()::)",
    );
  });

  it("keeps at most 200 ids, the oldest dropped", () => {
    const ids = Array.from({ length: MINE_MAX + 5 }, (_, i) => `id${i}`).reduce<
      ReadonlyArray<string>
    >(remember, []);
    assert.strictEqual(ids.length, MINE_MAX);
    assert.strictEqual(ids[0], "id5");
    assert.deepStrictEqual(remember(["a"], "a"), ["a"]);
  });
});
