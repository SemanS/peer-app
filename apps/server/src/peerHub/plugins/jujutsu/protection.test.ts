// @effect-diagnostics nodeBuiltinImport:off - real jj in temporary repositories.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  bobsJujutsu,
  isolatedHome,
  jj,
  repository,
  sessionIn,
  stepOf,
  workspaceConfig,
} from "./fixtures.test.ts";

isolatedHome();
const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.scoped, Effect.provide(NodeServices.layer));

const write = (dir: string, file: string, text: string) =>
  NodeFS.writeFileSync(NodePath.join(dir, file), text);
const changeId = (cwd: string, rev: string) =>
  jj(cwd, "log", "--no-graph", "--ignore-working-copy", "-r", rev, "-T", "change_id");

/** What jj says when it refuses; the test fails when it does not. */
function refusal(cwd: string, ...args: Array<string>) {
  try {
    jj(cwd, ...args);
  } catch (failure) {
    return String((failure as { stderr?: unknown }).stderr);
  }
  return assert.fail(`jj ${args.join(" ")} was not refused`);
}

/**
 * Ana's agent works in the repository's default workspace on ORD-11 and Bob's in `ORD-12`. Peer
 * snapshots Ana's step, so her change is hers, and writes Bob's aliases.
 */
const setup = Effect.gen(function* () {
  const repo = repository({ person: false });
  const bob = repo.workspace("ORD-12-3f2a1b2c");
  const kit = yield* bobsJujutsu();
  const ana = sessionIn(repo.main, { id: "claude:ana", agent: "claude", task: "krk-2" });
  const bobs = sessionIn(bob, { id: "codex:bob" });
  write(repo.main, "order.js", "line one\nline two\n");
  jj(repo.main, "describe", "-m", "ORD-11");
  yield* kit.service.afterStep(stepOf(ana));
  yield* kit.service.sessionStart(bobs);
  write(bob, "loyalty.js", "one\n");
  jj(bob, "describe", "-m", "ORD-12");
  yield* kit.service.afterStep(stepOf(bobs));
  yield* kit.service.flush;
  return { ...kit, repo, bob, ana, bobs, anas: changeId(repo.main, "@") };
});

