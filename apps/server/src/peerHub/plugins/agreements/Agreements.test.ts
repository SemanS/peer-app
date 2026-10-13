// @effect-diagnostics preferSchemaOverJson:off - what the service logged is searched as text for what must not be in it.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  PEER_AGREEMENTS_METHODS,
  PeerHubError,
  type PeerAgreementsView,
  type PeerHubStatus,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";

import type { HubCoordSession } from "../../core/hub/coordApi.ts";
import * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
import * as PeerStatus from "../../core/status/PeerStatus.ts";
import { coreLayer, seedState, standInHub } from "../../core/testkit.ts";
import { Agreements, layer } from "./Agreements.ts";
import {
  acmeHub,
  agreementOf,
  agreementsPeer,
  agreementsSeed,
  agreementsWhen,
  ANA,
  BOB,
  closedOf,
  COORDINATION,
  CYRIL,
  dueOf,
  hasWorkspace,
  ready,
  rpcOver,
  viewOf,
  VIEW,
} from "./fixtures.test.ts";

const NOW = "2026-10-13T12:00:00.000Z";

/** An agent session of the coordination view, live on `task`. */
const live = (task: string): HubCoordSession => ({
  id: "claude:eva",
  project: "app",
  email: CYRIL,
  environment: "cyril-laptop",
  label: "Cyril's agent",
  task,
  status: "working",
  files: [],
  claims: [],
  seenAt: NOW,
});

/** The agreement of KRK-2 and KRK-3 that fell due for KRK-2, where Bob's agent took part. */
const dueForKrk2 = dueOf({
  id: "a2",
  tasks: ["krk-2", "krk-3"],
  landed: ["krk-3"],
  by: { email: CYRIL, task: "krk-3" },
  sides: [
    { session: "claude:bob", environment: "bob-laptop", email: BOB, task: "krk-2" },
    { session: "claude:cy", environment: "cyril-laptop", email: CYRIL, task: "krk-3" },
  ],
});
/** The agreement of KRK-1 and KRK-3 that fell due for KRK-3, where Bob is not on it. */
const dueForKrk3 = dueOf({
  id: "a3",
  tasks: ["krk-1", "krk-3"],
  dueFor: "krk-3",
  by: { email: ANA, task: "krk-1" },
  sides: [
    { session: "claude:old", environment: "ana-laptop", email: ANA, task: "krk-1" },
    { session: "claude:cy", environment: "cyril-laptop", email: CYRIL, task: "krk-3" },
  ],
});

