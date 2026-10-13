import {
  EnvironmentId,
  WS_METHODS,
  type PeerAgreement,
  type PeerAgreementsStatus,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AtomRegistry, Atom } from "effect/unstable/reactivity";

import {
  AVAILABLE_CONNECTION_STATE,
  PrimaryConnectionTarget,
  type PreparedConnection,
  type SupervisorConnectionState,
} from "../connection/model.ts";
import * as EnvironmentRegistry from "../connection/registry.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import type { WsRpcProtocolClient } from "../rpc/protocol.ts";
import type { RpcSession } from "../rpc/session.ts";
import {
  AGREEMENT_REOPEN_WITHIN_MS,
  agreementClosedLabel,
  agreementStateLabel,
  agreementTaskKey,
  agreementsOfTask,
  agreementsRevision,
  canClose,
  canReopen,
  createPeerAgreementsAtoms,
  dueForPerson,
  otherTask,
} from "./agreements.ts";
import { createPeerPluginAtoms } from "./atoms.ts";

const DAY = 86_400_000;
const settledAt = "2026-10-13T11:18:22Z";
const settledMs = Date.parse(settledAt);

/** An agreement between KRK-1 (Ana's agent) and KRK-2 (Bob's, who settled it), open until overridden. */
const agreement = (id: string, over: Partial<PeerAgreement> = {}): PeerAgreement => ({
  id,
  project: "lab",
  tasks: ["krk-1", "krk-2"],
  words: "Loyalty keeps euros; src/loyalty.js divides by 100 once KRK-1 lands",
  by: { email: "bob@acme.test", task: "krk-2" },
  settledAt,
  sides: [
    { session: "claude:abc", environment: "env-a", email: "ana@acme.test", task: "krk-1" },
    { session: "codex:def", environment: "env-b", email: "bob@acme.test", task: "krk-2" },
  ],
  state: "open",
  landed: [],
  ...over,
});
/** KRK-1 landed, so it is due for KRK-2 unless said otherwise. */
const due = (id: string, over: Partial<PeerAgreement> = {}) =>
  agreement(id, { state: "due", dueFor: "krk-2", landed: ["krk-1"], ...over });
const closed = (id: string, why: string, by?: string, over: Partial<PeerAgreement> = {}) =>
  agreement(id, {
    state: "closed",
    closed: { at: "2026-10-13T12:30:00Z", ...(by === undefined ? {} : { by }), why },
    ...over,
  });
const view = (...agreements: ReadonlyArray<PeerAgreement>) => ({
  agreements,
  at: "2026-10-13T13:00:00Z",
});
const ids = (agreements: ReadonlyArray<PeerAgreement>) => agreements.map(({ id }) => id);

