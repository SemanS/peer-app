// @effect-diagnostics nodeBuiltinImport:off - real git and jj repositories in a private temporary directory.
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Context from "effect/Context";
import { PeerState } from "../../core/state/PeerState.ts";
import { coreLayer, paymentsSeed, seedState } from "../../core/testkit.ts";
import * as VcsProcess from "../../../vcs/VcsProcess.ts";
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

const newState = Effect.gen(function* () {
  const core = yield* Layer.build(coreLayer(yield* seedState(paymentsSeed("https://hub.invalid"))));
  return Context.get(core, PeerState);
});
const home = useHome();
afterAll(home.restore);
const live = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.scoped,
    Effect.provide(VcsProcess.layer.pipe(Layer.provideMerge(NodeServices.layer))),
  );
const cents = (price: string) =>
  `const rate = 1;\nexport const orderTotal = (price) => {\n  return ${price};\n};\nexport default orderTotal;\n`;
/** Eva's change, shared as a work in progress: a commit under refs/peer/wip, never a bookmark. */
const evaShares = (eva: string, branch: string, at: string, file: string, text: string) => {
  jjAs(eva, "Eva", at, "new", "main", "-m", branch);
  write(eva, file, text);
  jjAs(eva, "Eva", at, "st");
  const commit = jj(eva, "log", "--no-graph", "-r", "@", "-T", "commit_id");
  git(eva, "push", "--quiet", "origin", `${commit}:refs/peer/wip/${branch}`);
  return commit;
};

