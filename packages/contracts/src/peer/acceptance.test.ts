import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { AuthOrchestrationOperateScope, AuthOrchestrationReadScope } from "../auth.ts";
import { AcceptanceRpcScopes, PEER_ACCEPTANCE_METHODS } from "./acceptance.rpc.ts";
import {
  PEER_ACCEPTANCE_PLUGIN,
  PeerAcceptanceInput,
  PeerAcceptanceStatus,
  PeerTaskAcceptance,
} from "./acceptance.ts";
import { PeerHandoffPackage } from "./handoff.ts";
import { PEER_PLUGIN_IDS } from "./plugin.ts";
import { peerPluginStatusFields } from "./registry.ts";
import { PEER_RPC_SCOPES, PEER_WS_METHODS } from "./rpcRegistry.ts";

const decodeTask = Schema.decodeUnknownSync(PeerTaskAcceptance);
const decodeInput = Schema.decodeUnknownSync(PeerAcceptanceInput);
const decodeStatus = Schema.decodeUnknownSync(PeerAcceptanceStatus);

const place = { workspace: "acme", project: "pay", task: "vl-7" };

describe("acceptance wire", () => {
  it("decodes a task's acceptance and history and drops what a newer Hub adds", () => {
    const view = {
      ...place,
      current: {
        by: "ana@acme.test",
        at: "2026-10-28T10:00:00Z",
        note: "Checked on staging",
        statusThen: "review",
      },
      history: [
        { kind: "accepted", by: "ana@acme.test", at: "2026-10-27T10:00:00Z" },
        { kind: "withdrawn", by: "ana@acme.test", at: "2026-10-27T11:00:00Z", note: "Refunds" },
        {
          kind: "accepted",
          by: "ana@acme.test",
          at: "2026-10-28T10:00:00Z",
          note: "Checked on staging",
        },
      ],
    };
    expect(decodeTask({ ...view, future: 1 })).toEqual(view);
    // A kind a newer Hub names still decodes.
    expect(
      decodeTask({ ...view, history: [{ kind: "disputed", by: "x", at: "y" }] }).history[0]?.kind,
    ).toBe("disputed");
    expect(decodeTask({ ...view, current: null }).current).toBeNull();
    expect(decodeStatus({ accepted: [] })).toEqual({ accepted: [] });
  });

  it("bounds a note as the Hub does and needs an op", () => {
    expect(decodeInput({ ...place, op: "op-1" })).toEqual({ ...place, op: "op-1" });
    expect(decodeInput({ ...place, op: "op-1", note: "é".repeat(300) }).note).toHaveLength(300);
    expect(() => decodeInput({ ...place, op: "op-1", note: "x".repeat(301) })).toThrow();
    expect(() => decodeInput({ ...place })).toThrow();
    expect(() => decodeInput({ ...place, op: "" })).toThrow();
  });

  it("rides on a handoff package when the Hub joins it, and is absent from an older Hub's", () => {
    const pkg = {
      number: 1,
      project: "pay",
      task: "vl-7",
      title: "Refunds",
      author: "cyril@acme.test",
      source: "agent",
      composedAt: "2026-10-28T10:05:00Z",
      context: null,
      inputs: [],
      overlaps: [],
      pullRequests: [],
    };
    const decode = Schema.decodeUnknownSync(PeerHandoffPackage);
    expect(decode(pkg).acceptance).toBeUndefined();
    expect(
      decode({ ...pkg, acceptance: { by: "ana@acme.test", at: "2026-10-28T10:00:00Z" } })
        .acceptance,
    ).toEqual({ by: "ana@acme.test", at: "2026-10-28T10:00:00Z" });
  });

  it("is a plugin of its own, listed in every registry", () => {
    expect(PEER_PLUGIN_IDS).toContain(PEER_ACCEPTANCE_PLUGIN.id);
    expect(PEER_ACCEPTANCE_PLUGIN.hubFeature).toEqual({ id: "acceptance", revision: 1 });
    expect(peerPluginStatusFields).toHaveProperty("acceptance");
    expect(AcceptanceRpcScopes).toEqual({
      [PEER_ACCEPTANCE_METHODS.peerAcceptanceView]: AuthOrchestrationReadScope,
      [PEER_ACCEPTANCE_METHODS.peerAcceptanceAccept]: AuthOrchestrationOperateScope,
      [PEER_ACCEPTANCE_METHODS.peerAcceptanceWithdraw]: AuthOrchestrationOperateScope,
    });
    for (const method of Object.values(PEER_ACCEPTANCE_METHODS)) {
      expect(Object.values(PEER_WS_METHODS)).toContain(method);
      expect(PEER_RPC_SCOPES).toHaveProperty(method);
    }
  });
});
