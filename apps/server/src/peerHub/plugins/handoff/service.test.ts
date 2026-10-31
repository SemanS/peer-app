// @effect-diagnostics preferSchemaOverJson:off nodeBuiltinImport:off - fake Hub and gh wire fixtures, a git checkout.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import * as Schema from "effect/Schema";
import { PeerHandoffPackage, type PeerTask, type PeerWorkThread } from "@t3tools/contracts";
import fixture from "../../../../../../packages/contracts/src/peer/handoff.fixture.json" with { type: "json" };
import * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
import {
  coreLayer,
  meAnswer,
  paymentsSeed,
  seedState,
  standInHub,
  type HubCall,
} from "../../core/testkit.ts";
import * as PeerWork from "../../core/work/PeerWork.ts";
import * as PeerPlugins from "../../core/plugins/PeerPlugins.ts";
import * as PeerStatus from "../../core/status/PeerStatus.ts";
import * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import { HandoffService, make } from "./service.ts";
import { handoffCommand } from "./cli.ts";
import { brokerFixture } from "../../core/broker/testkit.ts";
import { NO_PLUGINS } from "../../core/broker/host.ts";
import { adapter, GhError, GhWrite, type Run } from "./client/ghWrite.ts";
import { replyLines } from "./render.ts";
import type { PeerSessionView } from "../../core/plugin.ts";
const pack = {
  ...Schema.decodeUnknownSync(PeerHandoffPackage)(fixture),
  project: "pay",
  task: "krk-1",
};
const place = { workspace: "acme", projectId: "pay", taskId: "krk-1" };
const task: PeerTask = {
  id: "krk-1",
  key: "KRK-1",
  title: "DNS",
  status: "open",
  createdAt: "",
  updatedAt: "",
  createdBy: "ana",
};
const thread: PeerWorkThread = {
  id: "peer:thread-1",
  task: "krk-1",
  title: "DNS",
  email: "ana@acme.test",
  source: "peer",
  environment: "ana-laptop",
  status: "idle",
  seenAt: "",
  repository: "api",
  branch: "feature/dns",
  pullRequests: [{ url: pack.pullRequests[0]!, state: "open", headBranch: "feature/dns" }],
};
const coordination = {
  enabled: false,
  policy: "coordinate" as const,
  claudeHooks: false,
  logPath: "",
  sessions: [],
  overlaps: [],
  findings: [],
  contexts: [],
  candidates: [],
};
const setup = (run: Run, prs = 1, features?: Readonly<Record<string, number>>) =>
  Effect.gen(function* () {
    let broken = false,
      present = false,
      changed = true,
      current = task,
      github = true,
      hasThread = true;
    let shared = pack;
    let calls: ReadonlyArray<HubCall> = [];
    const hub = yield* standInHub({
      current: () => {
        const request = calls.at(-1)!;
        if (request.url === "/v1/me") return [200, meAnswer(features)];
        if (broken) return [503, { error: { code: "unavailable", message: "down" } }];
        if (request.method === "POST") {
          present = true;
          const sent = JSON.parse(request.body || "{}") as { delivery?: unknown };
          const value = {
            package: {
              ...shared,
              ...(sent.delivery === undefined ? {} : { delivery: sent.delivery }),
            },
            changed,
          };
          changed = false;
          return [200, value];
        }
        if (request.method === "DELETE") {
          const removed = present;
          present = false;
          return [200, { removed }];
        }
        if (request.url?.endsWith("/handoffs")) return [200, { summaries: [] }];
        return [200, { packages: present ? [shared] : [] }];
      },
    });
    calls = hub.calls;
    const core = yield* Layer.build(
      coreLayer(yield* seedState(paymentsSeed(hub.url).replace("acme/api.git", "acme/app.git")), {
        session: "s",
        plugins: [],
      }),
    );
    const originals = yield* Effect.gen(function* () {
      yield* (yield* PeerStatus.PeerStatus).coordinationFrom(() => Effect.succeed(coordination));
      return {
        work: yield* PeerWork.PeerWork,
        plugins: yield* PeerPlugins.PeerPlugins,
        agents: yield* PeerAgents.PeerAgents,
      };
    }).pipe(Effect.provide(core));
    const logs: Array<{ event: string; fields: Readonly<Record<string, unknown>> }> = [];
    const w = {
      ...originals.work,
      tasks: () => Effect.succeed([current]),
      threads: () =>
        Effect.succeed(
          hasThread
            ? [
                {
                  ...thread,
                  pullRequests: Array.from({ length: prs }, (_, i) => ({
                    url: `https://github.com/acme/app/pull/${118 + i}`,
                    state: "open" as const,
                    headBranch: "feature/dns",
                  })),
                },
              ]
            : [],
        ),
      updateTask: () =>
        Effect.gen(function* () {
          current = { ...current, status: "review" };
          return yield* (yield* PeerStatus.PeerStatus).publish;
        }).pipe(Effect.provide(core)),
    };
    let c = Context.add(core, PeerWork.PeerWork, w);
    c = Context.add(c, PeerPlugins.PeerPlugins, {
      ...originals.plugins,
      isActive: () => Effect.sync(() => github),
    });
    c = Context.add(c, PeerAgents.PeerAgents, {
      ...originals.agents,
      log: (event, fields) =>
        Effect.sync(() => {
          logs.push({ event, fields });
        }),
    });
    const own = yield* Layer.build(Layer.effect(HandoffService, make)).pipe(
      Effect.provide(Context.add(c, GhWrite, adapter(run))),
    );
    return {
      me: PeerHubClient.PeerHubClient.pipe(
        Effect.flatMap((client) => client.me),
        Effect.provide(core),
      ),
      setPackage: (next: typeof pack) => {
        shared = next;
        changed = true;
      },
      service: Context.get(own, HandoffService),
      advanceContext: () => {
        shared = { ...pack, number: 3, context: { ...pack.context!, version: 8 } };
        changed = true;
      },
      newComputer: Layer.build(Layer.effect(HandoffService, make)).pipe(
        Effect.provide(Context.add(c, GhWrite, adapter(run))),
        Effect.map((own) => Context.get(own, HandoffService)),
      ),
      command: handoffCommand(w, originals.agents, Context.get(own, HandoffService)),
      setGithub: (on: boolean) => {
        github = on;
      },
      setTask: (status: PeerTask["status"], thread = true) => {
        current = { ...current, status };
        hasThread = thread;
      },
      calls,
      logs,
      break: () => {
        broken = true;
      },
      task: () => current,
    };
  });