describe("a task's agreements", () => {
  const all = view(
    closed("closed-old", "handled", "ana@acme.test", { settledAt: "2026-10-01T09:00:00Z" }),
    agreement("open-old", { settledAt: "2026-10-05T09:00:00Z" }),
    closed("closed-new", "replaced", undefined, { settledAt: "2026-10-12T09:00:00Z" }),
    due("due-mid", { settledAt: "2026-10-09T09:00:00Z" }),
    agreement("open-new", { tasks: ["krk-2", "krk-3"], settledAt: "2026-10-13T09:00:00Z" }),
    agreement("paused", { state: "paused", settledAt: "2026-10-11T09:00:00Z" }),
    agreement("other-project", { project: "other" }),
    agreement("other-pair", { tasks: ["krk-3", "krk-4"] }),
  );

  it("lists those of the task in the project: not closed first, then closed, each newest first", () => {
    expect(ids(agreementsOfTask(all, "lab", "krk-2"))).toEqual([
      "open-new",
      "paused",
      "due-mid",
      "open-old",
      "closed-new",
      "closed-old",
    ]);
    // KRK-1 is in the other pair of the same project, but not in open-new's.
    expect(ids(agreementsOfTask(all, "lab", "krk-1"))).toEqual([
      "paused",
      "due-mid",
      "open-old",
      "closed-new",
      "closed-old",
    ]);
    expect(ids(agreementsOfTask(all, "other", "krk-1"))).toEqual(["other-project"]);
    expect(agreementsOfTask(all, "lab", "krk-9")).toEqual([]);
  });

  it("is empty before a view is read, and leaves the view as it was", () => {
    expect(agreementsOfTask(undefined, "lab", "krk-1")).toEqual([]);
    const before = ids(all.agreements);
    agreementsOfTask(all, "lab", "krk-2");
    expect(ids(all.agreements)).toEqual(before);
  });

  it("tells moments apart by time, not by how they are written", () => {
    const sorted = agreementsOfTask(
      view(
        agreement("b-whole", { settledAt: "2026-10-13T11:18:22Z" }),
        agreement("a-half", { settledAt: "2026-10-13T11:18:22.500Z" }),
        agreement("d-same", { settledAt: "2026-10-13T11:00:00Z" }),
        agreement("c-same", { settledAt: "2026-10-13T11:00:00Z" }),
        agreement("e-unreadable", { settledAt: "soon" }),
      ),
      "lab",
      "krk-1",
    );
    // A string comparison would put "…22Z" before "…22.500Z"; the same moment falls back to the id.
    expect(ids(sorted)).toEqual(["a-half", "b-whole", "c-same", "d-same", "e-unreadable"]);
  });

  it("names the other task of the pair, from either side", () => {
    expect(otherTask(agreement("a"), "krk-1")).toBe("krk-2");
    expect(otherTask(agreement("a"), "krk-2")).toBe("krk-1");
    expect(otherTask(agreement("a"), "krk-3")).toBeUndefined();
    expect(otherTask({ tasks: ["krk-1", "krk-1"] }, "krk-1")).toBeUndefined();
  });
});

describe("agreements that wait on a person", () => {
  const live = new Set([agreementTaskKey("lab", "krk-2")]);
  const { dueFor: _dueFor, ...withoutDueFor } = due("no-due-for");
  const all = view(
    due("mine"),
    due("mine-too", { settledAt: "2026-10-13T13:00:00Z" }),
    // Due for KRK-1, where Ana's agent took part; Bob's agent was on the task that landed.
    due("anas", { dueFor: "krk-1", landed: ["krk-2"] }),
    due("other-project", { project: "other" }),
    withoutDueFor,
    agreement("open"),
    closed("closed", "handled", "bob@acme.test"),
  );

  it("are the due ones on a task whose agents took part, while nobody works on that task", () => {
    expect(ids(dueForPerson(all, "bob@acme.test", new Set()))).toEqual([
      "mine-too",
      "mine",
      "other-project",
    ]);
    expect(ids(dueForPerson(all, "ana@acme.test", new Set()))).toEqual(["anas"]);
    expect(dueForPerson(all, "cyril@acme.test", new Set())).toEqual([]);
  });

  it("stop waiting once an agent is live on the task that is due, in that project", () => {
    expect(ids(dueForPerson(all, "bob@acme.test", live))).toEqual(["other-project"]);
    // An agent on the task that landed is no one to hear it.
    expect(
      ids(dueForPerson(all, "ana@acme.test", new Set([agreementTaskKey("lab", "krk-2")]))),
    ).toEqual(["anas"]);
    expect(dueForPerson(all, "ana@acme.test", new Set([agreementTaskKey("lab", "krk-1")]))).toEqual(
      [],
    );
  });

  it("match an address in any case, and are none before a view is read", () => {
    expect(ids(dueForPerson(all, "Bob@Acme.TEST", new Set()))).toHaveLength(3);
    expect(dueForPerson(undefined, "bob@acme.test", new Set())).toEqual([]);
    expect(dueForPerson(all, "", new Set())).toEqual([]);
  });

  it("keys a task by its project, so the same id in two projects is two tasks", () => {
    expect(agreementTaskKey("lab", "krk-1")).toBe("lab/krk-1");
    expect(agreementTaskKey("lab", "krk-1")).not.toBe(agreementTaskKey("other", "krk-1"));
  });
});