describe("another agent's changes are read-only", () => {
  it.effect("writes the aliases of the design, with Ana's change in Bob's peer_others()", () =>
    Effect.gen(function* () {
      const { bob, anas } = yield* setup;

      const config = workspaceConfig(bob);
      assert.include(config, `"peer_others()" = "change_id(${anas})"`);
      assert.include(config, `"peer_mine()" = "change_id(${changeId(bob, "@")})"`);
      assert.include(
        config,
        `"immutable_heads()" = "builtin_immutable_heads() | (peer_others() ~ peer_mine()::)"`,
      );
    }).pipe(run),
  );

  it.effect("makes jj refuse squash into, describe and rebase of Ana's change", () =>
    Effect.gen(function* () {
      const { repo, bob, anas } = yield* setup;
      write(bob, "order.js", "line one\nline two edited\n");

      assert.include(refusal(bob, "squash", "--into", anas, "order.js"), "is immutable");
      assert.include(refusal(bob, "describe", "-r", anas, "-m", "mine now"), "is immutable");
      assert.include(refusal(bob, "rebase", "-r", anas, "-o", "main"), "is immutable");
      assert.include(refusal(bob, "abandon", anas), "is immutable");
      // Nothing of Ana's moved.
      assert.strictEqual(
        jj(repo.main, "log", "--no-graph", "-r", "@", "-T", "description").trim(),
        "ORD-11",
      );
    }).pipe(run),
  );

  it.effect("leaves the line in Bob's own change when he absorbs near Ana's", () =>
    Effect.gen(function* () {
      const { bob, anas } = yield* setup;
      jj(bob, "new", anas, "-m", "ORD-12");
      write(bob, "order.js", "line one\nline two edited\n");

      jj(bob, "absorb");

      assert.include(jj(bob, "diff", "--summary", "-r", "@"), "order.js");
      assert.include(jj(bob, "show", "--no-patch", "-T", "description", anas), "ORD-11");
      assert.notInclude(jj(bob, "diff", "-r", anas), "edited");
    }).pipe(run),
  );

  it.effect("lets Bob amend his change while Ana's agent builds on it", () =>
    Effect.gen(function* () {
      const { repo, bob, ana, service } = yield* setup;
      const theirs = changeId(bob, "@");
      // Ana's agent starts a change of its own on Bob's.
      jj(repo.main, "new", theirs, "-m", "ORD-11 follow-up");
      write(repo.main, "extra.js", "x\n");
      yield* service.afterStep(stepOf(ana));
      const followUp = changeId(repo.main, "@");
      yield* service.flush;
      assert.include(workspaceConfig(bob), "peer_others()");

      write(bob, "loyalty.js", "two\n");
      jj(bob, "describe", "-m", "ORD-12 amended");

      const parents = jj(
        repo.main,
        "log",
        "--no-graph",
        "--ignore-working-copy",
        "-r",
        `change_id(${followUp})`,
        "-T",
        'parents.map(|p| p.description().first_line()).join(",")',
      );
      assert.strictEqual(parents.trim(), "ORD-12 amended");
    }).pipe(run),
  );

  it.effect("never breaks on an id that is gone", () =>
    Effect.gen(function* () {
      const { repo, bob, anas } = yield* setup;
      jj(repo.main, "new", "main");
      jj(repo.main, "abandon", anas);

      assert.include(
        jj(bob, "log", "--no-graph", "-r", "@", "-T", "change_id"),
        changeId(bob, "@"),
      );
      assert.include(workspaceConfig(bob), anas);
    }).pipe(run),
  );

  it.effect("drops a change from the others' aliases once it landed", () =>
    Effect.gen(function* () {
      const { repo, bob, anas, service } = yield* setup;
      jj(repo.main, "config", "set", "--repo", 'revset-aliases."trunk()"', "main");
      jj(repo.main, "bookmark", "set", "main", "-r", anas, "--allow-backwards");

      yield* service.sweep;
      yield* service.flush;

      assert.include(workspaceConfig(bob), `"peer_others()" = "none()"`);
    }).pipe(run),
  );

  it.effect(
    "removes the aliases when protection is turned off, and writes them again when on",
    () =>
      Effect.gen(function* () {
        const { bob, anas, service } = yield* setup;

        const off = yield* service.configure({ protection: false });
        assert.isFalse(off.protection);
        assert.notInclude(workspaceConfig(bob), "peer_");
        assert.notInclude(workspaceConfig(bob), "immutable_heads");
        jj(bob, "describe", "-r", anas, "-m", "rewritten");

        const on = yield* service.configure({ protection: true });
        assert.isTrue(on.protection);
        assert.include(workspaceConfig(bob), "peer_others()");
      }).pipe(run),
  );

  it.effect("counts the agent workspaces, not the default one", () =>
    Effect.gen(function* () {
      const { service } = yield* setup;
      const state = yield* service.status;
      assert.strictEqual(state.agentWorkspaces, 1);
      assert.isTrue(state.protection);
    }).pipe(run),
  );

  it.live("rewrites the others' aliases soon after a session's own changes change", () =>
    Effect.gen(function* () {
      const repo = repository({ person: false });
      const bob = repo.workspace("ORD-12-aaaaaaaa");
      const { service } = yield* bobsJujutsu({ debounceMs: 50 });
      yield* Effect.forkScoped(service.run);
      yield* service.sessionStart(sessionIn(bob, { id: "codex:bob" }));
      assert.include(workspaceConfig(bob), '"peer_others()" = "none()"');

      write(repo.main, "order.js", "line one\n");
      jj(repo.main, "describe", "-m", "ORD-11");
      yield* service.afterStep(
        stepOf(sessionIn(repo.main, { id: "claude:ana", agent: "claude", task: "krk-2" })),
      );
      const ana = changeId(repo.main, "@");
      for (let attempt = 0; attempt < 100 && !workspaceConfig(bob).includes(ana); attempt++)
        yield* Effect.sleep(50);

      assert.include(workspaceConfig(bob), `"peer_others()" = "change_id(${ana})"`);
    }).pipe(run),
  );

  it.effect("tells the agent once, after the step, whose change its command named", () =>
    Effect.gen(function* () {
      const { service, bob, bobs, anas, logs } = yield* setup;
      write(bob, "order.js", "line one\nline two edited\n");
      const named = anas.slice(0, 8);
      const command = `jj squash --into ${named} order.js`;
      assert.include(refusal(bob, "squash", "--into", named, "order.js"), "is immutable");

      const text = yield* service.afterStep(stepOf(bobs, { command }));

      assert.strictEqual(
        text,
        [
          `${named} is Bob's change for krk-2, so jj keeps it read-only in your workspace.`,
          'Keep the edit in your own change, or ask: peer ask krk-2 "…"',
        ].join("\n"),
      );
      assert.isAtMost(text?.length ?? 0, 400);
      assert.isTrue(
        logs.some((entry) => entry.event === "jujutsu.told" && entry.fields.kind === "protected"),
      );
      // A later command naming the same change adds nothing.
      assert.isNull(yield* service.afterStep(stepOf(bobs, { command: `jj log -r ${named}` })));
    }).pipe(run),
  );

  it.effect("tells nothing while protection is off", () =>
    Effect.gen(function* () {
      const { service, bobs, anas } = yield* setup;
      yield* service.configure({ protection: false });

      const text = yield* service.afterStep(
        stepOf(bobs, { command: `jj squash --into ${anas.slice(0, 8)} order.js` }),
      );

      assert.isNull(text);
    }).pipe(run),
  );
});
