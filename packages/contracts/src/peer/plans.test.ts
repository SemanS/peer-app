import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { PEER_PLUGIN_IDS } from "./plugin.ts";
import { PEER_PLANS_METHODS, PlansRpcScopes } from "./plans.rpc.ts";
import {
  PeerPlanDeclaration,
  PeerPlanDeclared,
  PeerPlansPlace,
  PeerPlansStatus,
  PeerPlansView,
  PeerPlanWithdrawn,
} from "./plans.ts";
import { peerPluginStatusFields } from "./registry.ts";
import { PEER_RPC_SCOPES, PEER_WS_METHODS, PeerRpcGroup } from "./rpcRegistry.ts";

const decodeView = Schema.decodeUnknownSync(PeerPlansView);
const decodeDeclared = Schema.decodeUnknownSync(PeerPlanDeclared);
const decodeWithdrawn = Schema.decodeUnknownSync(PeerPlanWithdrawn);
const decodeDeclaration = Schema.decodeUnknownSync(PeerPlanDeclaration);
const decodePlace = Schema.decodeUnknownSync(PeerPlansPlace);
const decodeStatus = Schema.decodeUnknownSync(PeerPlansStatus);
const isStatusFields = Schema.is(Schema.Struct(peerPluginStatusFields));

/** A plan as the Hub's `Plan` serializes it: the stored row flattened, with whether its session is live. */
const plan = {
  project: "pay",
  session: "claude:b",
  email: "bob@acme.test",
  environment: "bob-mac",
  task: "ord-9",
  label: "Refund fee field",
  seq: 1_791_800_000_000,
  version: 2,
  changes: [{ path: "src/payments/fees.ts", name: "Fee.refundCents" }],
  maybes: [{ path: "src/payments/" }],
  uses: [{ path: "src/tax.ts", name: "applyTax" }],
  provides: [
    {
      name: "Fee.refundCents",
      path: "src/payments/fees.ts",
      contract: "integer cents, never negative",
    },
  ],
  declaredAt: "2026-10-12T20:00:00Z",
  updatedAt: "2026-10-12T20:12:00Z",
  live: true,
};
const side = (session: string, task?: string) => ({
  session,
  email: "ana@acme.test",
  environment: "ana-mac",
  label: "Receipt totals",
  ...(task === undefined ? {} : { task }),
});
const withoutContract = {
  id: "0123456789abcdef",
  kind: "use",
  project: "pay",
  a: { ...side("claude:b", "ord-9"), email: "bob@acme.test", environment: "bob-mac" },
  b: side("codex:a", "ord-11"),
  item: { path: "src/tax.ts", name: "applyTax" },
  certain: true,
  observed: false,
};
const relation = { ...withoutContract, contract: "takes cents, returns cents" };
const at = "2026-10-12T20:13:00Z";

describe("plan wire contracts", () => {
  it("reads the Hub's view without keeping fields a newer Hub adds", () => {
    const view = decodeView({
      plans: [{ ...plan, future: "ignored" }],
      relations: [
        relation,
        {
          ...withoutContract,
          id: "fedcba9876543210",
          kind: "same-change",
          certain: false,
          observed: true,
        },
      ],
      omitted: 0,
      at,
    });
    expect(view.plans[0]).toEqual(plan);
    expect(view.relations.map((r) => [r.kind, r.certain, r.observed])).toEqual([
      ["use", true, false],
      ["same-change", false, true],
    ]);
    expect(view.relations[1]).not.toHaveProperty("contract");
  });

  it("reads a declaration's answer and a withdrawal's", () => {
    const declared = decodeDeclared({ plan, relations: [relation], omitted: 0, changed: true, at });
    expect(declared.changed).toBe(true);
    expect(declared.relations[0]?.contract).toBe("takes cents, returns cents");
    expect(decodeWithdrawn({ withdrawn: 2, at })).toEqual({ withdrawn: 2, at });
    expect(() => decodeWithdrawn({ withdrawn: -1, at })).toThrow();
  });

  it("refuses a relation of a kind the Hub does not name", () => {
    expect(() =>
      decodeView({
        plans: [],
        relations: [{ ...relation, kind: "uses-their-change" }],
        omitted: 0,
        at,
      }),
    ).toThrow();
  });

  it("holds what a declaration sends: paths, names and contract lines, never code", () => {
    const body = decodeDeclaration({
      environment: "bob-mac",
      session: "claude:b",
      seq: 1,
      mode: "amend",
      uses: [{ path: "src/tax.ts", name: "applyTax" }],
      code: "ignored",
    });
    expect(body).toEqual({
      environment: "bob-mac",
      session: "claude:b",
      seq: 1,
      mode: "amend",
      uses: [{ path: "src/tax.ts", name: "applyTax" }],
    });
    expect(() => decodeDeclaration({ environment: "e", session: "s", seq: 1.5 })).toThrow();
    expect(() =>
      decodeDeclaration({ environment: "e", session: "s", seq: 1, mode: "merge" }),
    ).toThrow();
  });

  it("names a place and the status field with counts only", () => {
    expect(decodePlace({ workspace: "acme", task: "ord-9" })).toEqual({
      workspace: "acme",
      task: "ord-9",
    });
    const status = {
      enabled: true,
      forcedOff: false,
      hubSupport: "supported",
      counts: [{ workspace: "acme", project: "pay", task: "ord-9", plans: 1, relations: 3 }],
      revision: 4,
    } as const;
    expect(decodeStatus(status)).toEqual(status);
    expect(isStatusFields({ plans: status })).toBe(true);
    expect(isStatusFields({})).toBe(true);
  });
});

describe("the plans plugin in Peer's registries", () => {
  it("is listed before settings, which stays last", () => {
    const listed = PEER_PLUGIN_IDS.indexOf("plans");
    expect(listed).toBeGreaterThan(0);
    expect(PEER_PLUGIN_IDS[listed + 1]).toBe("settings");
    expect(PEER_PLUGIN_IDS.at(-1)).toBe("settings");
  });

  it("adds one read method under its own name, merged into the Peer group and its scopes", () => {
    expect(PEER_PLANS_METHODS.peerPlansList).toBe("peer.plans.list");
    expect(PEER_WS_METHODS.peerPlansList).toBe("peer.plans.list");
    expect(PeerRpcGroup.requests.has("peer.plans.list")).toBe(true);
    expect(PEER_RPC_SCOPES["peer.plans.list"]).toBe(PlansRpcScopes["peer.plans.list"]);
    expect(PlansRpcScopes["peer.plans.list"]).toBe("orchestration:read");
  });
});
