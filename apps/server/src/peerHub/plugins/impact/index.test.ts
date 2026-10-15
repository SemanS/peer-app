import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, it, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import { PeerImpactFootprint, type PeerImpactView } from "@t3tools/contracts";
import * as Result from "effect/Result";
import { PeerState } from "../../core/state/PeerState.ts";
import { PeerAgents } from "../../core/coordination/PeerAgents.ts";
import { PeerHubClient } from "../../core/hub/PeerHubClient.ts";
import { coreLayer, seedState, paymentsSeed, standInHub } from "../../core/testkit.ts";
import { sessionView, impactView } from "./fixtures.test.ts";
import { makeImpact } from "./Impact.ts";
import { impactHub } from "./client/hub.ts";
import { createCodeGraph, type Health } from "./client/codegraph.ts";
import { createDiff } from "./client/diff.ts";
import { tell, resetTold } from "./tell.ts";
const decodeReport = Schema.decodeSync(
  Schema.fromJsonString(
    Schema.Struct({ environment: Schema.String, footprints: Schema.Array(PeerImpactFootprint) }),
  ),
);
const at = Date.parse("2026-10-09T12:00:00Z");
function fixture<E>(test: (f: Effect.Success<ReturnType<typeof build>>) => Effect.Effect<void, E>) {
  return Effect.gen(function* () {
    const f = yield* build();
    yield* test(f);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));
}
const build = () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(at);
    const mode = { status: 200 },
      view = { ...impactView, records: impactView.records.map((r) => ({ ...r, project: "pay" })) };
    const server = yield* standInHub({
      current: (url) =>
        url.endsWith("/impact")
          ? [
              mode.status,
              mode.status === 200
                ? view
                : {
                    error: {
                      code: "test",
                      message: mode.status === 404 ? "no such route" : "offline",
                    },
                  },
            ]
          : [200, {}],
    });
    const core = yield* Layer.build(
      coreLayer(yield* seedState(paymentsSeed(server.url)), { session: "person", plugins: [] }),
    );
    const state = yield* PeerState.pipe(Effect.provide(core)),
      client = yield* PeerHubClient.pipe(Effect.provide(core));
    const sessions = [sessionView({ project: "pay", files: ["money.ts"], task: "krk-1" })],
      others: { present: boolean } = { present: true },
      processes: string[] = [];
    const agents = yield* PeerAgents.pipe(
      Effect.provide(
        Layer.mock(PeerAgents)({
          sessions: Effect.sync(() => sessions),
          inPane: () => undefined,
          level: () => "B",
          hubViews: Clock.currentTimeMillis.pipe(
            Effect.map((now) => [
              {
                workspace: "acme",
                view: {
                  sessions: others.present
                    ? [
                        {
                          id: "codex:b",
                          project: "pay",
                          email: "bob@test",
                          environment: "other",
                          label: "B",
                          task: "b",
                          status: "working" as const,
                          files: ["receipt.ts"],
                          claims: [],
                          seenAt: DateTime.formatIso(DateTime.makeUnsafe(now)),
                        },
                      ]
                    : [],
                  overlaps: [],
                  at: DateTime.formatIso(DateTime.makeUnsafe(now)),
                },
              },
            ]),
          ),
          log: () => Effect.void,
        }),
      ),
    );
    const graph = {
        ...createCodeGraph({ binary: "/never" }),
        health: async (root: string): Promise<Health> => {
          processes.push("status");
          return {
            root,
            state: "ready",
            commands: [],
            pending: new Set<string>(),
            lastIndexed: at,
          };
        },
        symbols: async (_root: string, path: string) => {
          processes.push("node");
          return [{ name: "price", path, start: 1, end: 2, signature: "(value: number)" }];
        },
        callees: async () => {
          processes.push("callees");
          return [{ name: "dep", path: "dep.ts" }];
        },
      },
      diff = {
        ...createDiff(),
        read: async () => {
          processes.push("git");
          return {
            files: new Map([
              [
                "money.ts",
                {
                  text: "function price(value: number) {\n return value; }",
                  hunks: [{ start: 1, end: 1 }],
                  newFile: false,
                },
              ],
            ]),
          };
        },
      };
    const hub = impactHub(client);
    const service = yield* makeImpact(state, agents, hub, { graph, diff });
    yield* service.boot;
    const advance = (ms: number) => TestClock.adjust(ms).pipe(Effect.andThen(service.tick));
    return {
      service,
      state,
      mode,
      server,
      sessions,
      others,
      processes,
      advance,
      hub,
      graph,
      diff,
      agents,
    };
  });
