import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { AuthAccessWriteScope } from "../auth.ts";
import { CLIENT_GUARDED_RPC_SCOPES } from "../clientRpcPermissions.ts";
import { PEER_PLUGIN_IDS } from "./plugin.ts";
import { PEER_RPC_SCOPES, PEER_WS_METHODS } from "./rpcRegistry.ts";
import {
  PEER_USAGE_REPORT_LIMITS,
  PeerUsageOverview,
  PeerUsageOverviewAnswer,
  PeerUsageOverviewInput,
  PeerUsageReportBody,
  PeerUsageSharing,
  PeerUsageSharingAnswer,
} from "./usage.ts";
import { PEER_USAGE_METHODS } from "./usage.rpc.ts";

const decodeOverview = Schema.decodeUnknownSync(PeerUsageOverview);
const decodeAnswer = Schema.decodeUnknownSync(PeerUsageOverviewAnswer);
const decodeSharing = Schema.decodeUnknownSync(PeerUsageSharing);
const decodeSharingAnswer = Schema.decodeUnknownSync(PeerUsageSharingAnswer);
const decodeInput = Schema.decodeUnknownSync(PeerUsageOverviewInput);
const decodeReport = Schema.decodeUnknownSync(PeerUsageReportBody);

/** The example of design D3, as the Hub answers it. */
const example = {
  workspace: "vocabulift",
  days: 30,
  from: "2026-10-01",
  to: "2026-10-30",
  project: null,
  scope: "workspace",
  tickets: { total: 12, open: 9, completed: 3 },
  implementations: { runs: 40, agents: 2, seconds: 123456 },
  apiSpend: {
    usd: 12.5,
    gateway: { state: "ok", spentUsd: 30.0, budgetUsd: 100.0, period: "month" },
  },
  tokenValue: { usd: 250.0, onPlansUsd: 230.0, partial: false },
  code: { additions: 5000, deletions: 120, partial: false, pullRequestsMerged: 4 },
  tokens: { input: 9000, output: 100, cached: 4000 },
  byAgent: [{ agent: "claude", runs: 30, usd: 180.0, tokens: 12000 }],
  byUser: [
    {
      email: "a@x.sk",
      name: "Ana",
      runs: 12,
      usd: 73.81,
      tokens: 9000,
      sharing: true,
      former: false,
    },
  ],
  coverage: { members: 3, sharing: 2, latestReportAt: "2026-10-30T12:00:00Z" },
};

const row = {
  agent: "claude",
  model: "claude-opus-5-5",
  capacity: "personal",
  input: 1,
  output: 2,
  cached: 3,
  usd: 0.5,
  sessions: 2,
};
const rowsOf = (length: number) => Array.from({ length }, () => row);
const report = { environment: "env-id", rev: 1793000000000, rows: [row] };

describe("the usage overview", () => {
  it("decodes the design's example unchanged", () => {
    expect(decodeOverview(example)).toEqual(example);
  });

  it("decodes every nullable field as null and keeps it apart from zero", () => {
    const empty = decodeOverview({
      ...example,
      project: null,
      tickets: null,
      apiSpend: { usd: null, gateway: null },
      tokenValue: null,
      code: { additions: null, deletions: null, partial: true, pullRequestsMerged: 2 },
      tokens: null,
      byAgent: [{ agent: "codex", runs: 1, usd: null, tokens: null }],
      byUser: [{ ...example.byUser[0], usd: null, tokens: null, sharing: false }],
      coverage: { members: 3, sharing: 0, latestReportAt: null },
    });
    expect(empty.tickets).toBeNull();
    expect(empty.apiSpend).toEqual({ usd: null, gateway: null });
    expect(empty.tokenValue).toBeNull();
    expect(empty.code?.additions).toBeNull();
    expect(empty.code?.deletions).toBeNull();
    expect(empty.tokens).toBeNull();
    expect(empty.byAgent[0]?.usd).toBeNull();
    expect(empty.byAgent[0]?.tokens).toBeNull();
    expect(empty.byUser[0]?.usd).toBeNull();
    expect(empty.byUser[0]?.tokens).toBeNull();
    expect(empty.coverage.latestReportAt).toBeNull();
    expect(decodeOverview({ ...example, code: null }).code).toBeNull();

    const zero = decodeOverview({
      ...example,
      apiSpend: { usd: 0, gateway: null },
      byAgent: [{ agent: "codex", runs: 0, usd: 0, tokens: 0 }],
    });
    expect(zero.apiSpend.usd).toBe(0);
    expect(zero.byAgent[0]?.usd).toBe(0);
    expect(zero.byAgent[0]?.tokens).toBe(0);
  });

  it("refuses an absent field rather than reading it as not measured", () => {
    const { tokenValue: _tokenValue, ...missing } = example;
    expect(() => decodeOverview(missing)).toThrow();
    expect(() =>
      decodeOverview({ ...example, apiSpend: { usd: 1, gateway: undefined } }),
    ).toThrow();
  });

  it("keeps a gateway figure's own period, and has none while it cannot be read", () => {
    const unreachable = decodeOverview({
      ...example,
      apiSpend: { usd: null, gateway: { state: "unreachable" } },
    });
    expect(unreachable.apiSpend.gateway).toEqual({ state: "unreachable" });
    expect(decodeOverview(example).apiSpend.gateway?.period).toBe("month");
  });

  it("decodes a member's scope, in which every total is their own", () => {
    const self = decodeOverview({
      ...example,
      scope: "self",
      tickets: null,
      code: null,
      apiSpend: { usd: null, gateway: null },
      coverage: { members: 1, sharing: 0, latestReportAt: null },
    });
    expect(self.scope).toBe("self");
    expect(self.coverage.members).toBe(1);
  });

  it("tells an older Hub from an overview", () => {
    expect(decodeAnswer({ unsupported: true })).toEqual({ unsupported: true });
    expect(decodeAnswer(example)).toEqual(example);
  });

  it("offers only the windows the Hub accepts", () => {
    expect(decodeInput({ workspace: "acme", days: 7 })).toEqual({ workspace: "acme", days: 7 });
    expect(decodeInput({ workspace: "acme", days: 1, project: "pay" }).project).toBe("pay");
    expect(() => decodeInput({ workspace: "acme", days: 28 })).toThrow();
    expect(() => decodeOverview({ ...example, days: 28 })).toThrow();
  });
});

