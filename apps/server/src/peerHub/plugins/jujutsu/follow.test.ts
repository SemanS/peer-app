// @effect-diagnostics nodeBuiltinImport:off - real jj and git in temporary repositories, with a bare remote and two clones.
/**
 * Following (design D6) on a real jj: Ana's computer and Bob's share a bare remote. Time is the test
 * clock's, so the 30 seconds between fetches pass when a test says so.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";

import { CliError, type PeerCommandInput, type PeerSessionView } from "../../core/plugin.ts";
import { projectKey, type PeerState } from "../../core/state/PeerState.ts";
import { followCommand } from "./cli.ts";
import {
  exec,
  bobsJujutsu,
  isolatedHome,
  jj,
  repository,
  sessionIn,
  stepOf,
} from "./fixtures.test.ts";

isolatedHome();
const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.scoped, Effect.provide(NodeServices.layer));

const ORD11 = "feature/ORD-11-cents";
const write = (dir: string, file: string, text: string) =>
  NodeFS.writeFileSync(NodePath.join(dir, file), text);
const read = (dir: string, file: string) => NodeFS.readFileSync(NodePath.join(dir, file), "utf8");
const query = (cwd: string, revset: string, template: string) =>
  jj(cwd, "log", "--no-graph", "--ignore-working-copy", "-r", revset, "-T", template).trim();
const changeOf = (cwd: string, revset: string) => query(cwd, revset, "change_id.short(8)");
const commitOf = (cwd: string, revset: string) => query(cwd, revset, "commit_id");
const THREE_LINES = "export const total = 100;\nexport const toEuros = (c) => c / 100;\n";

/** Ana's computer (the repository's default workspace), the bare remote, and Bob's computer. */
function world() {
  const repo = repository();
  const origin = NodePath.join(repo.dir, "origin.git");
  exec("git", repo.dir, "init", "--bare", "--quiet", "--initial-branch=main", origin);
  exec("git", repo.main, "remote", "add", "origin", origin);
  exec("git", repo.main, "push", "--quiet", "origin", "main");
  jj(repo.main, "git", "fetch");
  const bobMain = NodePath.join(repo.dir, "bob-main");
  exec("git", repo.dir, "clone", "--quiet", origin, bobMain);
  jj(bobMain, "git", "init", "--colocate");
  return {
    ...repo,
    origin,
    bobMain,
    /** Ana's agent writes `order.js` into ORD-11 and pushes it: a new version of the same change. */
    ana: (text: string, bookmark = ORD11) => {
      write(repo.main, "order.js", text);
      jj(repo.main, "describe", "-m", "ORD-11: orderTotal returns integer cents");
      jj(repo.main, "bookmark", "set", bookmark, "-r", "@");
      jj(repo.main, "git", "push", "-b", bookmark);
    },
    /** Bob's agent workspace on `rev`, with a change of its own that carries the bookmark of its task. */
    bob: (rev: string, text = "export const points = 1;\n") => {
      const path = NodePath.join(repo.dir, "ORD-12-3f2a1b2c");
      jj(bobMain, "git", "fetch");
      jj(bobMain, "workspace", "add", "--name", "ORD-12-3f2a1b2c", "-r", rev, path);
      jj(path, "describe", "-m", "ORD-12: loyalty points");
      write(path, "loyalty.js", text);
      jj(path, "bookmark", "create", "feature/ORD-12-3f2a1b2c", "-r", "@");
      return path;
    },
  };
}

/** The Hub's work for Bob's project: the two tasks, and Ana's thread on ORD-11 from her computer. */
const seedWork = (state: PeerState["Service"], branch = ORD11) =>
  state.updateRuntime((now) => ({
    ...now,
    work: new Map([
      [
        projectKey("acme", "pay"),
        {
          areas: [],
          tasks: ["11", "12"].map((n) => ({
            id: `t${n}`,
            key: `ORD-${n}`,
            title: `Task ${n}`,
            status: "open" as const,
            createdBy: "ana@acme.test",
            createdAt: "2026-10-18T09:00:00Z",
            updatedAt: "2026-10-18T09:00:00Z",
          })),
          threads: [
            {
              id: "herdr:claude:ana-1",
              task: "t11",
              title: "ORD-11",
              email: "ana@acme.test",
              status: "working" as const,
              harness: "claude",
              branch,
              source: "herdr" as const,
              environment: "ana-mac",
              seenAt: "2026-10-18T14:00:00Z",
            },
          ],
        },
      ],
    ]),
  }));