describe("closing and reopening", () => {
  const person = closed("p", "handled", "ana@acme.test");
  const now = settledMs + 3 * DAY;

  it("lets a person close what is open or due, and nothing else", () => {
    expect(canClose(agreement("a"))).toBe(true);
    expect(canClose(due("a"))).toBe(true);
    expect(canClose(person)).toBe(false);
    expect(canClose(agreement("a", { state: "paused" }))).toBe(false);
  });

  it("lets a person reopen what a person closed, while no task landed and within 30 days", () => {
    expect(canReopen(person, now)).toBe(true);
    expect(canReopen(closed("p", "not-needed", "bob@acme.test"), now)).toBe(true);
    expect(AGREEMENT_REOPEN_WITHIN_MS).toBe(30 * DAY);
    expect(canReopen(person, settledMs + 30 * DAY - 1)).toBe(true);
    expect(canReopen(person, settledMs + 30 * DAY)).toBe(false);
    expect(canReopen(person, settledMs + 40 * DAY)).toBe(false);
  });

  it("does not offer what the Hub would refuse", () => {
    // A task landed.
    expect(canReopen(closed("p", "handled", "ana@acme.test", { landed: ["krk-1"] }), now)).toBe(
      false,
    );
    // The Hub closed it: replaced, expired, removed or landed carry no person.
    for (const why of ["replaced", "expired", "removed", "landed"]) {
      expect(canReopen(closed("h", why), now)).toBe(false);
    }
    // Not closed by a person, whatever the reason says.
    expect(canReopen(closed("h", "handled"), now)).toBe(false);
    expect(canReopen(closed("h", "expired", "ana@acme.test"), now)).toBe(false);
    expect(canReopen(closed("h", "superseded", "ana@acme.test"), now)).toBe(false);
    // Not closed at all, or a settle time that cannot be read.
    expect(canReopen(agreement("o"), now)).toBe(false);
    expect(canReopen(due("d"), now)).toBe(false);
    expect(canReopen(closed("p", "handled", "ana@acme.test", { settledAt: "soon" }), now)).toBe(
      false,
    );
    expect(canReopen(agreement("g", { state: "gone", closed: person.closed! }), now)).toBe(false);
  });
});

describe("the words of a state", () => {
  const task = (id: string) => id.toUpperCase();
  const name = (email: string) => (email === "ana@acme.test" ? "Ana" : email);
  const label = (a: PeerAgreement) => agreementStateLabel(a, task, name);

  it("says open, and which task landed when it is due", () => {
    expect(label(agreement("a"))).toBe("Open");
    expect(label(due("a"))).toBe("Due — KRK-1 landed");
    expect(label(due("a", { dueFor: "krk-1", landed: ["krk-2"] }))).toBe("Due — KRK-2 landed");
    // Without dueFor, the task that landed is what the Hub lists as landed.
    const { dueFor: _dueFor, ...withoutDueFor } = due("a");
    expect(label(withoutDueFor)).toBe("Due — KRK-1 landed");
    expect(label({ ...withoutDueFor, landed: [] })).toBe("Due");
  });

  it("says how it closed, and who closed it when a person did", () => {
    expect(label(closed("a", "handled", "ana@acme.test"))).toBe("Closed · handled by Ana");
    expect(label(closed("a", "not-needed", "ana@acme.test"))).toBe("Closed · not needed by Ana");
    expect(label(closed("a", "handled", "bob@acme.test"))).toBe(
      "Closed · handled by bob@acme.test",
    );
    expect(label(closed("a", "handled"))).toBe("Closed · handled");
    expect(label(closed("a", "replaced"))).toBe("Replaced");
    expect(label(closed("a", "expired"))).toBe("Expired");
    expect(label(closed("a", "landed"))).toBe("Both landed");
    expect(label(closed("a", "removed"))).toBe("Task removed");
  });

  it("names the person by their address when it is not told how to", () => {
    expect(agreementStateLabel(closed("a", "handled", "ana@acme.test"), task)).toBe(
      "Closed · handled by ana@acme.test",
    );
    expect(agreementClosedLabel({ at: settledAt, by: "ana@acme.test", why: "not-needed" })).toBe(
      "Closed · not needed by ana@acme.test",
    );
  });

  it("falls back to a neutral word for a state or a reason a newer Hub names", () => {
    expect(label(closed("a", "superseded", "ana@acme.test"))).toBe("Closed");
    expect(label(closed("a", "constructor"))).toBe("Closed");
    expect(label(agreement("a", { state: "closed" }))).toBe("Closed");
    expect(agreementClosedLabel(undefined)).toBe("Closed");
    expect(label(agreement("a", { state: "snoozed" }))).toBe("Unknown state");
    expect(label(agreement("a", { state: "" }))).toBe("Unknown state");
  });
});

