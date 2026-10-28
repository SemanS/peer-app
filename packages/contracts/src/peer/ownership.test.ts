import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "@effect/vitest";

import { AuthOrchestrationOperateScope, AuthOrchestrationReadScope } from "../auth.ts";
import { NEEDS_YOU_KINDS, needsYouKey, needsYouPushId } from "./needs-you.ts";
import { OwnershipRpcGroup, OwnershipRpcScopes, PEER_OWNERSHIP_METHODS } from "./ownership.rpc.ts";
import {
  PEER_OWNERSHIP_LIMITS,
  PEER_OWNERSHIP_PLUGIN,
  PEER_OWNER_CALL_STATES,
  PEER_TASK_OWNER_REASONS,
  PeerOwnershipAskResult,
  PeerOwnershipDecideInput,
  PeerOwnershipSetMapInput,
  PeerOwnershipSetMapResult,
  PeerOwnershipSetTaskOwnerInput,
  PeerOwnershipSetTaskOwnerResult,
  PeerOwnershipStatus,
  PeerOwnershipView,
} from "./ownership.ts";
import { PEER_PLUGIN_IDS } from "./plugin.ts";
import { peerPluginStatusFields } from "./registry.ts";
import { PEER_RPC_SCOPES } from "./rpcRegistry.ts";

const decodeView = Schema.decodeUnknownSync(PeerOwnershipView);
const decodeSetTaskOwner = Schema.decodeUnknownExit(PeerOwnershipSetTaskOwnerInput);
const decodeSetMap = Schema.decodeUnknownExit(PeerOwnershipSetMapInput);
const decodeDecide = Schema.decodeUnknownExit(PeerOwnershipDecideInput);
const decodeMapResult = Schema.decodeUnknownSync(PeerOwnershipSetMapResult);
const decodeViewExit = Schema.decodeUnknownExit(PeerOwnershipView);
const decodeStatus = Schema.decodeUnknownSync(PeerOwnershipStatus);
const decodeTaskOwnerResult = Schema.decodeUnknownSync(PeerOwnershipSetTaskOwnerResult);
const decodeAsk = Schema.decodeUnknownSync(PeerOwnershipAskResult);
const isStatusFields = Schema.is(Schema.Struct(peerPluginStatusFields));

const map = {
  version: 7,
  areas: { Orders: "slavo@acme.test", Payments: "ana@acme.test" },
  paths: { "src/payments/**": "ana@acme.test" },
  decide: ["src/payments/**"],
  updatedAt: "2026-10-12T20:00:00Z",
  updatedBy: "slavo@acme.test",
};
const call = {
  id: "oc-7f2a",
  project: "ordering",
  task: "ord-9",
  session: "claude:b1",
  email: "bob@acme.test",
  environment: "bob-laptop",
  owner: "ana@acme.test",
  paths: ["src/payments/fees.ts"],
  reason: "add a refund fee field",
  state: "pending",
  onBehalf: false,
  createdAt: "2026-10-12T20:20:00Z",
  updatedAt: "2026-10-12T20:20:00Z",
  expiresAt: "2026-10-19T20:20:00Z",
};
/** What `GET /ownership` answers: the shapes the Hub writes, with and without its optional fields. */
const view = {
  projects: {
    ordering: {
      leads: ["slavo@acme.test"],
      map,
      tasks: {
        "ord-9": {
          project: "ordering",
          task: "ord-9",
          owner: "bob@acme.test",
          since: "2026-10-10T10:00:00Z",
          reason: "request",
        },
        "ord-14": {
          project: "ordering",
          task: "ord-14",
          owner: "cyril@acme.test",
          since: "2026-10-12T18:00:00Z",
          by: "slavo@acme.test",
          reason: "named",
        },
      },
      calls: [
        call,
        {
          ...call,
          id: "oc-1c3d",
          task: undefined,
          paths: ["src/payments/limits.ts", "src/payments/tax.ts"],
          state: "accepted",
          decidedBy: "slavo@acme.test",
          onBehalf: true,
          note: "keep fees in integer cents",
          updatedAt: "2026-10-12T20:40:00Z",
        },
      ],
    },
    quiet: {
      leads: [],
      map: { version: 0, areas: {}, paths: {}, decide: [] },
      tasks: {},
      calls: [],
    },
  },
  at: "2026-10-12T20:41:00Z",
};