const inputOf = (session: PeerSessionView, ...args: Array<string>): PeerCommandInput => ({
  session,
  args,
  plain: args.filter((word) => !word.startsWith("--")),
  text: args.join(" "),
  flag: () => undefined,
  cwd: undefined,
});

const later = TestClock.adjust("31 seconds");

describe("keeping current with a teammate's change on another computer", () => {
  it.effect(
    "moves B's change onto a force-pushed version at its next due step, and tells once",
    () =>
      Effect.gen(function* () {
        const w = world();
        w.ana("export const total = 100;\n");
        const b = w.bob(`${ORD11}@origin`);
        const { service, state, logs } = yield* bobsJujutsu();
        yield* seedWork(state);
        const session = sessionIn(b, { task: "t12" });
        yield* service.sessionStart(session);
        const step = () => service.afterStep(stepOf(session, { remainingMs: 15_000 }));

        yield* later;
        assert.isNull(yield* step());
        const fetches = () => logs.filter((entry) => entry.fields.action === "fetch").length;
        assert.strictEqual(fetches(), 1);

        w.ana(THREE_LINES);
        const oldVersion = commitOf(b, "@-");
        // Not due yet: nothing is fetched, nothing moved.
        assert.isNull(yield* step());
        assert.strictEqual(fetches(), 1);
        assert.strictEqual(commitOf(b, "@-"), oldVersion);

        yield* later;
        const text = (yield* step()) ?? "";

        assert.strictEqual(fetches(), 2);
        assert.strictEqual(commitOf(b, "@-"), commitOf(w.bobMain, `"${ORD11}"@origin`));
        assert.notStrictEqual(commitOf(b, "@-"), oldVersion);
        assert.strictEqual(read(b, "order.js"), THREE_LINES);
        assert.strictEqual(read(b, "loyalty.js"), "export const points = 1;\n");
        const ana = changeOf(b, "@-");
        assert.include(text, "ORD-11 moved under you. Ana's agent changed " + ana + ".");
        assert.include(text, "No conflict with your change.");
        assert.include(text, "order.js +1: export const toEuros = (c) => c / 100;");
        assert.include(
          text,
          `Full diff: jj interdiff --from ${oldVersion.slice(0, 8)} --to ${ana}`,
        );
        assert.isAtMost(text.length, 400);
        assert.isTrue(
          logs.some((entry) => entry.event === "jujutsu.told" && entry.fields.kind === "moved"),
        );

        // Said once; the next due step has nothing new.
        yield* later;
        assert.isNull(yield* step());
      }).pipe(run),
  );

  it.effect("fetches three bookmarks a step, the one fetched longest ago first", () =>
    Effect.gen(function* () {
      const w = world();
      const names = ["feature/a", "feature/b", "feature/c", "feature/d"];
      for (const [at, name] of names.entries()) {
        jj(w.main, "new", "main", "-m", name);
        write(w.main, `${at}.js`, `export const n = ${at};\n`);
        jj(w.main, "bookmark", "set", name, "-r", "@");
        jj(w.main, "git", "push", "-b", name);
      }
      // Bob's change sits on all four.
      const b = w.bob("main");
      jj(b, "rebase", "-r", "@", ...names.flatMap((name) => ["-o", `${name}@origin`]));
      const { service, state, logs } = yield* bobsJujutsu();
      yield* seedWork(state);
      const session = sessionIn(b, { task: "t12" });
      yield* service.sessionStart(session);
      const fetches = () => logs.filter((entry) => entry.fields.action === "fetch").length;
      const behind = () =>
        names.filter(
          (name) => commitOf(w.bobMain, `"${name}"@origin`) !== commitOf(w.main, `"${name}"`),
        );

      // Ana rewrites all four and pushes them together.
      for (const [at, name] of names.entries()) {
        jj(w.main, "edit", name);
        write(w.main, `${at}.js`, `export const n = ${at + 10};\n`);
      }
      jj(w.main, "util", "snapshot");
      jj(w.main, "git", "push", ...names.flatMap((name) => ["-b", name]));
      assert.deepStrictEqual(behind(), names);

      // Three of the four are fetched, whichever; the fourth waits for the next due step, which
      // starts with it because it was fetched longest ago.
      yield* later;
      yield* service.afterStep(stepOf(session, { remainingMs: 15_000 }));
      assert.strictEqual(fetches(), 3);
      const waiting = behind();
      assert.lengthOf(waiting, 1);

      yield* later;
      yield* service.afterStep(stepOf(session, { remainingMs: 15_000 }));
      assert.strictEqual(fetches(), 6);
      assert.deepStrictEqual(behind(), []);
    }).pipe(run),
  );

  it.effect("completes a move that conflicts, stores the conflict, and tells the agent", () =>
    Effect.gen(function* () {
      const w = world();
      w.ana("export const total = 100;\n");
      const b = w.bob(`${ORD11}@origin`);
      write(b, "order.js", "export const total = 100; // bob\n");
      const { service, state } = yield* bobsJujutsu();
      yield* seedWork(state);
      const session = sessionIn(b, { task: "t12" });
      yield* service.sessionStart(session);
      const step = () => service.afterStep(stepOf(session, { remainingMs: 15_000 }));
      yield* later;
      assert.isNull(yield* step());

      w.ana("export const total = 100; // ana\n");
      yield* later;
      const text = (yield* step()) ?? "";

      assert.strictEqual(commitOf(b, "@-"), commitOf(w.bobMain, `"${ORD11}"@origin`));
      assert.strictEqual(query(b, "@ & conflicts()", "change_id.short(8)"), changeOf(b, "@"));
      assert.include(text, "ORD-11 moved under you.");
      assert.include(text, "it conflicts in order.js");
      assert.include(text, "Those lines are Ana's: keep your edits in your own change.");
      assert.isAtMost(text.length, 400);
      // The agent keeps working: the next step stops for nothing.
      yield* later;
      assert.isNull(yield* step());
    }).pipe(run),
  );

  it.effect("moves the work onto a Git teammate's new tip itself", () =>
    Effect.gen(function* () {
      const w = world();
      const git = NodePath.join(w.dir, "ana-git");
      exec("git", w.dir, "clone", "--quiet", w.origin, git);
      const commit = (text: string, message: string) => {
        write(git, "order.js", text);
        exec(
          "git",
          git,
          "-c",
          "user.name=Ana",
          "-c",
          "user.email=ana@acme.test",
          "commit",
          "--quiet",
          "-am",
          message,
        );
        exec("git", git, "push", "--quiet", "origin", `HEAD:${ORD11}`);
      };
      commit("export const total = 100;\n", "ORD-11: cents");
      const b = w.bob(`${ORD11}@origin`);
      const { service, state } = yield* bobsJujutsu();
      yield* seedWork(state);
      const session = sessionIn(b, { task: "t12" });
      yield* service.sessionStart(session);
      const step = () => service.afterStep(stepOf(session, { remainingMs: 15_000 }));
      yield* later;
      assert.isNull(yield* step());

      commit(THREE_LINES, "ORD-11: helper");
      yield* later;
      const text = (yield* step()) ?? "";

      assert.strictEqual(commitOf(b, "@-"), commitOf(w.bobMain, `"${ORD11}"@origin`));
      assert.strictEqual(read(b, "order.js"), THREE_LINES);
      assert.include(text, "ORD-11 moved under you.");
      assert.include(text, "order.js +1: export const toEuros");
    }).pipe(run),
  );

  it.effect(
    "tells a rewrite by another agent on this computer at the next step, with no fetch",
    () =>
      Effect.gen(function* () {
        const repo = repository();
        const anaWorkspace = repo.workspace("ORD-11-1a2b3c4d");
        const b = repo.workspace("ORD-12-3f2a1b2c");
        const { service, state, logs } = yield* bobsJujutsu();
        yield* seedWork(state);
        const anaSession = sessionIn(anaWorkspace, { id: "codex:ana", task: "t11" });
        const bobSession = sessionIn(b, { id: "codex:bob", task: "t12" });
        yield* service.sessionStart(anaSession);
        yield* service.sessionStart(bobSession);
        const stepOf2 = (session: PeerSessionView) =>
          service.afterStep(stepOf(session, { remainingMs: 15_000 }));
        write(anaWorkspace, "order.js", "export const total = 100;\n");
        jj(anaWorkspace, "describe", "-m", "ORD-11: cents");
        yield* stepOf2(anaSession);
        jj(b, "new", changeOf(anaWorkspace, "@"), "-m", "ORD-12: loyalty points");
        write(b, "loyalty.js", "export const points = 1;\n");
        assert.isNull(yield* stepOf2(bobSession));

        write(anaWorkspace, "order.js", THREE_LINES);
        yield* stepOf2(anaSession);
        const text = (yield* stepOf2(bobSession)) ?? "";

        assert.strictEqual(read(b, "order.js"), THREE_LINES);
        assert.include(text, "ORD-11 moved under you.");
        assert.include(text, "order.js +1: export const toEuros");
        assert.isAtMost(text.length, 400);
        assert.isFalse(logs.some((entry) => entry.fields.action === "fetch"));
        assert.isNull(yield* stepOf2(bobSession));
      }).pipe(run),
  );

  it.effect("fetches nothing outside a tool step, and nothing in a Git checkout", () =>
    Effect.gen(function* () {
      const w = world();
      const git = NodePath.join(w.dir, "plain");
      NodeFS.mkdirSync(git);
      exec("git", git, "init", "--quiet");
      const { service, state, logs } = yield* bobsJujutsu();
      yield* seedWork(state);
      yield* later;
      assert.isNull(yield* service.afterStep(stepOf(sessionIn(git, { task: "t12" }))));
      yield* service.sweep;
      assert.deepStrictEqual(
        logs.filter((entry) => entry.event === "jujutsu.followed"),
        [],
      );
    }).pipe(run),
  );
});

