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
import { createGit } from "./client/git.ts";
import {
  git,
  jj,
  jjAvailable,
  serviceFor,
  team,
  useHome,
  write,
} from "./client/jjFixture.testkit.ts";
import { makeShare } from "./share.ts";
import { SHARE_GAP_MS } from "./limits.ts";

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
const remote = (origin: string) =>
  git(origin, "for-each-ref", "refs/peer/wip", "--format=%(refname) %(objectname)");

describe.skipIf(!jjAvailable)("sharing work in progress", () => {
  it.live(
    "pushes a new commit at most every two minutes, and deletes a ref nobody wants any more",
    () =>
      live(
        Effect.gen(function* () {
          const t = team(home.home);
          const vcs = yield* VcsProcess.VcsProcess;
          const client = createGit(vcs, NodePath.join(t.dir, "scratch"));
          yield* client.sweepScratch();
          const repository = yield* client.discoverRepository(t.slavo);
          const logged: string[] = [];
          const share = makeShare(client, (event) => Effect.sync(() => void logged.push(event)));
          const head = () => git(t.slavo, "rev-parse", "HEAD");
          const first = head();
          const want = (commit: string) =>
            new Map([["k", { repository, branch: "feature/ORD-14-aaa", commit }]]);
          yield* share.apply(want(first), 0);
          expect(remote(t.origin)).toBe(`refs/peer/wip/feature/ORD-14-aaa ${first}`);
          write(t.slavo, "more.js", "x\n");
          git(t.slavo, "add", ".");
          git(t.slavo, "commit", "--quiet", "-m", "more");
          const second = head();
          yield* share.apply(want(second), SHARE_GAP_MS - 1);
          expect(remote(t.origin)).toContain(first);
          yield* share.apply(want(first), SHARE_GAP_MS - 1);
          yield* share.apply(want(second), SHARE_GAP_MS);
          expect(remote(t.origin)).toBe(`refs/peer/wip/feature/ORD-14-aaa ${second}`);
          // The same commit is not pushed again.
          const count = logged.length;
          yield* share.apply(want(second), SHARE_GAP_MS * 3);
          expect(logged).toHaveLength(count);
          yield* share.apply(new Map(), SHARE_GAP_MS * 3);
          expect(remote(t.origin)).toBe("");
        }),
      ),
    60_000,
  );

  it.live(
    "shares nothing by default, then follows the session and ends with it, and no jj ever shows a bookmark",
    () =>
      live(
        Effect.gen(function* () {
          const t = team(home.home);
          const tree = t.agent(t.slavo, "ORD-14-aaa");
          write(tree, "order.js", "changed\n");
          jj(tree, "st");
          const commit = jj(tree, "log", "--no-graph", "-r", "@", "-T", "commit_id");
          const local = [{ branch: "feature/ORD-14-aaa" }];
          const { forecast, setThreads, calls } = yield* serviceFor(yield* newState, t.slavo, {
            local,
          });
          yield* forecast.boot;
          yield* forecast.round();
          expect(remote(t.origin)).toBe("");
          expect(calls.some((c) => c.args.includes("push"))).toBe(false);
          expect((yield* forecast.read).shareWip).toBe(false);
          yield* forecast.configure({ shareWip: true });
          expect((yield* forecast.read).shareWip).toBe(true);
          yield* forecast.round();
          expect(remote(t.origin)).toBe(`refs/peer/wip/feature/ORD-14-aaa ${commit}`);
          const push = calls.find((c) => c.args.includes("push"));
          expect(push?.args).toContain("--no-verify");
          expect(push?.args).toContain(`+${commit}:refs/peer/wip/feature/ORD-14-aaa`);
          // Another computer fetches with jj and never sees a bookmark for it.
          const eva = t.clone("eva");
          jj(eva, "git", "fetch");
          expect(jj(eva, "bookmark", "list", "--all")).not.toContain("ORD-14");
          // The session ends: the ref goes with it.
          yield* setThreads({ local: [] });
          yield* forecast.round();
          expect(remote(t.origin)).toBe("");
          // And turning the plugin off deletes what is still shared.
          yield* setThreads({ local });
          yield* forecast.configure({ shareWip: false });
          yield* forecast.configure({ shareWip: true });
          yield* forecast.round();
          expect(remote(t.origin)).toContain(commit);
          yield* forecast.stop;
          expect(remote(t.origin)).toBe("");
          expect(jj(eva, "bookmark", "list", "--all")).not.toContain("ORD-14");
        }),
      ),
    60_000,
  );
});