describe.skipIf(!jjAvailable)("forecast sources in a jj checkout", () => {
  it.live(
    "reports Eva's shared ORD-11 against the live ORD-14 without any new bookmark",
    () =>
      live(
        Effect.gen(function* () {
          const t = team(home.home),
            eva = t.clone("eva");
          evaShares(
            eva,
            "feature/ORD-11-cents",
            "2026-10-01T10:00:00+00:00",
            "order.js",
            cents("Math.round(price * 100)"),
          );
          const tree = t.agent(t.slavo, "ORD-14-aaa");
          write(tree, "order.js", cents("price * rate * 1.2"));
          jj(tree, "st");
          const before = surface(t.slavo);
          const { forecast, git: gitClient } = yield* serviceFor(yield* newState, t.slavo, {
            local: [{ branch: "feature/ORD-14-aaa", task: "t14", harness: "codex" }],
            remote: [{ branch: "feature/ORD-11-cents" }],
          });
          yield* forecast.boot;
          yield* forecast.configure({ teammates: true });
          yield* forecast.round();
          const [pair, ...others] = (yield* forecast.read).pairs;
          expect(others).toEqual([]);
          expect(pair?.files).toEqual(["order.js"]);
          expect(pair?.a).toMatchObject({ where: "here", source: "live", agent: "codex" });
          expect(pair?.a.changeId).toMatch(/^[k-z]{8}$/);
          expect(pair?.b).toMatchObject({ where: "origin", source: "shared" });
          expect(pair?.b.readAt).toBeDefined();
          // ORD-14 was started after Eva's change, so its person resolves.
          expect(pair?.later).toBe("a");
          expect(pair?.lines?.file).toBe("order.js");
          expect(pair?.lines?.a).toContain("1.2");
          expect(pair?.lines?.b).toContain("Math.round");
          expect(surface(t.slavo)).toEqual(before);
          expect(git(t.slavo, "for-each-ref", "refs/peer/forecast/wip")).toContain(
            "refs/peer/forecast/wip/feature/ORD-11-cents",
          );
          expect(jj(t.slavo, "--ignore-working-copy", "bookmark", "list", "--all")).not.toContain(
            "ORD-11",
          );
          void gitClient;
        }),
      ),
    60_000,
  );

  it.live(
    "falls back to a pushed bookmark when nothing is shared, and pairs two teammates for the preview",
    () =>
      live(
        Effect.gen(function* () {
          const t = team(home.home),
            ana = t.clone("ana"),
            bob = t.clone("bob");
          jjAs(ana, "Ana", "2026-10-01T10:00:00+00:00", "new", "main", "-m", "ORD-11");
          write(ana, "order.js", cents("Math.round(price * 100)"));
          jj(ana, "bookmark", "create", "feature/ORD-11-cents", "-r", "@");
          jj(ana, "git", "push", "-b", "feature/ORD-11-cents");
          evaShares(
            bob,
            "feature/ORD-14-vat",
            "2026-10-02T10:00:00+00:00",
            "order.js",
            cents("price * 1.2"),
          );
          // Nothing of this person's own runs here: the preview still pairs the two teammates.
          const { forecast } = yield* serviceFor(yield* newState, t.slavo, {
            local: [],
            remote: [
              { branch: "feature/ORD-11-cents", email: "ana@acme.test" },
              { branch: "feature/ORD-14-vat", email: "bob@acme.test" },
            ],
          });
          yield* forecast.boot;
          yield* forecast.configure({ teammates: true });
          yield* forecast.round();
          const [pair] = (yield* forecast.read).pairs;
          expect(pair?.files).toEqual(["order.js"]);
          expect([pair?.a.source, pair?.b.source].toSorted()).toEqual(["pushed", "shared"]);
          const pushed = pair?.a.source === "pushed" ? pair.a : pair?.b;
          expect(pushed?.branch).toBe("feature/ORD-11-cents");
          // The later change is Bob's, started a day after Ana's.
          expect(pair?.later === "a" ? pair.a.branch : pair?.b.branch).toBe("feature/ORD-14-vat");
          // The notices to agents keep one side on this computer.
          expect(yield* forecast.pairs).toHaveLength(1);
          expect(
            (yield* forecast.pairs).filter(
              (p) => p.left.where === "here" || p.right.where === "here",
            ),
          ).toEqual([]);
        }),
      ),
    60_000,
  );

  it.live(
    "shows what ORD-12 inherits from ORD-11 once, on the pair of the change it comes from",
    () =>
      live(
        Effect.gen(function* () {
          const t = team(home.home);
          const one = t.agent(t.slavo, "ORD-11-aaa");
          write(one, "order.js", cents("Math.round(price * 100)"));
          jj(one, "st");
          const twoPath = NodePath.join(t.dir, "trees", "ORD-12-bbb");
          jj(
            t.slavo,
            "workspace",
            "add",
            "--colocate",
            "--name",
            "ORD-12-bbb",
            "-r",
            "ORD-11-aaa@",
            twoPath,
          );
          jj(twoPath, "bookmark", "create", "feature/ORD-12-bbb", "-r", "@");
          write(twoPath, "loyalty.js", "export const points = (euros) => Math.floor(euros);\n");
          jj(twoPath, "st");
          const four = t.agent(t.slavo, "ORD-14-ccc");
          write(four, "order.js", cents("price * rate * 1.2"));
          jj(four, "st");
          const { forecast } = yield* serviceFor(yield* newState, t.slavo, {
            local: ["ORD-11-aaa", "ORD-12-bbb", "ORD-14-ccc"].map((n) => ({
              branch: `feature/${n}`,
              task: n.slice(0, 6),
            })),
          });
          yield* forecast.boot;
          yield* forecast.round();
          const pairs = (yield* forecast.read).pairs;
          const between = (x: string, y: string) =>
            pairs.find((p) => [p.a.branch, p.b.branch].sort().join() === [x, y].sort().join());
          expect(pairs).toHaveLength(2);
          expect(
            between("feature/ORD-11-aaa", "feature/ORD-14-ccc")?.inheritedFrom,
          ).toBeUndefined();
          const stacked = between("feature/ORD-12-bbb", "feature/ORD-14-ccc");
          expect(stacked?.inheritedFrom).toMatchObject({ branch: "feature/ORD-11-aaa" });
          const side = stacked?.inheritedFrom?.side;
          expect(side === "a" ? stacked?.a.branch : stacked?.b.branch).toBe("feature/ORD-12-bbb");
        }),
      ),
    60_000,
  );
});
