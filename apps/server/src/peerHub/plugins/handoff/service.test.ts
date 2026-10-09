// @effect-diagnostics preferSchemaOverJson:off - fake Hub and gh wire fixtures.
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
import {
  coreLayer,
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
import { adapter, GhWrite, type Run } from "./client/ghWrite.ts";
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
const setup = (run: Run, prs = 1) =>
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
        if (broken) return [503, { error: { code: "unavailable", message: "down" } }];
        if (request.method === "POST") {
          present = true;
          const value = { package: shared, changed };
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
describe("review package publication", () => {
  it.effect(
    "stores first, defaults to one own comment, repeats quietly, supports description opt-in and withdrawal",
    () =>
      Effect.gen(function* () {
        let body = "author description",
          next = 1;
        const comments: Array<{ id: number; login: string; body: string }> = [];
        const writes: Array<{ args: ReadonlyArray<string>; body?: string }> = [];
        const run: Run = (args, input) =>
          Effect.sync(() => {
            writes.push({ args, ...(input ? { body: input } : {}) });
            if (args[0] === "repo") return "PRIVATE";
            if (args[0] === "pr" && args[1] === "list") return "[]";
            if (args[0] === "pr" && args[1] === "view")
              return JSON.stringify({ body, state: "OPEN" });
            if (args[0] === "pr" && args[1] === "edit") {
              body = input!;
              return "";
            }
            if (args[0] === "pr" && args[1] === "comment") {
              comments.push({ id: next++, login: "ana", body: input! });
              return "";
            }
            if (args[1] === "user") return "ana";
            if (args.includes("--paginate"))
              return comments.map((c) => JSON.stringify(c)).join("\n");
            const method = args[2];
            const id = Number(args[3]?.split("/").at(-1));
            if (method === "DELETE") {
              const index = comments.findIndex((c) => c.id === id);
              comments.splice(index, 1);
              return "";
            }
            if (method === "PATCH") {
              comments.find((c) => c.id === id)!.body = (
                JSON.parse(input!) as { body: string }
              ).body;
              return "";
            }
            return "";
          });
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
        assert.strictEqual(body, "author description");
        assert.strictEqual((yield* s.service.snapshot).target, "comment");
        const repeat = yield* s.service.handOff(place);
        assert.strictEqual(repeat.targets[0]?.kind, "current");
        assert.strictEqual(comments.length, 1);
        comments.push({ ...comments[0]!, id: next++ });
        yield* s.service.handOff(place);
        assert.strictEqual(comments.length, 1);
        const refusal = yield* s.service.setTarget({ target: "description" }).pipe(Effect.result);
        assert.strictEqual(refusal._tag, "Failure");
        yield* s.service.setTarget({ ...place, target: "description" });
        yield* s.service.handOff(place);
        assert.include(body, "<!-- peer:handoff -->");
        const removed = yield* s.service.withdraw(place);
        assert.strictEqual(body, "author description\n\n");
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
});