describe("the status field as a cache key", () => {
  const status = (acme: { open: number; due?: ReadonlyArray<string> }): PeerAgreementsStatus => ({
    enabled: true,
    forcedOff: false,
    hubSupport: "supported",
    workspaces: [
      {
        workspace: "acme",
        open: acme.open,
        dueForMe: (acme.due ?? []).map((id) => ({ project: "lab", id })),
      },
      { workspace: "beta", open: 1, dueForMe: [] },
    ],
  });

  it("moves with the count of agreements not closed and with the ones due for the person", () => {
    const key = agreementsRevision(status({ open: 2, due: ["a1"] }), "acme");
    expect(key).toBe("2|lab/a1");
    expect(agreementsRevision(status({ open: 3, due: ["a1"] }), "acme")).not.toBe(key);
    expect(agreementsRevision(status({ open: 2, due: ["a1", "a2"] }), "acme")).not.toBe(key);
    expect(agreementsRevision(status({ open: 2, due: ["a2"] }), "acme")).not.toBe(key);
    expect(agreementsRevision(status({ open: 2 }), "acme")).toBe("2|");
  });

  it("holds still for another workspace's change, and is empty where nothing is known", () => {
    const beta = agreementsRevision(status({ open: 2 }), "beta");
    expect(agreementsRevision(status({ open: 9, due: ["x"] }), "beta")).toBe(beta);
    expect(agreementsRevision(status({ open: 2 }), "gone")).toBe("");
    expect(agreementsRevision(undefined, "acme")).toBe("");
  });
});

/** The agreements atoms on an environment whose RPC client is `client`. */
const atomsOn = (client: Record<string, (input: unknown) => Effect.Effect<unknown>>) =>
  Effect.gen(function* () {
    const target = new PrimaryConnectionTarget({
      environmentId: EnvironmentId.make("laptop"),
      label: "Laptop",
      httpBaseUrl: "https://environment.test",
      wsBaseUrl: "wss://environment.test",
    });
    const session: RpcSession = {
      client: client as unknown as WsRpcProtocolClient,
      initialConfig: Effect.never,
      subscribeServerConfig: () => Stream.never,
      ready: Effect.void,
      probe: Effect.void,
      closed: Effect.never,
    };
    const supervisor = EnvironmentSupervisor.EnvironmentSupervisor.of({
      target,
      state: yield* SubscriptionRef.make<SupervisorConnectionState>({
        ...AVAILABLE_CONNECTION_STATE,
        desired: true,
        network: "online",
        phase: "connected",
        attempt: 1,
        generation: 1,
      }),
      session: yield* SubscriptionRef.make(Option.some(session)),
      prepared: yield* SubscriptionRef.make(Option.none<PreparedConnection>()),
      connect: Effect.void,
      disconnect: Effect.void,
      retryNow: Effect.void,
    });
    const environments = EnvironmentRegistry.EnvironmentRegistry.of({
      run: (_id, effect) =>
        Effect.provideService(effect, EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
      followStream: (_id, stream) =>
        Stream.provideService(stream, EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
    } as EnvironmentRegistry.EnvironmentRegistry["Service"]);
    const registry = AtomRegistry.make();
    yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()));
    const runtime = Atom.runtime(
      Layer.succeed(EnvironmentRegistry.EnvironmentRegistry, environments),
    );
    return {
      atoms: createPeerAgreementsAtoms(runtime),
      all: createPeerPluginAtoms(runtime),
      registry,
      environmentId: target.environmentId,
    };
  });