describe("peer follow", () => {
  /** Bob's agent works on main with a change of its own; Ana's ORD-11 is on the remote only. */
  const setup = Effect.gen(function* () {
    const w = world();
    w.ana("export const total = 100;\n");
    const b = w.bob("main");
    const jujutsu = yield* bobsJujutsu();
    yield* seedWork(jujutsu.state);
    const session = sessionIn(b, { task: "t12" });
    yield* jujutsu.service.sessionStart(session);
    yield* jujutsu.service.afterStep(stepOf(session, { remainingMs: 15_000 }));
    return { w, b, session, command: followCommand(jujutsu.service), ...jujutsu };
  });

  it.effect(
    "moves the work onto the task's bookmark and prints the spec's lines, jj's in the middle",
    () =>
      Effect.gen(function* () {
        const { w, b, session, command } = yield* setup;
        const mine = changeOf(b, "@");

        const out = (yield* command.run(inputOf(session, "ORD-11"))).split("\n");

        const ana = changeOf(w.bobMain, `"${ORD11}"@origin`);
        assert.strictEqual(commitOf(b, "@-"), commitOf(w.bobMain, `"${ORD11}"@origin`));
        assert.strictEqual(
          out[0],
          `Your change ${mine} now builds on ${ana} (ORD-11, Ana · Claude Code).`,
        );
        assert.strictEqual(out[1], "Rebased 1 commits to destination.");
        assert.match(
          out[2]!,
          new RegExp(
            `^Working copy {2}\\(@\\) now at: ${mine} [0-9a-f]{8} .*ORD-12: loyalty points$`,
          ),
        );
        assert.match(
          out[3]!,
          new RegExp(`^Parent commit \\(@-\\) {6}: ${ana} [0-9a-f]{8} .*ORD-11`),
        );
        assert.match(out[4]!, /^Added 0 files, modified 1 files, removed 0 files$/);
        assert.strictEqual(
          out[5],
          `Peer moves it along each time Ana changes ${ana}. Stop with: peer follow --stop`,
        );
        assert.lengthOf(out, 6);
        // Peer's own steps group under one name in the operation log.
        assert.match(
          jj(b, "op", "log", "--no-graph", "--ignore-working-copy", "-n", "1", "-T", "user"),
          /^peer·follow@/,
        );
      }).pipe(run),
  );

  it.effect("counts what it printed as heard, then goes back to trunk with --stop", () =>
    Effect.gen(function* () {
      const { w, b, session, command, service } = yield* setup;
      yield* command.run(inputOf(session, "ORD-11"));
      yield* later;
      assert.isNull(yield* service.afterStep(stepOf(session, { remainingMs: 15_000 })));

      const status = yield* command.run(inputOf(session));
      assert.include(status, "You build on");
      assert.include(status, "(ORD-11, Ana)");
      assert.include(status, "Nothing moved since you last heard.");

      const stopped = (yield* command.run(inputOf(session, "--stop"))).split("\n");
      assert.match(stopped[0]!, /^Your change [k-z]{8} now builds on trunk\.$/);
      assert.strictEqual(commitOf(b, "@-"), commitOf(w.main, "main"));
      assert.strictEqual(
        yield* command.run(inputOf(session)),
        "You build on no teammate's change.",
      );
    }).pipe(run),
  );

  it.effect("ends refused, and changes nothing, for a task with no work with a bookmark", () =>
    Effect.gen(function* () {
      const { b, session, command } = yield* setup;
      const before = jj(b, "op", "log", "--no-graph", "--ignore-working-copy", "-T", "id");

      const failure = yield* command.run(inputOf(session, "ORD-20")).pipe(Effect.flip);

      assert.instanceOf(failure, CliError);
      assert.strictEqual((failure as CliError).outcome, "refused");
      assert.include((failure as CliError).reason, "ORD-20 has no work with a bookmark yet");
      assert.strictEqual(
        jj(b, "op", "log", "--no-graph", "--ignore-working-copy", "-T", "id"),
        before,
      );
    }).pipe(run),
  );

  it.effect("ends refused in a Git worktree", () =>
    Effect.gen(function* () {
      const w = world();
      const git = NodePath.join(w.dir, "plain");
      NodeFS.mkdirSync(git);
      exec("git", git, "init", "--quiet");
      const { service } = yield* bobsJujutsu();

      const failure = yield* followCommand(service)
        .run(inputOf(sessionIn(git), "ORD-11"))
        .pipe(Effect.flip);

      assert.include((failure as CliError).reason, "needs a Jujutsu checkout");
      assert.isFalse(NodeFS.existsSync(NodePath.join(git, ".jj")));
    }).pipe(run),
  );
});