describe("the sharing state", () => {
  it("decodes a read, turning on, and turning off with what it erased", () => {
    expect(decodeSharing({ sharing: false, at: null })).toEqual({ sharing: false, at: null });
    expect(decodeSharing({ sharing: true, at: "2026-10-30T12:00:00Z" }).at).toBe(
      "2026-10-30T12:00:00Z",
    );
    expect(decodeSharing({ sharing: false, at: null, removed: 0 }).removed).toBe(0);
    expect(decodeSharingAnswer({ unsupported: true })).toEqual({ unsupported: true });
  });
});

describe("a report", () => {
  it("decodes the design's example, a row without a price, and empty rows", () => {
    expect(decodeReport(report)).toEqual(report);
    expect(decodeReport({ ...report, rows: [{ ...row, usd: null }] }).rows[0]?.usd).toBeNull();
    expect(decodeReport({ ...report, rows: [{ ...row, usd: 0 }] }).rows[0]?.usd).toBe(0);
    expect(decodeReport({ ...report, rows: [] }).rows).toEqual([]);
  });

  it("holds to the Hub's limits", () => {
    const refused = (changed: Partial<typeof row>) =>
      expect(() => decodeReport({ ...report, rows: [{ ...row, ...changed }] })).toThrow();
    refused({ capacity: "team" });
    refused({ input: PEER_USAGE_REPORT_LIMITS.count + 1 });
    refused({ output: -1 });
    refused({ cached: 1.5 });
    refused({ usd: PEER_USAGE_REPORT_LIMITS.usd + 1 });
    refused({ usd: Number.POSITIVE_INFINITY });
    refused({ usd: -0.01 });
    refused({ agent: "Claude Code" });
    refused({ model: "" });
    refused({ model: "x".repeat(PEER_USAGE_REPORT_LIMITS.modelChars + 1) });
    refused({ model: "claude\nopus" });
    expect(() => decodeReport({ ...report, environment: "/Users/ana" })).toThrow();
    expect(() =>
      decodeReport({ ...report, rows: rowsOf(PEER_USAGE_REPORT_LIMITS.rows + 1) }),
    ).toThrow();
    expect(
      decodeReport({ ...report, rows: rowsOf(PEER_USAGE_REPORT_LIMITS.rows) }).rows,
    ).toHaveLength(PEER_USAGE_REPORT_LIMITS.rows);
  });
});

describe("the usage plugin's registration", () => {
  it("lists the plugin, its methods and their scopes", () => {
    expect(PEER_PLUGIN_IDS).toContain("usage");
    expect(PEER_WS_METHODS).toMatchObject(PEER_USAGE_METHODS);
    expect(PEER_RPC_SCOPES).toMatchObject({
      "peer.usage.overview": "orchestration:read",
      "peer.usage.sharing": "orchestration:read",
      "peer.usage.setSharing": AuthAccessWriteScope,
    });
  });

  it("guards the switch on the client, not the reads", () => {
    expect(CLIENT_GUARDED_RPC_SCOPES).toHaveProperty(
      PEER_USAGE_METHODS.peerUsageSetSharing,
      AuthAccessWriteScope,
    );
    expect(CLIENT_GUARDED_RPC_SCOPES).not.toHaveProperty(PEER_USAGE_METHODS.peerUsageOverview);
    expect(CLIENT_GUARDED_RPC_SCOPES).not.toHaveProperty(PEER_USAGE_METHODS.peerUsageSharing);
  });
});
