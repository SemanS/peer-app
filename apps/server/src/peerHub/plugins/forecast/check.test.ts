// @effect-diagnostics nodeBuiltinImport:off - real git and jj repositories in a private temporary directory.
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { makeChecks } from "./check.ts";
import { CHECK_GAP_MS } from "./limits.ts";
import type { JjClient } from "./client/jj.ts";
import * as VcsProcess from "../../../vcs/VcsProcess.ts";
import { createGit } from "./client/git.ts";
import { createJj } from "./client/jj.ts";
import {
  git,
  jj,
  jjAs,
  jjAvailable,
  serviceFor,
  surface,
  team,
  useHome,
  write,
} from "./client/jjFixture.testkit.ts";

const home = useHome();
afterAll(home.restore);
const live = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.scoped,
    Effect.provide(VcsProcess.layer.pipe(Layer.provideMerge(NodeServices.layer))),
  );
/** Loyalty points are the order total in euros rounded down; the test pins that. */
const MAIN = {
  "order.js": "exports.orderTotal = (euros) => euros;\n",
  "loyalty.js":
    'const { orderTotal } = require("./order.js");\nexports.points = (euros) => Math.floor(orderTotal(euros));\n',
  "test.js":
    'const { points } = require("./loyalty.js");\nconst got = points(12.5);\nif (got !== 12) {\n  console.log(`✖ loyalty points: 12.50 € gives ${got} points, expected 12`);\n  process.exit(1);\n}\nconsole.log("ok");\n',
};
const COMMAND = "node test.js";

/** Ana makes orderTotal return cents and shares it; Bob's own change sits on main. */
function hiddenDependency() {
  const t = team(home.home, MAIN),
    ana = t.clone("ana");
  jjAs(ana, "Ana", "2026-10-01T10:00:00+00:00", "new", "main", "-m", "cents");
  write(ana, "order.js", "exports.orderTotal = (euros) => Math.round(euros * 100);\n");
  jjAs(ana, "Ana", "2026-10-01T10:00:00+00:00", "st");
  const anaCommit = jj(ana, "log", "--no-graph", "-r", "@", "-T", "commit_id");
  git(ana, "push", "--quiet", "origin", `${anaCommit}:refs/peer/wip/feature/ORD-11-cents`);
  const tree = t.agent(t.slavo, "ORD-12-bbb");
  write(tree, "notes.txt", "Bob's own work\n");
  jj(tree, "st");
  return { t, anaCommit, bobCommit: jj(tree, "log", "--no-graph", "-r", "@", "-T", "commit_id") };
}

