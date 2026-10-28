// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalTimers:off preferSchemaOverJson:off - a call made 40 minutes ago, the bodies the Hub was sent, and a moment in which nothing happens.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { PEER_OWNERSHIP_METHODS, type PeerOwnerMap } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Result from "effect/Result";
import * as TestClock from "effect/testing/TestClock";

import type { PeerPluginEntry } from "../../core/plugin.ts";
import { standInHub } from "../../core/testkit.ts";
import {
  ACME,
  acmeHub,
  ANA,
  BOB,
  brokerOver,
  CYRIL,
  callOf,
  CALLS,
  EVA,
  EVENTS,
  hasProject,
  NOW,
  ownershipPeer,
  ownershipWhen,
  projectOf,
  rpcOver,
  type Route,
  VIEW,
  viewOf,
} from "./fixtures.test.ts";
import { OwnershipPlugin } from "./index.ts";

/** The plugin tells time by the clock of the runtime that runs it, which is the real one here. */
const FORTY_MINUTES_AGO = new Date(Date.now() - 40 * 60_000).toISOString();
const methods = PEER_OWNERSHIP_METHODS;

/** `OwnershipPlugin` that says on `pings` which of the Hub's pings it has taken. */
const observing = (pings: Queue.Queue<string>): PeerPluginEntry => ({
  ...OwnershipPlugin,
  contributions: OwnershipPlugin.contributions.pipe(
    Effect.map((contribution) => ({
      ...contribution,
      hubChanges: {
        ...contribution.hubChanges!,
        onPing: (ping: Parameters<NonNullable<typeof contribution.hubChanges>["onPing"]>[0]) =>
          contribution
            .hubChanges!.onPing(ping)
            .pipe(Effect.andThen(Queue.offer(pings, ping.change)), Effect.asVoid),
      },
    })),
  ),
});