describe("impact background service", () => {
  it.effect("a Hub refresh observes dismissal before a compacted session asks for advice", () =>
    fixture((f) =>
      Effect.gen(function* () {
        yield* f.service.tick;
        const session = f.sessions[0]!,
          before = f.service.view("acme");
        expect(tell(session, before, "ready", at, false)).toContain("impact (advice)");
        f.hub.view = () =>
          Effect.succeed({
            ...before,
            records: before.records.map((record) => ({ ...record, state: "dismissed" as const })),
          });
        yield* f.service.readSoon("acme");
        expect(f.service.view("acme").records[0]?.state).toBe("open");
        yield* f.service.tick;
        expect(f.service.view("acme").records[0]?.state).toBe("dismissed");
        expect((yield* f.service.status).counts).toEqual([]);
        resetTold(session);
        expect(tell(session, f.service.view("acme"), "ready", at, false)).toBeNull();
      }),
    ),
  );
  it.effect(
    "Settings carries how many changed files wait for CodeGraph, and a new count is a new revision",
    () =>
      fixture((f) =>
        Effect.gen(function* () {
          const waiting =
            (count: number) =>
            async (root: string): Promise<Health> => ({
              root,
              state: "pending",
              commands: [`codegraph sync '${root}'`],
              pending: null,
              waiting: count,
            });
          f.graph.health = waiting(2);
          yield* f.service.tick;
          yield* f.advance(5000);
          const before = yield* f.service.status;
          expect(before.roots.map((root) => [root.state, root.waiting])).toEqual([["pending", 2]]);
          f.graph.health = waiting(3);
          // A root that is not ready is asked again a minute later, after the check's own delay.
          yield* f.advance(61_000);
          yield* f.advance(6000);
          const after = yield* f.service.status;
          expect(after.roots.map((root) => [root.state, root.waiting])).toEqual([["pending", 3]]);
          expect(after.revision).toBeGreaterThan(before.revision);
        }),
      ),
  );
  it.effect("publishes a revision when a previously shown root disappears with its session", () =>
    fixture((f) =>
      Effect.gen(function* () {
        yield* f.service.tick;
        yield* f.advance(5000);
        const before = yield* f.service.status;
        expect(before.roots).toHaveLength(1);
        f.sessions.length = 0;
        yield* f.service.tick;
        const after = yield* f.service.status;
        expect(after.roots).toEqual([]);
        expect(after.revision).toBeGreaterThan(before.revision);
      }),
    ),
  );
  it.effect(
    "CLI reads and own-side short-id actions use the same service without foreign mutation",
    () =>
      fixture((f) =>
        Effect.gen(function* () {
          const actions: Array<{ id: string; action: string; session: string | undefined }> = [];
          f.hub.act = (_workspace, _project, id, action, actor) =>
            Effect.sync(() => {
              actions.push({ id, action, session: actor?.session });
              return { id, changed: true };
            });
          expect(yield* f.service.command(f.sessions[0]!, [])).toContain("price");
          expect(yield* f.service.command(f.sessions[0]!, ["dismiss", "123456"])).toContain(
            "dismissed",
          );
          expect(yield* f.service.command(f.sessions[0]!, ["reopen", "123456"])).toContain(
            "reopened",
          );
          expect(actions).toEqual([
            { id: "123456789012", action: "dismiss", session: "claude:a" },
            { id: "123456789012", action: "reopen", session: "claude:a" },
          ]);
          for (const args of [
            ["dismiss"],
            ["dismiss", "badid"],
            ["wrong", "123456"],
            ["dismiss", "abcdef"],
          ])
            expect(
              Result.isFailure(yield* f.service.command(f.sessions[0]!, args).pipe(Effect.result)),
            ).toBe(true);
          expect(
            Result.isFailure(
              yield* f.service
                .command({ ...f.sessions[0]!, id: "claude:outsider" }, ["dismiss", "123456"])
                .pipe(Effect.result),
            ),
          ).toBe(true);
          expect(actions).toHaveLength(2);
        }),
      ),
  );
  it.effect.each([false, true])(
    "discards a held check after exit/replacement (%s)",
    (replacement) =>
      fixture((f) =>
        Effect.gen(function* () {
          yield* f.service.tick;
          const started = yield* Deferred.make<void>(),
            release = Promise.withResolvers<void>(),
            old = f.sessions[0]!,
            read = f.diff.read;
          f.diff.read = async (...args) => {
            Deferred.doneUnsafe(started, Effect.void);
            await release.promise;
            return read(...args);
          };
          yield* TestClock.adjust(5000);
          const checking = yield* f.service.tick.pipe(Effect.forkChild);
          yield* Deferred.await(started);
          if (replacement)
            f.sessions.splice(0, 1, {
              ...old,
              runtimeGeneration: "replacement",
              root: "/replacement",
            });
          else f.sessions.length = 0;
          release.resolve();
          yield* Fiber.join(checking);
          expect(f.service.root(old.root)).toBeUndefined();
          expect((yield* f.service.status).roots).toEqual([]);
          expect(
            f.server.calls
              .filter((c) => c.method === "PUT")
              .flatMap((c) => decodeReport(c.body).footprints),
          ).toEqual([]);
        }),
      ),
  );
  it.effect("auto-indexing stops on opt-in disable, coordination off and interruption", () =>
    fixture((f) =>
      Effect.gen(function* () {
        yield* f.state.updateRuntime((s) => ({
          ...s,
          work: new Map([
            [
              "acme/pay",
              {
                areas: [],
                threads: [],
                tasks: [
                  {
                    id: "krk-1",
                    title: "Work",
                    status: "open",
                    createdBy: "ana@test",
                    createdAt: "now",
                    updatedAt: "now",
                  },
                ],
              },
            ],
          ]),
        }));
        for (const reason of ["configure", "coordination", "interrupt"] as const) {
          yield* f.state.updatePersisted((p) => ({
            ...p,
            coordination: { enabled: true, policy: "coordinate" },
          }));
          const started = yield* Deferred.make<AbortSignal>(),
            aborted = yield* Deferred.make<void>();
          const service = yield* makeImpact(f.state, f.agents, f.hub, {
            graph: f.graph,
            diff: f.diff,
            index: async (_event, _parent, valid, _run, _bin, signal) => {
              expect(valid()).toBe(true);
              Deferred.doneUnsafe(started, Effect.succeed(signal!));
              return await new Promise<boolean>((resolve) => {
                const finish = () => {
                  Deferred.doneUnsafe(aborted, Effect.void);
                  resolve(false);
                };
                signal!.addEventListener("abort", finish, { once: true });
                if (signal!.aborted) finish();
              });
            },
          });
          yield* service.boot;
          yield* service.configure({ autoIndex: true });
          yield* service.created({
            kind: "task-worktree-created",
            workspace: "acme",
            project: "pay",
            repository: "api",
            task: "krk-1",
            thread: "peer:thread-1",
            root: "/new",
            identity: "1:2",
          });
          const indexing = yield* service.tick.pipe(Effect.forkChild);
          const signal = yield* Deferred.await(started);
          if (reason === "configure") yield* service.configure({ autoIndex: false });
          else if (reason === "coordination") {
            yield* f.state.updatePersisted((p) => ({
              ...p,
              coordination: { enabled: false, policy: "coordinate" },
            }));
            yield* TestClock.adjust(1000);
          } else yield* Fiber.interrupt(indexing);
          yield* Deferred.await(aborted);
          expect(signal.aborted).toBe(true);
          if (reason !== "interrupt") yield* Fiber.join(indexing);
        }
      }),
    ),
  );
  it.effect("a new Hub/person does not inherit the old Hub cooldown", () =>
    fixture((f) =>
      Effect.gen(function* () {
        f.mode.status = 404;
        yield* f.service.tick;
        expect((yield* f.service.status).hubSupport).toBe("unsupported");
        yield* f.service.forget();
        f.mode.status = 200;
        yield* f.service.readSoon("acme");
        yield* f.service.tick;
        expect((yield* f.service.status).hubSupport).toBe("supported");
        expect(f.service.view("acme").records).toHaveLength(1);
      }),
    ),
  );
  it.effect(
    "does not resurrect private view/counts after a held GET completes following workspace removal",
    () =>
      fixture((f) =>
        Effect.gen(function* () {
          const started = yield* Deferred.make<void>(),
            release = yield* Deferred.make<PeerImpactView | null>();
          f.hub.view = () =>
            Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(release)));
          const reading = yield* f.service.tick.pipe(Effect.forkChild);
          yield* Deferred.await(started);
          yield* f.service.forget("acme");
          yield* f.state.updatePersisted((p) => ({ ...p, workspaces: [] }));
          yield* Deferred.succeed(release, impactView);
          yield* Fiber.join(reading);
          expect(f.service.view("acme").records).toEqual([]);
          expect((yield* f.service.status).counts).toEqual([]);
          yield* f.advance(10000);
          expect(f.server.calls.filter((c) => c.method === "PUT")).toEqual([]);
        }),
      ),
  );
  it.effect(
    "discards an awaited local check and queued report on signout even without a successful workspace view",
    () =>
      fixture((f) =>
        Effect.gen(function* () {
          yield* f.service.tick;
          const started = yield* Deferred.make<void>(),
            release = Promise.withResolvers<void>();
          const read = f.diff.read;
          f.diff.read = async (...args) => {
            Deferred.doneUnsafe(started, Effect.void);
            await release.promise;
            return read(...args);
          };
          yield* TestClock.adjust(5000);
          const checking = yield* f.service.tick.pipe(Effect.forkChild);
          yield* Deferred.await(started);
          yield* f.service.forget();
          yield* f.state.updatePersisted((p) => ({ ...p, workspaces: [] }));
          release.resolve();
          yield* Fiber.join(checking);
          expect((yield* f.service.status).roots).toEqual([]);
          expect((yield* f.service.status).counts).toEqual([]);
          yield* f.advance(10000);
          expect(f.server.calls.filter((c) => c.method === "PUT")).toEqual([]);
        }),
      ),
  );
  it.effect("does not remember an in-flight report after workspace removal", () =>
    fixture((f) =>
      Effect.gen(function* () {
        yield* f.service.tick;
        const started = yield* Deferred.make<void>(),
          release = yield* Deferred.make<PeerImpactView | null>();
        yield* f.advance(5000);
        f.hub.report = () =>
          Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(release)));
        yield* TestClock.adjust(5000);
        const reporting = yield* f.service.tick.pipe(Effect.forkChild);
        yield* Deferred.await(started);
        yield* f.service.forget("acme");
        yield* f.state.updatePersisted((p) => ({ ...p, workspaces: [] }));
        yield* Deferred.succeed(release, impactView);
        yield* Fiber.join(reporting);
        expect(f.service.view("acme").records).toEqual([]);
        expect((yield* f.service.status).roots).toEqual([]);
        yield* f.advance(10000);
        expect(f.server.calls.filter((c) => c.method === "PUT")).toEqual([]);
      }),
    ),
  );

  it.effect(
    "observations return before processes, require another live work, debounce and report a wire projection",
    () =>
      fixture((f) =>
        Effect.gen(function* () {
          f.others.present = false;
          yield* f.service.tick;
          yield* f.service.observe(f.sessions[0]!);
          expect(f.processes).toEqual([]);
          yield* f.advance(5000);
          expect(f.processes).toEqual([]);
          f.others.present = true;
          yield* f.service.tick;
          yield* f.advance(4999);
          expect(f.processes).toEqual([]);
          yield* f.advance(1);
          expect(f.processes).toEqual(["status", "git", "node", "callees"]);
          const initialReports = f.server.calls.filter((c) => c.method === "PUT").length;
          yield* f.advance(5000);
          const reports = f.server.calls.filter((c) => c.method === "PUT");
          expect(reports).toHaveLength(initialReports + 1);
          expect(decodeReport(reports.at(-1)!.body)).toMatchObject({
            footprints: [
              {
                session: "claude:a",
                project: "pay",
                changed: [{ name: "price", path: "money.ts", change: "signature", rev: 1 }],
                uses: [{ name: "dep", path: "dep.ts", from: "price", fromPath: "money.ts" }],
              },
            ],
          });
          expect(reports.at(-1)!.body).not.toMatch(/return value|startLine|endLine|hash/);
          yield* f.service.observe(f.sessions[0]!);
          yield* f.advance(5000);
          expect(f.processes).toHaveLength(4);
          yield* f.advance(10000);
          expect(f.processes).toHaveLength(6);
        }),
      ),
  );
  it.effect("503 preserves the last view/contact and retries the newest unsent report", () =>
    fixture((f) =>
      Effect.gen(function* () {
        yield* f.service.tick;
        const before = yield* f.service.status;
        f.mode.status = 503;
        yield* f.service.readSoon("acme");
        yield* f.advance(5000);
        yield* f.advance(5000);
        expect((yield* f.service.status).lastContact).toBe(before.lastContact);
        expect(f.service.view("acme").records).toHaveLength(1);
        f.mode.status = 200;
        yield* f.advance(10000);
        expect(f.server.calls.filter((c) => c.method === "PUT")).toHaveLength(2);
        expect((yield* f.service.status).hubSupport).toBe("supported");
      }),
    ),
  );
  it.effect("an explicit route downgrade removes previously cached live facts and counts", () =>
    fixture((f) =>
      Effect.gen(function* () {
        yield* f.service.tick;
        const before = yield* f.service.status;
        expect(f.service.view("acme").records).toHaveLength(1);
        expect(before.counts.length).toBeGreaterThan(0);
        f.mode.status = 404;
        expect(
          Result.isFailure(yield* f.service.list({ workspace: "acme" }).pipe(Effect.result)),
        ).toBe(true);
        const after = yield* f.service.status;
        expect(after.hubSupport).toBe("unsupported");
        expect(after.lastContact).toBe(before.lastContact);
        expect(after.revision).toBeGreaterThan(before.revision);
        expect(after.counts).toEqual([]);
        expect(f.service.view("acme")).toEqual({ records: [], provided: [] });
      }),
    ),
  );
  it.effect(
    "an older Hub suppresses all local processes for ten minutes and retries afterward",
    () =>
      fixture((f) =>
        Effect.gen(function* () {
          f.mode.status = 404;
          yield* f.service.tick;
          yield* f.advance(5000);
          expect(f.processes).toEqual([]);
          expect((yield* f.service.status).hubSupport).toBe("unsupported");
          expect(
            Result.isFailure(yield* f.service.list({ workspace: "acme" }).pipe(Effect.result)),
          ).toBe(true);
          const before = f.server.calls.length;
          yield* f.advance(594999);
          expect(f.server.calls.length).toBe(before);
          f.mode.status = 200;
          yield* f.advance(1);
          yield* f.advance(5000);
          expect(f.processes.length).toBeGreaterThan(0);
        }),
      ),
  );
  it.effect("off sends an empty report and removes facts; opt-in indexing defaults off", () =>
    fixture((f) =>
      Effect.gen(function* () {
        yield* f.service.tick;
        yield* f.advance(5000);
        yield* f.advance(5000);
        expect((yield* f.service.status).autoIndex).toBe(false);
        yield* f.service.clear;
        expect(
          decodeReport(f.server.calls.findLast((c) => c.method === "PUT")!.body),
        ).toMatchObject({
          footprints: [],
        });
        expect(f.service.view("acme")).toEqual({ records: [], provided: [] });
        expect((yield* f.service.status).enabled).toBe(false);
        expect(
          Result.isFailure(yield* f.service.list({ workspace: "acme" }).pipe(Effect.result)),
        ).toBe(true);
        yield* f.service.boot;
        expect((yield* f.service.status).enabled).toBe(true);
      }),
    ),
  );
});