describe.skipIf(!jjAvailable)("checks on a clean merge in a jj checkout", () => {
  it.live(
    "fails with the test's own words, leaves every workspace, change and bookmark as it was, and logs as peer·check",
    () =>
      live(
        Effect.gen(function* () {
          const { t, anaCommit, bobCommit } = hiddenDependency();
          const vcs = yield* VcsProcess.VcsProcess,
            client = createGit(vcs, NodePath.join(t.dir, "scratch")),
            tools = createJj(vcs, client);
          yield* client.sweepScratch();
          const repository = yield* client.discoverRepository(t.slavo);
          // Ana's commit is a Git object under a private ref, which jj does not know.
          git(t.slavo, "fetch", "--quiet", "origin", "+refs/peer/wip/*:refs/peer/forecast/wip/*");
          const before = surface(t.slavo);
          const failed = yield* tools.check(t.slavo, repository, [bobCommit, anaCommit], COMMAND);
          expect(failed.state).toBe("fails");
          expect(failed.output).toContain(
            "✖ loyalty points: 12.50 € gives 1250 points, expected 12",
          );
          expect(surface(t.slavo)).toEqual(before);
          expect(git(t.slavo, "tag", "--list")).toBe("");
          expect(jj(t.slavo, "--ignore-working-copy", "tag", "list")).toBe("");
          const users = jj(t.slavo, "--ignore-working-copy", "op", "log", "-T", 'user ++ "\\n"');
          expect(users).toContain("peer·check@");
          // The same pair with a command that passes, and one that takes too long.
          expect(
            (yield* tools.check(t.slavo, repository, [bobCommit, anaCommit], "true")).state,
          ).toBe("passed");
          const slow = yield* tools.check(
            t.slavo,
            repository,
            [bobCommit, anaCommit],
            "sleep 20",
            1500,
          );
          expect(slow.state).toBe("timedOut");
          expect(surface(t.slavo)).toEqual(before);
          const bad = yield* tools.check(t.slavo, repository, ["a".repeat(40), bobCommit], "true");
          expect(bad.state).toBe("couldNotRead");
          expect(surface(t.slavo)).toEqual(before);
        }),
      ),
    120_000,
  );

  it.live(
    "shows 'Merges clean' with 'Check fails' on the pair, once per change of commits, and never stops a step",
    () =>
      live(
        Effect.gen(function* () {
          const { t } = hiddenDependency();
          const { forecast, calls } = yield* serviceFor(t.slavo, {
            local: [{ branch: "feature/ORD-12-bbb" }],
            remote: [{ branch: "feature/ORD-11-cents", email: "ana@acme.test" }],
          });
          yield* forecast.boot;
          yield* forecast.configure({ teammates: true, check: COMMAND, shareWip: false });
          expect((yield* forecast.read).check).toBe(COMMAND);
          yield* forecast.round();
          // Without a result a clean pair is no news.
          expect((yield* forecast.read).pairs).toEqual([]);
          yield* Effect.forkScoped(forecast.run);
          const checked = yield* forecast.changes.pipe(
            Stream.filter((status) => status.pairs.some((p) => p.check !== undefined)),
            Stream.take(1),
            Stream.runCollect,
            Effect.timeout("90 seconds"),
          );
          const pair = checked[0]!.pairs[0]!;
          expect(pair.files).toEqual([]);
          expect(pair.check?.state).toBe("fails");
          expect(pair.check?.output).toContain("gives 1250 points, expected 12");
          expect(pair.check?.commits).toHaveLength(2);
          expect(pair.later).toBe("a");
          const runs = () => calls.filter((c) => c.args.includes("run")).length;
          expect(runs()).toBe(1);
          yield* forecast.round();
          yield* forecast.round();
          expect(runs()).toBe(1);
          // A check is advice: nothing of it reaches a session's notices.
          expect((yield* forecast.pairs).every((p) => p.result?.state === "clean")).toBe(true);
        }),
      ),
    180_000,
  );

  it.effect("runs a pair again only when a side moved, at most once a minute, one at a time", () =>
    Effect.gen(function* () {
      const ran: string[] = [];
      const fake = {
        check: (_cwd: string, _repository: unknown, commits: ReadonlyArray<string>) =>
          Effect.sync(() => {
            ran.push(commits.join("/"));
            return { state: "passed" as const };
          }),
      } as unknown as JjClient;
      const checks = yield* makeChecks(
        fake,
        () => Effect.void,
        () => Effect.void,
      );
      const job = (a: string) => ({
        key: "pair",
        cwd: "/x",
        repository: { common: "c", objects: "o" },
        commits: [a, "b"] as const,
      });
      yield* checks.consider([job("a1")], 0);
      yield* checks.drain;
      expect(ran).toEqual([]);
      yield* checks.setCommand("npm test");
      yield* checks.consider([job("a1")], 0);
      yield* checks.drain;
      yield* checks.consider([job("a1")], CHECK_GAP_MS * 2);
      yield* checks.drain;
      expect(ran).toEqual(["a1/b"]);
      yield* checks.consider([job("a2")], CHECK_GAP_MS - 1);
      yield* checks.drain;
      expect(ran).toEqual(["a1/b"]);
      yield* checks.consider([job("a2")], CHECK_GAP_MS);
      yield* checks.drain;
      expect(ran).toEqual(["a1/b", "a2/b"]);
      expect(checks.resultOf("pair")?.commits).toEqual(["a2", "b"]);
      yield* checks.setCommand("npm run other");
      expect(checks.resultOf("pair")).toBeUndefined();
    }),
  );
});
