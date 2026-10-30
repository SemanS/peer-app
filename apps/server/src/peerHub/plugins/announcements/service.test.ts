import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import * as Layer from "effect/Layer";
import { coreLayer, seedState, signedInSeed, standInHub } from "../../core/testkit.ts";
import { PeerState } from "../../core/state/PeerState.ts";
import { PeerAgents } from "../../core/coordination/PeerAgents.ts";
import { PeerStatus } from "../../core/status/PeerStatus.ts";
import { brokerFixture } from "../../core/broker/testkit.ts";
import { PeerAnnouncements, layer } from "./service.ts";
import {
  PEER_LOCAL_WORKSPACE,
  type PeerAnnouncement,
  type PeerAnnouncementSync,
} from "@t3tools/contracts";
const row = {
  id: "a1b2c3",
  project: "app",
  text: "CI is red",
  wake: true,
  author: { kind: "person" as const, email: "ana@acme.test" },
  createdAt: "2026-10-09T08:00:00Z",
  expiresAt: "2099-10-10T08:00:00Z",
};
const appProject = {
  id: "app",
  name: "App",
  role: "member" as const,
  members: [],
  repositories: [],
  knowledge: { kontext: false, company: false },
  tools: [],
  capacity: { personal: "any" as const, personalHarnesses: [] },
};
describe("announcement service", () => {
  it.effect(
    "offers once, queues a receipt, acknowledges only eligible offered ids and posts without waiting for a ping",
    () =>
      Effect.gen(function* () {
        let delivered: PeerAnnouncementSync["delivered"] = [];
        let rows: PeerAnnouncement[] = [row];
        let unsupported = false;
        const hub = yield* standInHub({
          current: (url) =>
            unsupported
              ? [404, {}]
              : url.endsWith("/sync")
                ? [
                    200,
                    {
                      at: row.createdAt,
                      announcements: rows,
                      delivered,
                      rejected: [],
                    } satisfies PeerAnnouncementSync,
                  ]
                : [200, { ...row, replaced: [] }],
        });
        const core = yield* Layer.build(
          coreLayer(yield* seedState(signedInSeed(hub.url)), { session: "phs_test" }),
        );
        const state = yield* PeerState.pipe(Effect.provide(core));
        const status = yield* PeerStatus.pipe(Effect.provide(core));
        let published: (() => void) | undefined;
        const nextPublish = () =>
          new Promise<void>((resolve) => {
            published = resolve;
          });
        yield* status.coordinationFrom(() =>
          Effect.sync(() => {
            published?.();
            return {
              enabled: false,
              policy: "coordinate",
              claudeHooks: false,
              logPath: "/isolated",
              sessions: [],
              overlaps: [],
              findings: [],
              contexts: [],
              candidates: [],
            };
          }),
        );
        yield* state.updatePersisted((persisted) => ({
          ...persisted,
          workspaces: persisted.workspaces.map((workspace) => ({
            ...workspace,
            manifest: {
              version: 2,
              workspace: { slug: "acme", name: "Acme", currency: "EUR" },
              member: { email: "ana@acme.test", name: "Ana", role: "member" },
              knowledge: {},
              projects: [appProject],
            },
          })),
        }));
        const service = yield* PeerAnnouncements.pipe(Effect.provide(layer), Effect.provide(core));
        const fixture = yield* Effect.acquireRelease(
          Effect.promise(() => brokerFixture()),
          (fixture) => Effect.promise(fixture.dispose),
        );
        yield* Effect.promise(() => fixture.register("one"));
        const agents = yield* PeerAgents.pipe(Effect.provide(core));
        yield* agents.attach(fixture.broker);
        const session = fixture.broker.sessionViews()[0]!;
        yield* service.refresh("acme");
        const calls = hub.calls.length;
        const text = yield* service.step({ session, event: "prompt", remainingMs: 1000 });
        expect(text?.text).toContain(row.text);
        expect(hub.calls).toHaveLength(calls);
        expect(yield* service.step({ session, event: "prompt", remainingMs: 1000 })).toBeNull();
        yield* service.delivery({ session, refs: text!.refs, state: "offered" });
        expect(yield* service.command(session, ["ack", "a1b2"])).toContain("Acknowledged a1b2c3");
        yield* service.flush();
        expect(hub.calls.at(-1)?.body).toContain('"state":"acknowledged"');
        yield* service.post({ workspace: "acme", project: "app", text: row.text, wake: true });
        expect(service.status().projects[0]?.active).toBe(1);
        expect(
          yield* service.command(session, ["ack", "missing"]).pipe(Effect.result),
        ).toHaveProperty("_tag", "Failure");
        delivered = [
          {
            project: "app",
            announcement: row.id,
            session: session.id,
            state: "offered",
            offeredAt: row.createdAt,
          },
        ];
        fixture.broker.sessions.get(session.id)!.pluginState.clear();
        yield* service.refresh("acme");
        expect(
          yield* service.start({
            session,
            event: "session-start",
            source: "resume",
            remainingMs: 1200,
          }),
        ).toBeNull();
        const repeated = yield* service.start({
          session,
          event: "session-start",
          source: "compact",
          remainingMs: 1200,
        });
        expect(repeated?.text).toContain("repeat");
        yield* service.delivery({ session, refs: repeated!.refs, state: "offered" });
        expect(yield* service.step({ session, event: "prompt", remainingMs: 1000 })).toBeNull();
        expect(
          (yield* service.start({
            session,
            event: "session-start",
            source: "compact",
            remainingMs: 1200,
          }))?.text,
        ).toContain("repeat");
        rows = [
          row,
          { ...row, id: "a1b2d4" },
          { ...row, id: "outside-task", task: "other" },
          { ...row, id: "expired", expiresAt: "2000-01-01T00:00:00Z" },
        ];
        yield* service.refresh("acme");
        for (const prefix of ["a1b2", "outside", "expired", "a"])
          expect(
            yield* service.command(session, ["ack", prefix]).pipe(Effect.result),
          ).toHaveProperty("_tag", "Failure");
        const listing = yield* service.command(session, []);
        expect(listing).toContain("a1b2d4");
        expect(listing).not.toContain("outside-task");
        expect(listing).not.toContain("expired");
        expect(yield* service.command(session, ["ack"])).toBe("Acknowledged a1b2c3, a1b2d4.");
        const started = nextPublish();
        yield* service.run.pipe(Effect.forkScoped);
        yield* Effect.promise(() => started);
        const pinged = nextPublish();
        const beforePing = hub.calls.length;
        yield* service.queueRefresh("acme");
        yield* service.queueRefresh("acme");
        yield* TestClock.adjust("1 second");
        yield* Effect.promise(() => pinged);
        expect(hub.calls.length).toBe(beforePing + 1);
        const periodic = nextPublish();
        yield* TestClock.adjust("301 seconds");
        yield* Effect.promise(() => periodic);
        unsupported = true;
        yield* service.refresh("acme");
        expect(service.status().unsupported).toEqual(["acme"]);
        expect(yield* service.command(session, []).pipe(Effect.result)).toHaveProperty(
          "_tag",
          "Failure",
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  const periodicRead = (workspace: string, project: string) =>
    Effect.gen(function* () {
      const reply: { current: readonly [number, unknown] } = {
        current: [200, { at: row.createdAt, announcements: [], delivered: [], rejected: [] }],
      };
      const hub = yield* standInHub({ current: () => reply.current });
      const core = yield* Layer.build(
        coreLayer(yield* seedState(signedInSeed(hub.url)), { session: "phs_test" }),
      );
      const state = yield* PeerState.pipe(Effect.provide(core));
      yield* state.updatePersisted((persisted) => ({
        ...persisted,
        workspaces: persisted.workspaces.map((member) => ({
          ...member,
          manifest: {
            version: 2,
            workspace: { slug: "acme", name: "Acme", currency: "EUR" },
            member: { email: "ana@acme.test", name: "Ana", role: "member" },
            knowledge: {},
            projects: [appProject],
          },
        })),
      }));
      const service = yield* PeerAnnouncements.pipe(Effect.provide(layer), Effect.provide(core));
      const fixture = yield* Effect.acquireRelease(
        Effect.promise(() =>
          brokerFixture((host) => ({
            placeOf: async (cwd) => {
              const place = await host.placeOf(cwd);
              return place === null ? null : { ...place, workspace, project };
            },
          })),
        ),
        (fixture) => Effect.promise(fixture.dispose),
      );
      const failures: unknown[] = [];
      fixture.broker.host.log.subscribe((record) => {
        if (record.event === "announcement.sync.failed") failures.push(record.workspace);
      });
      yield* Effect.promise(() => fixture.register("one"));
      const agents = yield* PeerAgents.pipe(Effect.provide(core));
      yield* agents.attach(fixture.broker);
      return { service, hub, reply, failures, session: fixture.broker.sessionViews()[0]! };
    });

  it.effect("never asks the Hub about a local session's workspace", () =>
    Effect.gen(function* () {
      const { service, failures, session } = yield* periodicRead(PEER_LOCAL_WORKSPACE, "local-abc");
      expect(
        yield* service.start({
          session,
          event: "session-start",
          source: "startup",
          remainingMs: 1200,
        }),
      ).toBeNull();
      yield* TestClock.adjust("301 seconds");
      yield* service.tick;
      yield* service.tick;
      expect(failures).toEqual([]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("retries a failed periodic read a minute later, not on the next tick", () =>
    Effect.gen(function* () {
      const { service, hub, reply, failures } = yield* periodicRead("acme", "app");
      reply.current = [503, {}];
      yield* TestClock.adjust("301 seconds");
      yield* service.tick;
      yield* service.tick;
      expect(hub.calls).toHaveLength(1);
      expect(failures).toEqual(["acme"]);
      yield* TestClock.adjust("59 seconds");
      yield* service.tick;
      expect(hub.calls).toHaveLength(1);
      yield* TestClock.adjust("2 seconds");
      yield* service.tick;
      expect(hub.calls).toHaveLength(2);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