describe("the agreements the Hub keeps", () => {
  it.effect("are read into the status, and are gone while the plugin is off", () =>
    Effect.gen(function* () {
      const hub = yield* standInHub({ current: acmeHub({ view: viewOf([agreementOf()]) }) });
      const peer = yield* agreementsPeer(hub);
      const status = yield* agreementsWhen(peer.status, hasWorkspace);
      const { lastContact, ...rest } = status!;
      assert.match(lastContact ?? "", /^\d{4}-\d\d-\d\dT/);
      assert.deepStrictEqual(rest, {
        enabled: true,
        forcedOff: false,
        hubSupport: "supported",
        workspaces: [
          {
            workspace: "acme",
            open: 1,
            dueForMe: [],
            tasks: [
              { project: "app", task: "krk-1", open: 1, due: 0 },
              { project: "app", task: "krk-2", open: 1, due: 0 },
            ],
            due: [],
          },
        ],
      });
      const reads = () => hub.calls.filter((call) => call.url === VIEW).length;
      assert.strictEqual(reads(), 1);

      // Off, nothing of it is in the status; on again, it is read anew.
      yield* peer.plugins.setPlugin({ id: "agreements", enabled: false });
      assert.isUndefined((yield* peer.status.publish).agreements);
      yield* peer.plugins.setPlugin({ id: "agreements", enabled: true });
      assert.strictEqual(
        (yield* agreementsWhen(peer.status, hasWorkspace))?.workspaces[0]?.open,
        1,
      );
      assert.strictEqual(reads(), 2);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "are counted: those not closed, and those that wait on this person while no agent is on the task",
    () =>
      Effect.gen(function* () {
        // Bob is signed in: his agent took part on KRK-2, which has not landed in the second agreement.
        const view = viewOf([agreementOf(), dueForKrk2, dueForKrk3, closedOf({ id: "a4" })]);
        const { peer, fixture } = yield* ready({ view }, BOB);
        const slice = () =>
          peer.status.publish.pipe(
            Effect.map((status: PeerHubStatus) => status.agreements?.workspaces[0]),
          );
        assert.deepStrictEqual(yield* slice(), {
          workspace: "acme",
          open: 3,
          dueForMe: [{ project: "app", id: "a2" }],
          tasks: [
            { project: "app", task: "krk-1", open: 2, due: 0 },
            { project: "app", task: "krk-2", open: 2, due: 1 },
            { project: "app", task: "krk-3", open: 2, due: 1 },
          ],
          due: [
            { project: "app", id: "a2", dueFor: "krk-2", landed: "krk-3" },
            { project: "app", id: "a3", dueFor: "krk-3", landed: "krk-1" },
          ],
        });

        // An agent is at work on KRK-2: it will hear the agreement, so no person has to.
        fixture.broker["views"].set("acme", { sessions: [live("krk-2")], overlaps: [], at: NOW });
        assert.deepStrictEqual((yield* slice())?.dueForMe, []);
        // An agent on another task changes nothing, and neither does one that ended.
        fixture.broker["views"].set("acme", { sessions: [live("krk-3")], overlaps: [], at: NOW });
        assert.deepStrictEqual((yield* slice())?.dueForMe, [{ project: "app", id: "a2" }]);
        fixture.broker["views"].set("acme", { sessions: [], overlaps: [], at: NOW });
        assert.deepStrictEqual((yield* slice())?.dueForMe, [{ project: "app", id: "a2" }]);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("wait on nobody whose agent took no part on the task that waits", () =>
    Effect.gen(function* () {
      // Ana is signed in: the agreement is due for KRK-2, where only Bob's agent took part.
      const { peer } = yield* ready({ view: viewOf([dueOf()]) }, ANA);
      const slice = (yield* peer.status.publish).agreements?.workspaces[0];
      assert.deepStrictEqual(slice?.dueForMe, []);
      assert.deepStrictEqual(slice?.due, [
        { project: "app", id: "3f9a0c1b2d4e5f60", dueFor: "krk-2", landed: "krk-1" },
      ]);
      assert.strictEqual(slice?.open, 1);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "are forgotten when their person signs out, leaves the workspace or the sync drops it",
    () =>
      Effect.gen(function* () {
        const hub = yield* standInHub({ current: acmeHub({ view: viewOf() }) });
        const peer = yield* agreementsPeer(hub);
        const [contribution] = yield* peer.plugins.contributions;
        const cleanup = contribution!.workspaceCleanup!;
        const rpc = yield* rpcOver(peer.plugins);
        const read = rpc[PEER_AGREEMENTS_METHODS.peerAgreementsView]({ workspace: "acme" });
        const known = () =>
          peer.status.publish.pipe(Effect.map((status) => status.agreements?.workspaces.length));
        yield* agreementsWhen(peer.status, hasWorkspace);
        assert.strictEqual(yield* known(), 1);

        // A workspace it still belongs to stays; the others go with the sync.
        yield* cleanup({
          kind: "synced",
          workspaces: (yield* peer.state.read).persisted.workspaces,
        });
        yield* cleanup({ kind: "left-workspace", workspace: "beta" });
        assert.strictEqual(yield* known(), 1);
        yield* cleanup({ kind: "synced", workspaces: [] });
        assert.strictEqual(yield* known(), 0);

        yield* read;
        assert.strictEqual(yield* known(), 1);
        yield* cleanup({ kind: "left-workspace", workspace: "acme" });
        assert.strictEqual(yield* known(), 0);

        // Signing out forgets what it knew of the Hub too.
        yield* read;
        yield* cleanup({ kind: "signing-out" });
        const slice = (yield* peer.status.publish).agreements;
        assert.deepStrictEqual(slice?.workspaces, []);
        assert.strictEqual(slice?.hubSupport, "unknown");
        assert.isUndefined(slice?.lastContact);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

/**
 * What a test of the service makes its Hub do: say `view` (to a read that names a project, that
 * project's agreements), say it is down or lacks the route, or hold its first answer back until
 * `slow.release`, once `slow.entered` says it was asked.
 */
interface FakeHub {
  view: PeerAgreementsView;
  mode?: "up" | "down" | "missing";
  readonly slow?: {
    readonly entered: Deferred.Deferred<void>;
    readonly release: Deferred.Deferred<void>;
  };
}

/**
 * The service over core with a Hub that behaves as `hub` says, counting what it was asked and
 * collecting the lines the service logged. Core's own status runs, so what the service publishes is
 * what an app reads.
 */
const serviceOver = (hub: FakeHub) =>
  Effect.gen(function* () {
    const reads: string[] = [];
    const logs: Array<readonly [string, Readonly<Record<string, unknown>>]> = [];
    let calls = 0;
    const core = yield* Layer.build(
      coreLayer(yield* seedState(agreementsSeed("https://hub.test", ANA)), {
        session: "s",
        plugins: [],
      }),
    );
    const original = Context.get(core, PeerHubClient.PeerHubClient);
    const agents = Context.get(core, PeerAgents.PeerAgents);
    const request: PeerHubClient.PeerHubClient["Service"]["request"] = (schema, input) =>
      Effect.gen(function* () {
        reads.push(`${input.method ?? "GET"} ${input.path}`);
        const asked = ++calls;
        // What the Hub says at the moment it is asked, which a slow answer keeps.
        const project = /\?project=(.+)$/.exec(input.path)?.[1];
        const said: PeerAgreementsView =
          project === undefined
            ? hub.view
            : {
                ...hub.view,
                agreements: hub.view.agreements.filter(
                  (agreement) => agreement.project === decodeURIComponent(project),
                ),
              };
        if (hub.mode === "down") return yield* new PeerHubError({ detail: "offline" });
        if (hub.mode === "missing") return input.unsupported!.value;
        if (hub.slow !== undefined && asked === 1) {
          yield* Deferred.succeed(hub.slow.entered, undefined);
          yield* Deferred.await(hub.slow.release);
        }
        return yield* Schema.decodeUnknownEffect(schema)(said).pipe(
          Effect.mapError(() => new PeerHubError({ detail: "bad fixture" })),
        );
      });
    const testing = Context.add(
      Context.add(core, PeerHubClient.PeerHubClient, { ...original, request }),
      PeerAgents.PeerAgents,
      { ...agents, log: (event, fields) => Effect.sync(() => void logs.push([event, fields])) },
    );
    yield* Effect.gen(function* () {
      yield* (yield* PeerStatus.PeerStatus).coordinationFrom(() => Effect.succeed(COORDINATION));
    }).pipe(Effect.provide(core));
    const service = Context.get(
      yield* Layer.build(layer).pipe(Effect.provide(testing)),
      Agreements,
    );
    const asked = (path: string) => reads.filter((read) => read === `GET ${path}`).length;
    return { service, reads, logs, asked };
  });

const everything = { workspace: "acme" } as const;
const app = { workspace: "acme", project: "app" } as const;

describe("the snapshot", () => {
  it.effect("is read as the plugin starts, and once for a burst of the Hub's pings", () =>
    Effect.gen(function* () {
      const hub: FakeHub = { view: viewOf([closedOf()]) };
      const { service, asked } = yield* serviceOver(hub);
      yield* service.run.pipe(Effect.forkScoped);
      yield* TestClock.adjust("300 millis");
      assert.strictEqual(asked("/agreements"), 1);

      // The Hub names agreements, a resync, and connecting reads it again; together, once.
      hub.view = viewOf([agreementOf()]);
      yield* service.readSoon("acme", "agreements");
      yield* service.readSoon("acme", "resync");
      yield* service.readSoon("acme");
      yield* TestClock.adjust("300 millis");
      assert.strictEqual(asked("/agreements"), 2);
      assert.strictEqual((yield* service.status).workspaces[0]?.open, 1);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("is read for a task landing only while an agreement waits for one to", () =>
    Effect.gen(function* () {
      const hub: FakeHub = { view: viewOf([closedOf()]) };
      const { service, asked } = yield* serviceOver(hub);
      yield* service.run.pipe(Effect.forkScoped);
      yield* TestClock.adjust("300 millis");
      assert.strictEqual(asked("/agreements"), 1);

      // Everything is closed: what work says is no news of agreements.
      yield* service.readSoon("acme", "work");
      yield* TestClock.adjust("300 millis");
      assert.strictEqual(asked("/agreements"), 1);

      // One waits now, so a task landing is read for, and the agreement falls due in the status.
      hub.view = viewOf([agreementOf()]);
      yield* service.readSoon("acme", "agreements");
      yield* TestClock.adjust("300 millis");
      assert.strictEqual(asked("/agreements"), 2);
      hub.view = viewOf([dueOf()]);
      yield* service.readSoon("acme", "work");
      yield* TestClock.adjust("300 millis");
      assert.strictEqual(asked("/agreements"), 3);
      assert.deepStrictEqual((yield* service.status).workspaces[0]?.due, [
        { project: "app", id: "3f9a0c1b2d4e5f60", dueFor: "krk-2", landed: "krk-1" },
      ]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("keeps what the Hub last said while it cannot be reached", () =>
    Effect.gen(function* () {
      const hub: FakeHub = { view: viewOf([agreementOf()]), mode: "up" };
      const { service } = yield* serviceOver(hub);
      yield* service.view(everything);
      hub.mode = "down";
      const failed = yield* service.view(everything).pipe(Effect.result);
      assert.strictEqual(failed._tag, "Failure");
      const status = yield* service.status;
      assert.strictEqual(status.hubSupport, "supported");
      assert.strictEqual(status.workspaces[0]?.open, 1);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "says a Hub without the route has no agreements, and drops what an earlier read held",
    () =>
      Effect.gen(function* () {
        const hub: FakeHub = { view: viewOf([agreementOf()]), mode: "up" };
        const { service } = yield* serviceOver(hub);
        assert.strictEqual((yield* service.status).hubSupport, "unknown");
        yield* service.view(everything);
        assert.strictEqual((yield* service.status).hubSupport, "supported");
        hub.mode = "missing";
        const refused = yield* service.view(everything).pipe(Effect.flip);
        assert.strictEqual(refused.detail, "Agreements need a newer Peer Hub.");
        assert.isTrue(refused.refused);
        const status = yield* service.status;
        assert.strictEqual(status.hubSupport, "unsupported");
        assert.deepStrictEqual(status.workspaces, []);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("is not replaced by an answer that comes after a newer one", () =>
    Effect.gen(function* () {
      const slow = { entered: yield* Deferred.make<void>(), release: yield* Deferred.make<void>() };
      const hub: FakeHub = { view: viewOf([agreementOf()]), slow };
      const { service } = yield* serviceOver(hub);
      // The first read is slow, and carries what the Hub said when it was asked: one agreement.
      const first = yield* service.view(everything).pipe(Effect.forkChild);
      yield* Deferred.await(slow.entered);
      hub.view = viewOf([agreementOf(), dueForKrk2]);
      assert.strictEqual((yield* service.view(everything)).agreements.length, 2);
      yield* Deferred.succeed(slow.release, undefined);
      assert.strictEqual((yield* Fiber.join(first)).agreements.length, 1);
      // What people see is what the Hub said last.
      assert.strictEqual((yield* service.status).workspaces[0]?.open, 2);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "holds one project's agreements among the workspace's, and none before the workspace was read",
    () =>
      Effect.gen(function* () {
        const other = agreementOf({ id: "b1", project: "web", tasks: ["w-1", "w-2"] });
        const hub: FakeHub = { view: viewOf([agreementOf(), other]) };
        const { service } = yield* serviceOver(hub);
        // A project's read says nothing of the others before the workspace's was read.
        yield* service.view(app);
        assert.deepStrictEqual((yield* service.status).workspaces, []);
        yield* service.view(everything);
        assert.strictEqual((yield* service.status).workspaces[0]?.open, 2);
        // The project's agreements are replaced, the other project's are not.
        hub.view = viewOf([closedOf(), other]);
        yield* service.view(app);
        assert.strictEqual((yield* service.status).workspaces[0]?.open, 1);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("is read for a workspace or a project the person is in, and for no other", () =>
    Effect.gen(function* () {
      const { service, reads } = yield* serviceOver({ view: viewOf() });
      for (const place of [
        { workspace: "beta" },
        { workspace: "acme", project: "secret" },
        { workspace: "beta", project: "app" },
      ]) {
        const refused = yield* service.view(place).pipe(Effect.flip);
        assert.isTrue(refused.refused ?? true);
      }
      assert.deepStrictEqual(reads, []);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

describe("what the log counts", () => {
  it.effect("is each agreement that falls due once, and how each one that closes was closed", () =>
    Effect.gen(function* () {
      const hub: FakeHub = { view: viewOf([agreementOf()]) };
      const { service, logs } = yield* serviceOver(hub);
      // A first read has nothing before it to count against.
      yield* service.view(everything);
      hub.view = viewOf([dueOf()]);
      yield* service.view(everything);
      assert.deepStrictEqual(logs, [["agreements.due", {}]]);

      // The same state read again counts nothing; a person closing the agreement is a closing.
      yield* service.view(everything);
      hub.view = viewOf([closedOf({ closed: { at: NOW, by: ANA, why: "handled" } })]);
      yield* service.view(everything);
      // Reopened and due again: it fell due before, and is not counted twice.
      hub.view = viewOf([dueOf()]);
      yield* service.view(everything);
      assert.deepStrictEqual(logs, [
        ["agreements.due", {}],
        ["agreements.closed", { why: "handled" }],
      ]);

      // The Hub closes it as it replaces it, and a new agreement is open.
      hub.view = viewOf([
        closedOf({ closed: { at: NOW, why: "replaced" } }),
        agreementOf({ id: "ab12cd34ef56ab78", settledAt: NOW }),
      ]);
      yield* service.view(everything);
      assert.deepStrictEqual(logs.at(-1), ["agreements.closed", { why: "replaced" }]);
      assert.strictEqual(logs.length, 3);
      // Not a word, a task or a person is in what was logged.
      for (const word of ["euros", "krk", "ana@", "bob@", "acme"])
        assert.notInclude(JSON.stringify(logs), word);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("counts no due agreement that was due already when it was first read", () =>
    Effect.gen(function* () {
      const { service, logs } = yield* serviceOver({ view: viewOf([dueOf()]) });
      yield* service.view(everything);
      yield* service.view(everything);
      assert.deepStrictEqual(logs, []);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