describe("the ownership view", () => {
  it.effect("is read from the Hub into the status, and is gone while the plugin is off", () =>
    Effect.gen(function* () {
      const project = projectOf({ calls: [callOf()] });
      const hub = yield* standInHub({ current: acmeHub({ view: viewOf(project) }) });
      const peer = yield* ownershipPeer(hub);
      assert.deepStrictEqual(yield* ownershipWhen(peer.status, hasProject), {
        projects: [{ workspace: "acme", project: "app", at: NOW, ...project }],
      });
      assert.strictEqual(hub.calls.filter((call) => call.url === VIEW).length, 1);

      yield* peer.plugins.setPlugin({ id: "ownership", enabled: false });
      assert.isUndefined((yield* peer.status.publish).ownership);
      yield* peer.plugins.setPlugin({ id: "ownership", enabled: true });
      assert.deepStrictEqual((yield* ownershipWhen(peer.status, hasProject))?.projects.length, 1);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("is read again, once for a burst, when the Hub pings what changes it", () =>
    Effect.gen(function* () {
      const asked = yield* Queue.unbounded<string>();
      const pings = yield* Queue.unbounded<string>();
      const current = {
        view: viewOf(),
        route: (url: string) => {
          Queue.offerUnsafe(asked, url);
          return undefined;
        },
      };
      const hub = yield* standInHub({ current: acmeHub(current) });
      const peer = yield* ownershipPeer(hub, BOB, observing(pings));
      yield* peer.events
        .follow({
          readWork: () => Effect.void,
          coordinationChanged: Effect.void,
          projectsChanged: Effect.void,
        })
        .pipe(Effect.forkScoped);
      // Connecting counts as a resync, which reads the view.
      while ((yield* Queue.take(asked)) !== EVENTS);
      yield* Queue.take(pings);
      yield* TestClock.adjust("300 millis");
      yield* ownershipWhen(peer.status, hasProject);

      const reads = () => hub.calls.filter((call) => call.url === VIEW).length;
      const before = reads();
      yield* Queue.clear(asked);
      for (const change of ["ownership", "work", "coord", "requests"])
        hub.push(EVENTS, `event: ${change}\ndata: {"origin":"bob-laptop","project":"app"}\n\n`);
      for (let i = 0; i < 4; i++) yield* Queue.take(pings);
      yield* TestClock.adjust("300 millis");
      while ((yield* Queue.take(asked)) !== VIEW);
      assert.strictEqual(reads(), before + 1);

      // What does not change ownership is not read for.
      yield* Queue.clear(asked);
      for (const change of ["observe", "projects", "ownership"])
        hub.push(EVENTS, `event: ${change}\ndata: {"origin":null}\n\n`);
      yield* Queue.take(pings);
      yield* TestClock.adjust("300 millis");
      while ((yield* Queue.take(asked)) !== VIEW);
      assert.strictEqual(reads(), before + 2);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "is not read again for what this computer's own reports said of work and coordination",
    () =>
      Effect.gen(function* () {
        const [pings, asked] = [yield* Queue.unbounded<string>(), yield* Queue.unbounded<string>()];
        const current = {
          view: viewOf(),
          route: (url: string) => {
            Queue.offerUnsafe(asked, url);
            return undefined;
          },
        };
        const hub = yield* standInHub({ current: acmeHub(current) });
        const peer = yield* ownershipPeer(hub, BOB, observing(pings));
        yield* peer.events
          .follow({
            readWork: () => Effect.void,
            coordinationChanged: Effect.void,
            projectsChanged: Effect.void,
          })
          .pipe(Effect.forkScoped);
        // Its first read, and the one connecting brings (a resync): both are done before it goes on.
        yield* Queue.take(pings);
        yield* TestClock.adjust("300 millis");
        for (let seen = 0; seen < 2;) if ((yield* Queue.take(asked)) === VIEW) seen += 1;
        const reads = () => hub.calls.filter((call) => call.url === VIEW).length;
        const before = reads();
        for (const change of ["coord", "work"])
          hub.push(EVENTS, `event: ${change}\ndata: {"origin":"ana-laptop"}\n\n`);
        for (let i = 0; i < 2; i++) yield* Queue.take(pings);
        yield* TestClock.adjust("300 millis");
        yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 50)));
        assert.strictEqual(reads(), before);
        // A first agent's own ownership ping is news to it, and another computer's report is too.
        hub.push(EVENTS, 'event: ownership\ndata: {"origin":"ana-laptop"}\n\n');
        yield* Queue.take(pings);
        yield* TestClock.adjust("300 millis");
        yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 100)));
        assert.strictEqual(reads(), before + 1);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("keeps the last view while the Hub cannot be reached", () =>
    Effect.gen(function* () {
      const asked = yield* Queue.unbounded<string>();
      const current: { view: ReturnType<typeof viewOf>; route?: Route } = {
        view: viewOf(projectOf({ calls: [callOf()] })),
        route: (url) => {
          Queue.offerUnsafe(asked, url);
          return undefined;
        },
      };
      const hub = yield* standInHub({ current: acmeHub(current) });
      const peer = yield* ownershipPeer(hub);
      yield* ownershipWhen(peer.status, hasProject);
      current.route = (url) => {
        Queue.offerUnsafe(asked, url);
        return url === VIEW
          ? [503, { error: { code: "down", message: "The Hub is down." } }]
          : undefined;
      };
      yield* Queue.clear(asked);
      // Nothing pings; the view is read again every 30 seconds, and the Hub does not answer.
      yield* TestClock.adjust("30 seconds");
      while ((yield* Queue.take(asked)) !== VIEW);
      const status = yield* peer.status.publish;
      assert.strictEqual(status.ownership?.projects[0]?.calls[0]?.id, "oc-7f2a");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "is forgotten when its person signs out, leaves the workspace or the sync drops it",
    () =>
      Effect.gen(function* () {
        const hub = yield* standInHub({ current: acmeHub({ view: viewOf() }) });
        const peer = yield* ownershipPeer(hub);
        const [contribution] = yield* peer.plugins.contributions;
        const forget = contribution!.workspaceCleanup!;
        const known = () =>
          peer.status.publish.pipe(Effect.map((s) => s.ownership?.projects.length));
        yield* ownershipWhen(peer.status, hasProject);
        for (const gone of [
          { kind: "synced", workspaces: [] },
          { kind: "left-workspace", workspace: "acme" },
          { kind: "signing-out" },
        ] as const) {
          yield* forget(gone);
          assert.strictEqual(yield* known(), 0);
          // Only the next read brings it back, as it would for a workspace the person still has.
          yield* TestClock.adjust("30 seconds");
          yield* ownershipWhen(peer.status, hasProject);
        }
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

describe("peer status", () => {
  it.effect("ends with whose the task is and the calls its session waits on", () =>
    Effect.gen(function* () {
      const project = projectOf({
        tasks: {
          "ord-9": { project: "app", task: "ord-9", owner: BOB, since: NOW, reason: "request" },
        },
        calls: [callOf({ createdAt: FORTY_MINUTES_AGO })],
      });
      const hub = yield* standInHub({ current: acmeHub({ view: viewOf(project) }) });
      const peer = yield* ownershipPeer(hub);
      yield* ownershipWhen(peer.status, hasProject);
      const fixture = yield* brokerOver(peer);
      yield* Effect.promise(() => fixture.register("one"));
      const status = () =>
        Effect.promise(() =>
          fixture.broker["runCli"]("status", [], { "x-peer-session": "claude:one" }),
        );
      assert.include(
        yield* status(),
        "\nOwnership: ORD-9 is yours · 1 call to Ana pending (oc-7f2a, 40 min)",
      );

      // Said while the plugin is on and the Hub serves it, and not otherwise.
      yield* peer.plugins.setPlugin({ id: "ownership", enabled: false });
      assert.notInclude(yield* status(), "Ownership:");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("says nothing where the task has no owner and no call waits", () =>
    Effect.gen(function* () {
      const map = { ...projectOf().map, areas: {} };
      const hub = yield* standInHub({ current: acmeHub({ view: viewOf(projectOf({ map })) }) });
      const peer = yield* ownershipPeer(hub);
      yield* ownershipWhen(peer.status, hasProject);
      const fixture = yield* brokerOver(peer);
      yield* Effect.promise(() => fixture.register("one"));
      const out = yield* Effect.promise(() =>
        fixture.broker["runCli"]("status", [], { "x-peer-session": "claude:one" }),
      );
      assert.notInclude(out, "Ownership:");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

describe("the apps' methods", () => {
  const saved: PeerOwnerMap = {
    version: 8,
    areas: { Payments: ANA },
    paths: { "src/payments/**": ANA },
    decide: ["src/payments/**"],
    updatedAt: NOW,
    updatedBy: EVA,
  };
  const row = (owner: string) => ({
    project: "app",
    task: "ord-9",
    owner,
    since: NOW,
    by: EVA,
    reason: "named",
  });
  const sent = (hub: {
    readonly calls: ReadonlyArray<{
      readonly method: string | undefined;
      readonly url: string | undefined;
      readonly body: string;
    }>;
  }) =>
    hub.calls
      .filter((call) => call.method !== "GET")
      .map((call) => [call.method, call.url, call.body] as const);

  it.effect("read the view and keep what the Hub said", () =>
    Effect.gen(function* () {
      const current = { view: viewOf(projectOf({ calls: [callOf()] })) };
      const hub = yield* standInHub({ current: acmeHub(current) });
      const peer = yield* ownershipPeer(hub);
      const rpc = yield* rpcOver(peer.plugins);
      const view = yield* rpc[methods.peerOwnershipList]({ workspace: "acme", project: "app" });
      assert.deepStrictEqual(view, current.view);
      assert.include(
        hub.calls.map((call) => call.url),
        `${VIEW}?project=app`,
      );
      const all = yield* rpc[methods.peerOwnershipList]({ workspace: "acme" });
      assert.deepStrictEqual(all, current.view);
      // A workspace the person is not in is no business of the Hub's.
      const refusal = yield* rpc[methods.peerOwnershipList]({ workspace: "beta" }).pipe(
        Effect.result,
      );
      assert.isTrue(Result.isFailure(refusal));
      assert.isFalse(hub.calls.some((call) => call.url?.startsWith("/v1/workspaces/beta")));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("name a task's owner, take it away, and read the view again afterwards", () =>
    Effect.gen(function* () {
      const current: { view: ReturnType<typeof viewOf>; route?: Route } = {
        view: viewOf(),
        route: (url) =>
          url === `${ACME}/projects/app/tasks/ord-9/owner`
            ? [200, { task: "ord-9", owner: row(ANA), changed: true }]
            : undefined,
      };
      const hub = yield* standInHub({ current: acmeHub(current) });
      const peer = yield* ownershipPeer(hub, EVA);
      yield* ownershipWhen(peer.status, hasProject);
      const rpc = yield* rpcOver(peer.plugins);
      current.view = viewOf(projectOf({ tasks: { "ord-9": row(ANA) } }));
      const result = yield* rpc[methods.peerOwnershipSetTaskOwner]({
        workspace: "acme",
        project: "app",
        task: "ord-9",
        owner: ANA,
      });
      assert.deepStrictEqual(result, { task: "ord-9", owner: row(ANA), changed: true });
      assert.deepStrictEqual(
        (yield* ownershipWhen(peer.status, (o) => o?.projects[0]?.tasks["ord-9"] !== undefined))
          ?.projects[0]?.tasks["ord-9"]?.owner,
        ANA,
      );
      current.route = () => [200, { task: "ord-9", owner: null, changed: true }];
      yield* rpc[methods.peerOwnershipSetTaskOwner]({
        workspace: "acme",
        project: "app",
        task: "ord-9",
        owner: null,
        op: "give-back",
      });
      assert.deepStrictEqual(sent(hub), [
        ["PUT", `${ACME}/projects/app/tasks/ord-9/owner`, '{"owner":"ana@acme.test"}'],
        ["PUT", `${ACME}/projects/app/tasks/ord-9/owner`, '{"owner":null,"op":"give-back"}'],
      ]);
      // A project the person is not on is refused before the Hub hears of it.
      const refusal = yield* rpc[methods.peerOwnershipSetTaskOwner]({
        workspace: "acme",
        project: "other",
        task: "ord-9",
        owner: ANA,
      }).pipe(Effect.result);
      assert.isTrue(Result.isFailure(refusal));
      assert.strictEqual(sent(hub).length, 2);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("take a task nobody owns as the signed-in person, and name who owns one already", () =>
    Effect.gen(function* () {
      const taken = { ...row(CYRIL), task: "ord-12", by: CYRIL, reason: "taken" };
      const current: { view: ReturnType<typeof viewOf>; route?: Route } = {
        view: viewOf(),
        route: (url) =>
          url === `${ACME}/projects/app/tasks/ord-12/owner`
            ? [200, { task: "ord-12", owner: taken, changed: true }]
            : undefined,
      };
      const hub = yield* standInHub({ current: acmeHub(current) });
      const peer = yield* ownershipPeer(hub, CYRIL);
      const rpc = yield* rpcOver(peer.plugins);
      const take = (task: string) =>
        rpc[methods.peerOwnershipTake]({ workspace: "acme", project: "app", task, op: "t-1" });
      assert.deepStrictEqual(yield* take("ord-12"), {
        task: "ord-12",
        owner: taken,
        changed: true,
      });
      assert.deepStrictEqual(sent(hub), [
        [
          "PUT",
          `${ACME}/projects/app/tasks/ord-12/owner`,
          '{"owner":"cyril@acme.test","op":"t-1"}',
        ],
      ]);

      // Somebody owns it: the refusal names them, whichever status the Hub refuses with.
      for (const status of [409, 403] as const) {
        current.route = () => [
          status,
          {
            error: {
              code: "task_owned",
              message: "ord-9 has an owner",
              details: { owner: BOB },
            },
          },
        ];
        const refused = yield* take("ord-9").pipe(Effect.flip);
        assert.strictEqual(
          refused.message,
          "Bob owns this task already. Ask them or a lead of the project to hand it over.",
        );
      }
      // A done task, or any refusal without an owner, is the Hub's own words.
      current.route = () => [
        409,
        { error: { code: "task_done", message: "ORD-11 is done; nobody takes it." } },
      ];
      const done = yield* take("ord-11").pipe(Effect.flip);
      assert.strictEqual(done.message, "ORD-11 is done; nobody takes it.");
      // A project the person is not on is refused before the Hub hears of it.
      const before = sent(hub).length;
      const off = yield* rpc[methods.peerOwnershipTake]({
        workspace: "acme",
        project: "other",
        task: "ord-12",
      }).pipe(Effect.result);
      assert.isTrue(Result.isFailure(off));
      assert.strictEqual(sent(hub).length, before);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("save the owner map, and hand a save that lost its race the map as it is saved", () =>
    Effect.gen(function* () {
      const current: { view: ReturnType<typeof viewOf>; route?: Route } = {
        view: viewOf(),
        route: (url) =>
          url === `${ACME}/projects/app/ownership`
            ? [200, { map: saved, changed: true }]
            : undefined,
      };
      const hub = yield* standInHub({ current: acmeHub(current) });
      const peer = yield* ownershipPeer(hub, EVA);
      const rpc = yield* rpcOver(peer.plugins);
      const input = {
        workspace: "acme",
        project: "app",
        version: 7,
        areas: saved.areas,
        paths: saved.paths,
        decide: saved.decide,
      };
      assert.deepStrictEqual(yield* rpc[methods.peerOwnershipSetMap](input), {
        kind: "saved",
        map: saved,
        changed: true,
      });
      assert.strictEqual(
        hub.calls.find((call) => call.method === "PUT")?.body,
        '{"version":7,"areas":{"Payments":"ana@acme.test"},"paths":{"src/payments/**":"ana@acme.test"},"decide":["src/payments/**"]}',
      );
      current.route = () => [
        409,
        {
          error: {
            code: "owner_map_changed",
            message: "Saved by someone else.",
            details: { version: 8, map: saved },
          },
        },
      ];
      assert.deepStrictEqual(yield* rpc[methods.peerOwnershipSetMap](input), {
        kind: "conflict",
        map: saved,
      });
      // Any other refusal is the Hub's own words.
      current.route = () => [
        403,
        { error: { code: "ownership_forbidden", message: "Only a lead saves the owner map." } },
      ];
      const refused = yield* rpc[methods.peerOwnershipSetMap](input).pipe(Effect.flip);
      assert.strictEqual(refused.message, "Only a lead saves the owner map.");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("decide a call with its note, withdraw one, and say what the Hub refused", () =>
    Effect.gen(function* () {
      const accepted = callOf({
        state: "accepted",
        decidedBy: ANA,
        note: "keep fees in integer cents",
      });
      const current: { view: ReturnType<typeof viewOf>; route?: Route } = {
        view: viewOf(projectOf({ calls: [callOf()] })),
        route: (url) => (url === `${CALLS}/oc-7f2a/decide` ? [200, { call: accepted }] : undefined),
      };
      const hub = yield* standInHub({ current: acmeHub(current) });
      const peer = yield* ownershipPeer(hub, ANA);
      yield* ownershipWhen(peer.status, hasProject);
      const rpc = yield* rpcOver(peer.plugins);
      current.view = viewOf(projectOf({ calls: [accepted] }));
      const decided = yield* rpc[methods.peerOwnershipDecide]({
        workspace: "acme",
        project: "app",
        id: "oc-7f2a",
        decision: "accept",
        note: "keep fees in integer cents",
      });
      assert.deepStrictEqual(decided, { call: accepted });
      assert.strictEqual(
        (yield* ownershipWhen(peer.status, (o) => o?.projects[0]?.calls[0]?.state === "accepted"))
          ?.projects[0]?.calls[0]?.note,
        "keep fees in integer cents",
      );

      current.route = () => [
        409,
        {
          error: {
            code: "owner_call_closed",
            message: "this owner's call is accepted",
            details: { state: "accepted" },
          },
        },
      ];
      const closed = yield* rpc[methods.peerOwnershipDecide]({
        workspace: "acme",
        project: "app",
        id: "oc-7f2a",
        decision: "decline",
      }).pipe(Effect.flip);
      assert.strictEqual(closed.message, "this owner's call is accepted");

      current.route = () => [200, { call: callOf({ state: "withdrawn" }) }];
      const withdrawn = yield* rpc[methods.peerOwnershipWithdraw]({
        workspace: "acme",
        project: "app",
        id: "oc-7f2a",
      });
      assert.strictEqual(withdrawn.call.state, "withdrawn");
      assert.deepStrictEqual(sent(hub), [
        [
          "POST",
          `${CALLS}/oc-7f2a/decide`,
          '{"decision":"accept","note":"keep fees in integer cents"}',
        ],
        ["POST", `${CALLS}/oc-7f2a/decide`, '{"decision":"decline"}'],
        ["POST", `${CALLS}/oc-7f2a/withdraw`, "{}"],
      ]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("are refused before anything runs while the plugin is off", () =>
    Effect.gen(function* () {
      const hub = yield* standInHub({ current: acmeHub({ view: viewOf() }) });
      const peer = yield* ownershipPeer(hub);
      const rpc = yield* rpcOver(peer.plugins);
      yield* peer.plugins.setPlugin({ id: "ownership", enabled: false });
      const before = hub.calls.length;
      const refused = yield* rpc[methods.peerOwnershipList]({ workspace: "acme" }).pipe(
        Effect.flip,
      );
      assert.strictEqual(refused.message, "Ownership is turned off on this environment.");
      assert.strictEqual(hub.calls.length, before);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
