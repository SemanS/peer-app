import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { AuthOrchestrationOperateScope, AuthOrchestrationReadScope } from "../auth.ts";
import { PEER_PLUGIN_IDS } from "./plugin.ts";
import { peerPluginStatusFields } from "./registry.ts";
import { PEER_RPC_SCOPES, PEER_WS_METHODS } from "./rpcRegistry.ts";
import { PEER_TEST_REPORTS_METHODS, TestReportsRpcScopes } from "./test-reports.rpc.ts";
import {
  PEER_TEST_REPORTS_PLUGIN,
  PeerTestReport,
  PeerTestsFileInput,
  PeerTestsSetOwnerInput,
  PeerTestsSetOwnerResult,
} from "./test-reports.ts";

const decodeReport = Schema.decodeUnknownSync(PeerTestReport);
const decodeFile = Schema.decodeUnknownSync(PeerTestsFileInput);
const decodeSetOwner = Schema.decodeUnknownSync(PeerTestsSetOwnerInput);
const decodeSetOwnerResult = Schema.decodeUnknownSync(PeerTestsSetOwnerResult);

const report = {
  project: "app",
  task: "vl-7",
  author: "ana@acme.test",
  number: 1,
  result: "mixed",
  summary: "Unit tests pass; the phone was not checked",
  items: [
    {
      kind: "pass",
      text: "cargo test features::handoff",
      seen: { failed: false, at: "2026-10-27T14:02:00Z" },
    },
    { kind: "unverified", text: "iPhone layout of the task page", owner: "slavo@acme.test" },
  ],
  role: "author",
  at: "2026-10-27T14:03:00Z",
};

describe("test reports wire", () => {
  it("decodes a report and drops what a newer Hub adds", () => {
    const decoded = decodeReport({
      ...report,
      future: true,
      items: report.items.map((item) => ({ ...item, future: 1 })),
    });
    expect(decoded).toEqual(report);
    // A role a newer Hub names still decodes.
    expect(decodeReport({ ...report, role: "pair" }).role).toBe("pair");
    expect(() => decodeReport({ ...report, result: "flaky" })).toThrow();
  });

  it("checks what a person files and saves", () => {
    const place = { workspace: "acme", project: "app", task: "vl-7" };
    expect(() =>
      decodeFile({
        ...place,
        result: "pass",
        summary: "  ",
        items: [],
      }),
    ).toThrow();
    expect(() =>
      decodeSetOwner({
        ...place,
        author: "ana@acme.test",
        index: 1,
        number: 0,
        owner: null,
      }),
    ).toThrow();
    expect(decodeSetOwnerResult({ kind: "stale", number: 3 })).toEqual({
      kind: "stale",
      number: 3,
    });
  });

  it("is a plugin of its own, listed in every registry", () => {
    expect(PEER_PLUGIN_IDS).toContain(PEER_TEST_REPORTS_PLUGIN.id);
    expect(PEER_TEST_REPORTS_PLUGIN.hubFeature).toEqual({ id: "test-reports", revision: 1 });
    expect(peerPluginStatusFields).toHaveProperty("testReports");
    expect(TestReportsRpcScopes).toEqual({
      [PEER_TEST_REPORTS_METHODS.peerTestsList]: AuthOrchestrationReadScope,
      [PEER_TEST_REPORTS_METHODS.peerTestsInherited]: AuthOrchestrationReadScope,
      [PEER_TEST_REPORTS_METHODS.peerTestsFile]: AuthOrchestrationOperateScope,
      [PEER_TEST_REPORTS_METHODS.peerTestsRemove]: AuthOrchestrationOperateScope,
      [PEER_TEST_REPORTS_METHODS.peerTestsSetOwner]: AuthOrchestrationOperateScope,
    });
    for (const method of Object.values(PEER_TEST_REPORTS_METHODS)) {
      expect(Object.values(PEER_WS_METHODS)).toContain(method);
      expect(PEER_RPC_SCOPES).toHaveProperty(method);
    }
  });
});