describe("the atoms", () => {
  it.effect("read the Hub's view for the place they are asked for, without the cache key", () =>
    Effect.gen(function* () {
      const inputs: Array<object> = [];
      const answer = { agreements: [agreement("a")], at: "2026-10-13T13:00:00Z" };
      const { atoms, registry, environmentId } = yield* atomsOn({
        [WS_METHODS.peerAgreementsView]: (input) =>
          Effect.sync(() => {
            inputs.push(input as object);
            return answer;
          }),
      });
      const read = (input: { workspace: string; project?: string }, revision?: string) =>
        AtomRegistry.getResult(
          registry,
          atoms.peerAgreementsView({
            environmentId,
            input,
            ...(revision === undefined ? {} : { revision }),
          }),
          { suspendOnWaiting: true },
        );
      expect(yield* read({ workspace: "acme", project: "lab" }, "2|lab/a1")).toEqual(answer);
      expect(inputs[0]).toStrictEqual({ workspace: "acme", project: "lab" });
      expect(yield* read({ workspace: "acme" })).toEqual(answer);
      // A view of every project asks for no project at all; the cache key is never sent.
      expect(inputs.find((input) => !("project" in input))).toStrictEqual({ workspace: "acme" });
      expect(inputs.every((input) => !("revision" in input))).toBe(true);
    }).pipe(Effect.scoped),
  );

  it.effect("keep a view per place, and per cache key: a moved key is another view", () =>
    Effect.gen(function* () {
      const { atoms, environmentId } = yield* atomsOn({});
      const place = { workspace: "acme", project: "lab" };
      const view = (revision?: string) =>
        atoms.peerAgreementsView({
          environmentId,
          input: place,
          ...(revision === undefined ? {} : { revision }),
        });
      expect(view("1|")).toBe(view("1|"));
      expect(view("1|")).not.toBe(view("2|"));
      expect(view("1|")).not.toBe(view());
      expect(view()).toBe(view());
      expect(atoms.peerAgreementsView({ environmentId, input: { workspace: "acme" } })).not.toBe(
        view(),
      );
    }).pipe(Effect.scoped),
  );

  it.effect(
    "close and reopen with the method they are named for, and hand back the Hub's answer",
    () =>
      Effect.gen(function* () {
        const calls: Array<readonly [string, unknown]> = [];
        const answer = (method: string, result: unknown) => (input: unknown) =>
          Effect.sync(() => {
            calls.push([method, input]);
            return result;
          });
        const handled = closed("a", "handled", "ana@acme.test");
        const { atoms, registry, environmentId } = yield* atomsOn({
          [WS_METHODS.peerAgreementsClose]: answer("close", { agreement: handled }),
          [WS_METHODS.peerAgreementsReopen]: answer("reopen", { agreement: agreement("a") }),
        });
        const run = <A>(started: Promise<A>) => Effect.promise(() => started);
        const base = { workspace: "acme", project: "lab", id: "a" };
        const closedNow = yield* run(
          atoms.peerAgreementsClose.run(registry, {
            environmentId,
            input: { ...base, why: "not-needed" },
          }),
        );
        const reopened = yield* run(
          atoms.peerAgreementsReopen.run(registry, { environmentId, input: base }),
        );
        expect([closedNow._tag, reopened._tag]).toEqual(["Success", "Success"]);
        expect(closedNow._tag === "Success" ? closedNow.value : null).toEqual({
          agreement: handled,
        });
        expect(reopened._tag === "Success" ? reopened.value : null).toEqual({
          agreement: agreement("a"),
        });
        expect(calls).toEqual([
          ["close", { ...base, why: "not-needed" }],
          ["reopen", base],
        ]);
      }).pipe(Effect.scoped),
  );

  it.effect("are among the plugins' atoms the apps reach through the server's", () =>
    Effect.gen(function* () {
      const { all } = yield* atomsOn({});
      expect(
        Object.keys(all)
          .filter((name) => name.startsWith("peerAgreements"))
          .toSorted(),
      ).toEqual(["peerAgreementsClose", "peerAgreementsReopen", "peerAgreementsView"]);
    }).pipe(Effect.scoped),
  );
});