describe("the push notice", () => {
  it.effect(
    "stops a push that carries a teammate's unlanded change once, in the spec's words",
    () =>
      Effect.gen(function* () {
        const w = world();
        w.ana("export const total = 100;\n");
        const b = w.bob(`${ORD11}@origin`);
        const { service, state, logs } = yield* bobsJujutsu();
        yield* seedWork(state);
        const session = sessionIn(b, { task: "t12" });
        yield* service.sessionStart(session);
        yield* service.afterStep(stepOf(session, { remainingMs: 15_000 }));
        const push = {
          ...stepOf(session, { command: "jj git push -b feature/ORD-12-3f2a1b2c" }),
          event: "pre-tool" as const,
        };

        const first = yield* service.pushNotice(push);
        const ana = changeOf(b, "@-");

        assert.strictEqual(
          first,
          `ORD-12 builds on ${ana} (ORD-11), which has not landed, so the push carries both. Open its pull request with --base ${ORD11}. When ORD-11's pull request merges and its branch is deleted, GitHub moves this one onto main. Run the push again to go ahead.`,
        );
        assert.isTrue(
          logs.some((entry) => entry.event === "jujutsu.told" && entry.fields.kind === "push"),
        );
        // The same push again runs, and no other command is read for it.
        assert.isNull(yield* service.pushNotice(push));
        assert.isNull(
          yield* service.pushNotice({ ...push, command: "jj git push -b feature/other" }),
        );
        assert.isNull(
          yield* service.pushNotice({ ...push, command: "git push", event: "pre-tool" }),
        );
        assert.isNull(yield* service.pushNotice({ ...push, event: "post-tool" as never }));
      }).pipe(run),
  );

  it.effect("says nothing when the push carries only the session's own work", () =>
    Effect.gen(function* () {
      const w = world();
      const b = w.bob("main");
      const { service, state } = yield* bobsJujutsu();
      yield* seedWork(state);
      const session = sessionIn(b, { task: "t12" });
      yield* service.sessionStart(session);
      yield* service.afterStep(stepOf(session, { remainingMs: 15_000 }));

      assert.isNull(
        yield* service.pushNotice({
          ...stepOf(session, { command: "jj git push -b feature/ORD-12-3f2a1b2c" }),
          event: "pre-tool",
        }),
      );
    }).pipe(run),
  );
});