describe("the Hub's view of ownership", () => {
  it("reads what the Hub writes, with its optional fields there and absent", () => {
    const read = decodeView(view);
    const ordering = read.projects["ordering"];
    expect(ordering?.map.updatedBy).toBe("slavo@acme.test");
    expect(read.projects["quiet"]?.map.updatedAt).toBeUndefined();
    expect(ordering?.tasks["ord-9"]?.by).toBeUndefined();
    expect(ordering?.tasks["ord-14"]?.by).toBe("slavo@acme.test");
    expect(ordering?.calls.map((c) => [c.id, c.task, c.state, c.onBehalf, c.decidedBy])).toEqual([
      ["oc-7f2a", "ord-9", "pending", false, undefined],
      ["oc-1c3d", undefined, "accepted", true, "slavo@acme.test"],
    ]);
  });

  it("reads a Hub of another age: a state, a reason or a field it does not know is no failure", () => {
    const newer = {
      ...view,
      projects: {
        ordering: {
          ...view.projects.ordering,
          tasks: {
            "ord-9": { ...view.projects.ordering.tasks["ord-9"], reason: "inherited", rank: 2 },
          },
          calls: [{ ...call, state: "superseded", priority: "high" }],
          sprint: 4,
        },
      },
    };
    const ordering = decodeView(newer).projects["ordering"];
    expect(ordering?.calls[0]?.state).toBe("superseded");
    expect(ordering?.tasks["ord-9"]?.reason).toBe("inherited");
    expect(ordering).not.toHaveProperty("sprint");
    expect(ordering?.calls[0]).not.toHaveProperty("priority");
  });

  it("lists the vocabularies the Hub writes today", () => {
    expect(PEER_TASK_OWNER_REASONS).toEqual(["first-agent", "request", "named", "handover"]);
    expect(PEER_OWNER_CALL_STATES).toEqual([
      "pending",
      "accepted",
      "declined",
      "withdrawn",
      "expired",
    ]);
  });

  it("refuses a call without what a decision needs, and a map without its version", () => {
    const { onBehalf: _onBehalf, ...unfinished } = call;
    const failing = (project: unknown) =>
      Exit.isFailure(decodeViewExit({ ...view, projects: { x: project } }));
    expect(failing({ ...view.projects.ordering, calls: [unfinished] })).toBe(true);
    expect(failing({ ...view.projects.ordering, map: { ...map, version: undefined } })).toBe(true);
    expect(failing({ ...view.projects.ordering, map: { ...map, version: -1 } })).toBe(true);
  });
});

describe("the status field", () => {
  const project = {
    workspace: "acme",
    project: "ordering",
    at: view.at,
    ...view.projects.ordering,
  };

  it("holds a view of each project, and is optional so a status without it stays valid", () => {
    expect(isStatusFields({})).toBe(true);
    expect(isStatusFields({ ownership: { projects: [project] } })).toBe(true);
    expect(isStatusFields({ ownership: { projects: [] } })).toBe(true);
    expect(isStatusFields({ ownership: { projects: [{ ...project, at: undefined }] } })).toBe(
      false,
    );
    expect(isStatusFields({ ownership: {} })).toBe(false);
    expect(decodeStatus({ projects: [project] }).projects).toHaveLength(1);
  });
});

describe("what a client sends", () => {
  const base = { workspace: "acme", project: "ordering" };

  it("names a task's owner by address, or takes it away with null", () => {
    expect(
      Exit.isSuccess(decodeSetTaskOwner({ ...base, task: "ord-9", owner: "ana@acme.test" })),
    ).toBe(true);
    expect(Exit.isSuccess(decodeSetTaskOwner({ ...base, task: "ord-9", owner: null }))).toBe(true);
    // Giving a task back is said, not left out.
    expect(Exit.isFailure(decodeSetTaskOwner({ ...base, task: "ord-9" }))).toBe(true);
    expect(Exit.isFailure(decodeSetTaskOwner({ ...base, task: "ord-9", owner: "" }))).toBe(true);
    const long = PEER_OWNERSHIP_LIMITS.opChars;
    for (const op of ["", "x".repeat(long + 1)]) {
      expect(Exit.isFailure(decodeSetTaskOwner({ ...base, task: "ord-9", owner: null, op }))).toBe(
        true,
      );
    }
    expect(
      Exit.isSuccess(
        decodeSetTaskOwner({ ...base, task: "ord-9", owner: null, op: "x".repeat(long) }),
      ),
    ).toBe(true);
  });

  it("saves the owner map from a version that is a count of saves", () => {
    const save = { ...base, version: 7, areas: {}, paths: {}, decide: [] };
    expect(Exit.isSuccess(decodeSetMap(save))).toBe(true);
    expect(Exit.isSuccess(decodeSetMap({ ...save, version: 0 }))).toBe(true);
    for (const version of [-1, 1.5, "7"])
      expect(Exit.isFailure(decodeSetMap({ ...save, version }))).toBe(true);
  });

  it("counts a note in characters, as the Hub does, not in UTF-16 units", () => {
    const decide = { ...base, id: "oc-7f2a", decision: "accept" as const };
    expect(Exit.isSuccess(decodeDecide(decide))).toBe(true);
    expect(Exit.isSuccess(decodeDecide({ ...decide, note: "😀".repeat(300) }))).toBe(true);
    expect(Exit.isFailure(decodeDecide({ ...decide, note: "x".repeat(301) }))).toBe(true);
    expect(Exit.isFailure(decodeDecide({ ...decide, note: "😀".repeat(301) }))).toBe(true);
    expect(Exit.isFailure(decodeDecide({ ...decide, decision: "maybe" }))).toBe(true);
  });
});