/** A fake `gh` over one pull request: its description, and the comments of its author, Ana. */
const github = (initial: string) => {
  const pr = { body: initial };
  const comments: Array<{ id: number; login: string; body: string }> = [];
  const writes: Array<{ args: ReadonlyArray<string>; body?: string }> = [];
  let next = 1;
  const run: Run = (args, input) =>
    Effect.sync(() => {
      writes.push({ args, ...(input ? { body: input } : {}) });
      if (args[0] === "repo") return "PRIVATE";
      if (args[0] === "pr" && args[1] === "list") return "[]";
      if (args[0] === "pr" && args[1] === "view")
        return JSON.stringify({ body: pr.body, state: "OPEN" });
      if (args[0] === "pr" && args[1] === "edit") {
        pr.body = input!;
        return "";
      }
      if (args[0] === "pr" && args[1] === "comment") {
        comments.push({ id: next++, login: "ana", body: input! });
        return "";
      }
      if (args[1] === "user") return "ana";
      if (args.includes("--paginate")) return comments.map((c) => JSON.stringify(c)).join("\n");
      const method = args[2];
      const id = Number(args[3]?.split("/").at(-1));
      if (method === "DELETE") {
        const index = comments.findIndex((c) => c.id === id);
        comments.splice(index, 1);
        return "";
      }
      if (method === "PATCH") {
        comments.find((c) => c.id === id)!.body = (JSON.parse(input!) as { body: string }).body;
        return "";
      }
      return "";
    });
  return { run, pr, comments, writes, nextId: () => next++ };
};
describe("review package publication", () => {
  it.effect(
    "stores first, defaults to one own comment, repeats quietly, supports description opt-in and withdrawal",
    () =>
      Effect.gen(function* () {
        const { run, pr, comments, writes, nextId } = github("author description");
        const s = yield* setup(run);
        const first = yield* s.service.handOff(place);
        assert.strictEqual(s.task().status, "review");
        assert.strictEqual(first.targets[0]?.kind, "written");
        assert.isFalse(first.notices.some((notice) => notice.includes("not on github.com")));
        assert.isTrue(
          writes.some((write) =>
            write.args.join(" ").includes("pr list --repo acme/app --head feature/dns"),
          ),
        );
        assert.strictEqual(comments.length, 1);
        assert.strictEqual(pr.body, "author description");
        assert.strictEqual((yield* s.service.snapshot).target, "comment");
        const repeat = yield* s.service.handOff(place);
        assert.strictEqual(repeat.targets[0]?.kind, "current");
        assert.strictEqual(comments.length, 1);
        comments.push({ ...comments[0]!, id: nextId() });
        yield* s.service.handOff(place);
        assert.strictEqual(comments.length, 1);
        const refusal = yield* s.service.setTarget({ target: "description" }).pipe(Effect.result);
        assert.strictEqual(refusal._tag, "Failure");
        yield* s.service.setTarget({ ...place, target: "description" });
        yield* s.service.handOff(place);
        assert.include(pr.body, "<!-- peer:handoff -->");
        const removed = yield* s.service.withdraw(place);
        assert.strictEqual(pr.body, "author description");
        assert.strictEqual(comments.length, 0);
        assert.strictEqual(removed.targets[0]?.kind, "removed");
        assert.strictEqual(s.task().status, "review");
        assert.strictEqual((yield* s.service.withdraw(place).pipe(Effect.result))._tag, "Failure");
        assert.isTrue(
          s.logs.every(
            (l) =>
              !JSON.stringify(l).includes("empty AAAA") &&
              !JSON.stringify(l).includes("they rename"),
          ),
        );
        const count = writes.length;
        yield* s.service.setTarget({ target: "none" });
        const none = yield* s.service.handOff(place);
        assert.include(none.notices, "Kept in Peer only.");
        assert.strictEqual(writes.length, count);
        s.break();
        const failed = yield* s.service.handOff(place);
        assert.isFalse(failed.stored);
        assert.strictEqual(writes.length, count);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
  it.effect("Withdraw gives the description back exactly as it was before the first write", () =>
    Effect.gen(function* () {
      const { run, pr } = github("");
      const s = yield* setup(run);
      yield* s.service.setTarget({ ...place, target: "description" });
      for (const original of [
        "",
        "Fixes the resolver.",
        "Fixes the resolver.\n",
        "Fixes it.\n\n",
      ]) {
        pr.body = original;
        yield* s.service.handOff(place);
        assert.include(pr.body, "<!-- peer:handoff -->");
        assert.isTrue(pr.body.startsWith(original));
        yield* s.service.withdraw(place);
        assert.strictEqual(pr.body, original);
      }
      pr.body = "Fixes the resolver.";
      yield* s.service.handOff(place);
      pr.body = `Title\n\n${pr.body}\n\nReviewer notes`;
      yield* s.service.withdraw(place);
      assert.strictEqual(pr.body, "Title\n\nFixes the resolver.\n\nReviewer notes");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
  it.effect(
    "a target switch leaves the earlier copy where it is and says so, and Withdraw removes both",
    () =>
      Effect.gen(function* () {
        const { run, pr, comments } = github("Fixes the resolver.");
        const s = yield* setup(run);
        const inComment =
          "An earlier copy is still a comment on #118. Withdraw removes both copies.";
        const inDescription =
          "An earlier copy is still in the description of #118. Withdraw removes both copies.";
        const first = yield* s.service.handOff(place);
        assert.strictEqual(comments.length, 1);
        assert.deepStrictEqual(first.notices, []);

        yield* s.service.setTarget({ ...place, target: "description" });
        const toDescription = yield* s.service.handOff(place);
        assert.include(pr.body, "<!-- peer:handoff -->");
        assert.strictEqual(comments.length, 1);
        assert.deepStrictEqual(toDescription.notices, [inComment]);
        assert.include(replyLines(toDescription), inComment);
        const again = yield* s.service.handOff(place);
        assert.strictEqual(again.targets[0]?.kind, "current");
        assert.deepStrictEqual(again.notices, [inComment]);

        yield* s.service.setTarget({ ...place, target: "comment" });
        const toComment = yield* s.service.handOff(place);
        assert.include(pr.body, "<!-- peer:handoff -->");
        assert.strictEqual(comments.length, 1);
        assert.deepStrictEqual(toComment.notices, [inDescription]);
        assert.deepStrictEqual((yield* s.service.snapshot).deliveries[0]?.notices, [inDescription]);

        const out = yield* s.service.withdraw(place);
        assert.strictEqual(pr.body, "Fixes the resolver.");
        assert.strictEqual(comments.length, 0);
        assert.deepStrictEqual(
          out.targets.map((t) => [t.kind, t.reason]),
          [["removed", "description block and comment removed"]],
        );
        assert.strictEqual(s.task().status, "review");

        const fresh = yield* s.service.handOff(place);
        assert.deepStrictEqual(fresh.notices, []);
        assert.strictEqual(comments.length, 1);
        assert.strictEqual(pr.body, "Fixes the resolver.");
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
  it.effect("a check for an earlier copy that fails never changes what was written", () =>
    Effect.gen(function* () {
      const { run, pr } = github("Fixes the resolver.");
      const s = yield* setup((args, input) =>
        args.includes("--paginate")
          ? Effect.fail(new GhError("GitHub CLI failed"))
          : run(args, input),
      );
      yield* s.service.setTarget({ ...place, target: "description" });
      const out = yield* s.service.handOff(place);
      assert.strictEqual(out.targets[0]?.kind, "written");
      assert.include(pr.body, "<!-- peer:handoff -->");
      assert.deepStrictEqual(out.notices, []);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
  it.effect("Withdraw deletes the comment even when the description's markers are damaged", () =>
    Effect.gen(function* () {
      const { run, pr, comments } = github("Fixes the resolver.");
      const s = yield* setup(run);
      yield* s.service.handOff(place);
      const damaged = "Fixes the resolver.\n\n<!-- peer:handoff -->\nhalf a block";
      pr.body = damaged;
      const out = yield* s.service.withdraw(place);
      assert.strictEqual(comments.length, 0);
      assert.strictEqual(pr.body, damaged);
      assert.strictEqual(out.targets[0]?.kind, "failed");
      assert.include(out.targets[0]?.reason, "damaged markers");
      assert.include(out.notices, "Own handoff package withdrawn; task status unchanged.");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
  it.effect(
    "bounds a stuck GitHub publish with the TestClock and returns stored/not-finished",
    () =>
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        const run: Run = (args) =>
          args[1] === "list"
            ? Effect.succeed("[]")
            : Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never));
        const s = yield* setup(run);
        const f = yield* s.service.handOff(place).pipe(Effect.forkChild);
        yield* Deferred.await(started);
        yield* TestClock.adjust("10 seconds");
        const result = yield* Fiber.join(f);
        assert.isTrue(result.stored);
        assert.strictEqual(result.targets[0]?.kind, "not-finished");
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
  it.effect(
    "refuses finished/unowned tasks, keeps local packages when github is off and clears status on reset",
    () =>
      Effect.gen(function* () {
        let calls = 0;
        const s = yield* setup(() =>
          Effect.sync(() => {
            calls++;
            return "";
          }),
        );
        s.setTask("done");
        assert.strictEqual((yield* s.service.handOff(place).pipe(Effect.result))._tag, "Failure");
        s.setTask("open", false);
        assert.strictEqual((yield* s.service.handOff(place).pipe(Effect.result))._tag, "Failure");
        assert.strictEqual(s.calls.length, 0);
        s.setTask("open");
        s.setGithub(false);
        assert.isTrue((yield* s.service.handOff(place)).stored);
        assert.strictEqual(calls, 0);
        assert.strictEqual((yield* s.service.snapshot).summaries.length, 1);
        yield* s.service.reset;
        assert.strictEqual((yield* s.service.snapshot).summaries.length, 0);
        assert.strictEqual((yield* s.service.read(place)).length, 1);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
  it.effect(
    "Claude and Codex run real review then read and withdraw through the same service",
    () =>
      Effect.gen(function* () {
        const comments: string[] = [];
        const s = yield* setup((args, body) =>
          Effect.sync(() => {
            if (args[0] === "repo") return "PUBLIC";
            if (args[1] === "list") return "[]";
            if (args[1] === "view") return '{"body":"unchanged","state":"OPEN"}';
            if (args[1] === "user") return "ana";
            if (args.includes("--paginate"))
              return comments
                .map((body, i) => JSON.stringify({ id: i + 1, login: "ana", body }))
                .join("\n");
            if (args[1] === "comment") comments.push(body!);
            if (args[2] === "DELETE") comments.length = 0;
            if (args[2] === "PATCH")
              comments[Number(args[3]?.split("/").at(-1)) - 1] = (
                JSON.parse(body!) as { body: string }
              ).body;
            return "";
          }),
        );
        let finished = 0;
        const f = yield* Effect.acquireRelease(
          Effect.promise(() =>
            brokerFixture(() => ({
              placeOf: async (root) => ({ workspace: "acme", project: "pay", root }),
              taskOf: () => "krk-1",
              finishTask: async () => {
                finished++;
              },
              plugins: async () => ({
                ...NO_PLUGINS,
                active: [
                  {
                    id: "handoff",
                    title: "Handoff",
                    contributions: {
                      afterReview: ({ session, remainingMs }) =>
                        s.service.afterReview(session, remainingMs),
                    },
                  },
                ],
                commands: [{ plugin: "handoff", command: s.command }],
              }),
            })),
          ),
          (f) => Effect.promise(() => f.dispose()),
        );
        yield* Effect.promise(() => f.register("claude"));
        yield* Effect.promise(() =>
          f.broker["sessionFor"]("codex", { session_id: "codex", cwd: f.root }, undefined),
        );
        for (const session of ["claude:claude", "codex:codex"]) {
          const reply = yield* Effect.promise(() =>
            f.broker["runCli"]("review", [], { "x-peer-session": session }),
          );
          assert.isTrue(
            reply.startsWith("Task moved to review with current shared input versions."),
          );
          assert.include(reply, "Handoff package #2");
        }
        assert.strictEqual(finished, 2);
        assert.strictEqual(comments.length, 1);
        assert.notInclude(comments[0]!, "empty AAAA");
        s.advanceContext();
        const secondComputer = yield* s.newComputer;
        const changed = yield* secondComputer.handOff(place);
        assert.strictEqual(changed.targets[0]?.kind, "written");
        assert.strictEqual(comments.length, 1);
        assert.include(comments[0]!, "v8");
        const read = yield* Effect.promise(() =>
          f.broker["runCli"]("handoff", ["KRK-1"], { "x-peer-session": "claude:claude" }),
        );
        assert.include(read, "<shared-context>");
        const out = yield* Effect.promise(() =>
          f.broker["runCli"]("handoff", ["withdraw"], { "x-peer-session": "claude:claude" }),
        );
        assert.include(out, "withdrawn");
        assert.strictEqual(comments.length, 0);
        assert.strictEqual(
          (yield* Effect.tryPromise(() =>
            f.broker["runCli"]("handoff", ["withdraw"], { "x-peer-session": "claude:claude" }),
          ).pipe(Effect.result))._tag,
          "Failure",
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
  it.effect("seven PRs write at most five concurrently and a retry finishes the remainder", () =>
    Effect.gen(function* () {
      let started = yield* Deferred.make<void>();
      let active = 0,
        max = 0;
      const bodies = new Map<string, string>();
      const run: Run = (args, body) => {
        if (args[1] === "list") return Effect.succeed("[]");
        if (args[0] === "repo") return Effect.succeed("PRIVATE");
        if (args[1] === "view")
          return Effect.gen(function* () {
            yield* Deferred.succeed(started, undefined);
            active++;
            max = Math.max(max, active);
            yield* Effect.sleep("1 second");
            active--;
            return JSON.stringify({ body: bodies.get(args[2]!) ?? "", state: "OPEN" });
          });
        if (args[1] === "edit")
          return Effect.sync(() => {
            bodies.set(args[2]!, body!);
            return "";
          });
        return Effect.succeed("");
      };
      const s = yield* setup(run, 7);
      yield* s.service.setTarget({ ...place, target: "description" });
      const first = yield* s.service.handOff(place).pipe(Effect.forkChild);
      yield* Deferred.await(started);
      yield* TestClock.adjust("4 seconds");
      const result = yield* Fiber.join(first);
      assert.strictEqual(bodies.size, 5);
      assert.strictEqual(result.targets.filter((t) => t.kind === "not-finished").length, 2);
      assert.isAtMost(max, 3);
      started = yield* Deferred.make<void>();
      const repeat = yield* s.service.handOff(place).pipe(Effect.forkChild);
      yield* Deferred.await(started);
      yield* TestClock.adjust("4 seconds");
      yield* Fiber.join(repeat);
      assert.strictEqual(bodies.size, 7);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
  it.effect.each([3, 2])(
    "peer review observes the delivery for a Hub at handoff revision %s and says it with the policy",
    (revision) =>
      Effect.gen(function* () {
        const root = NodeFS.realpathSync(
          NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "peer-hf-")),
        );
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => NodeFS.rmSync(root, { recursive: true, force: true })),
        );
        const git = (...args: Array<string>) =>
          NodeChildProcess.execFileSync("git", args, { cwd: root, stdio: "pipe" });
        git("init", "-b", "feature/dns");
        NodeFS.mkdirSync(NodePath.join(root, "types"));
        NodeFS.writeFileSync(NodePath.join(root, "types/concurrency.ts"), "export {}\n");
        const s = yield* setup(
          (args) => Effect.succeed(args[0] === "repo" ? "PRIVATE" : args[1] === "list" ? "[]" : ""),
          1,
          { handoff: revision },
        );
        yield* s.me;
        s.setGithub(false);
        s.setPackage({
          ...pack,
          policy: { mode: "auto", version: 2, signals: ["not-delivered"], accepted: false },
        });
        const local = new Map<string, unknown>();
        const session = {
          id: "claude:a",
          workspace: "acme",
          project: "pay",
          task: "krk-1",
          root,
          cwd: root,
          files: ["types/concurrency.ts"],
          local: <S>(plugin: string, init: () => S) => {
            if (!local.has(plugin)) local.set(plugin, init());
            return local.get(plugin) as S;
          },
        } as unknown as PeerSessionView;
        const facts = yield* s.service.reviewFacts(session, 3000);
        const lines = yield* s.service.afterReview(session, 5000);
        const composed = s.calls.findLast((c) => c.method === "POST")!;
        if (revision >= 3) {
          assert.strictEqual(facts.delivery?.state, "none");
          assert.deepStrictEqual(facts.delivery?.evidence.untracked, ["types/concurrency.ts"]);
          assert.strictEqual(facts.delivery?.vcs, "git");
          assert.deepStrictEqual(
            (JSON.parse(composed.body) as { delivery?: unknown }).delivery,
            facts.delivery,
          );
          assert.include(
            lines.join("\n"),
            "Delivered: none · 1 file untracked (types/concurrency.ts); commit and push, then run peer review again.",
          );
          assert.isTrue(s.logs.some((l) => l.event === "handoff.delivery"));
        } else {
          assert.deepStrictEqual(facts, {});
          assert.notInclude(composed.body, "delivery");
          assert.notInclude(lines.join("\n"), "Delivered:");
        }
        assert.notInclude(lines.join("\n"), "Waits for a person's review");
        assert.include(lines.join("\n"), "Yours before a person reads this handoff:");
        const summary = (yield* s.service.snapshot).summaries[0];
        assert.strictEqual(summary?.policy?.mode, "auto");
        assert.strictEqual(summary?.delivery?.state, revision >= 3 ? "none" : undefined);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