describe("what the plugin's methods answer", () => {
  it("reads the owner row after a change, or null once the task has none", () => {
    const row = view.projects.ordering.tasks["ord-14"];
    expect(decodeTaskOwnerResult({ task: "ord-14", owner: row, changed: true }).owner?.owner).toBe(
      "cyril@acme.test",
    );
    expect(
      decodeTaskOwnerResult({ task: "ord-14", owner: null, changed: true, replayed: true }),
    ).toEqual({
      task: "ord-14",
      owner: null,
      changed: true,
      replayed: true,
    });
  });

  it("tells a saved owner map from one that someone else saved first, with what is saved now", () => {
    expect(
      decodeMapResult({ kind: "saved", map: { ...map, version: 8 }, changed: true }),
    ).toMatchObject({
      kind: "saved",
      changed: true,
    });
    const conflict = decodeMapResult({ kind: "conflict", map: { ...map, version: 8 } });
    expect(conflict.kind === "conflict" ? conflict.map.version : null).toBe(8);
    expect(() => decodeMapResult({ kind: "forbidden", map })).toThrow();
  });

  it("reads the Hub's answer to an agent's ask: one call per owner, and which it only added to", () => {
    const answer = decodeAsk({
      calls: [call],
      merged: ["oc-7f2a"],
      at: view.at,
      replayed: true,
    });
    expect(answer.merged).toEqual(["oc-7f2a"]);
  });
});

describe("wiring", () => {
  it("lists the plugin before settings, which stays last, and names its Hub feature", () => {
    const at = PEER_PLUGIN_IDS.indexOf("ownership");
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(PEER_PLUGIN_IDS.indexOf("settings"));
    expect(PEER_PLUGIN_IDS.at(-1)).toBe("settings");
    expect(PEER_OWNERSHIP_PLUGIN).toMatchObject({
      id: "ownership",
      title: "Ownership",
      defaultEnabled: true,
      hubFeature: { id: "ownership", revision: 1 },
    });
  });

  it("names its methods peer.ownership.<name>, readable by anyone and changed by operators", () => {
    expect(Object.values(PEER_OWNERSHIP_METHODS)).toEqual([
      "peer.ownership.list",
      "peer.ownership.setTaskOwner",
      "peer.ownership.setMap",
      "peer.ownership.decide",
      "peer.ownership.withdraw",
      "peer.ownership.take",
    ]);
    expect(new Set(OwnershipRpcGroup.requests.keys())).toEqual(
      new Set(Object.values(PEER_OWNERSHIP_METHODS)),
    );
    expect(OwnershipRpcScopes[PEER_OWNERSHIP_METHODS.peerOwnershipList]).toBe(
      AuthOrchestrationReadScope,
    );
    for (const method of [
      PEER_OWNERSHIP_METHODS.peerOwnershipSetTaskOwner,
      PEER_OWNERSHIP_METHODS.peerOwnershipSetMap,
      PEER_OWNERSHIP_METHODS.peerOwnershipDecide,
      PEER_OWNERSHIP_METHODS.peerOwnershipWithdraw,
      PEER_OWNERSHIP_METHODS.peerOwnershipTake,
    ]) {
      expect(OwnershipRpcScopes[method]).toBe(AuthOrchestrationOperateScope);
    }
    for (const method of Object.values(PEER_OWNERSHIP_METHODS)) {
      expect(PEER_RPC_SCOPES[method]).toBe(OwnershipRpcScopes[method]);
    }
  });

  it("gives an owner's call its own Needs-you kind and key, and no phone alert yet", () => {
    expect(NEEDS_YOU_KINDS).toContain("owner-call");
    const key = needsYouKey.ownerCall("acme", "ordering", "oc-7f2a");
    expect(key).toBe("owner-call:acme/ordering/oc-7f2a");
    expect(key).not.toBe(needsYouKey.request("acme", "oc-7f2a"));
    expect(needsYouKey.ownerCall("a/b", "c", "d")).not.toBe(needsYouKey.ownerCall("a", "b/c", "d"));
    expect(needsYouPushId(key)).toBeNull();
  });
});
