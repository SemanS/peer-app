import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  AuthAccessWriteScope,
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
} from "../auth.ts";
import {
  ChangeReport,
  ChangeRow,
  HubChanges,
  PeerChangesStatus,
  ProjectChanges,
  ReviewDiff,
} from "./changes.ts";
import { PEER_CHANGES_METHODS } from "./changes.rpc.ts";
import { JujutsuState, UndoPreview } from "./jujutsu.ts";
import { PEER_JUJUTSU_METHODS } from "./jujutsu.rpc.ts";
import { PEER_PLUGIN_IDS } from "./plugin.ts";
import { peerPluginStatusFields } from "./registry.ts";
import {
  PEER_RPC_SCOPES,
  PEER_STREAM_METHODS,
  PEER_WS_METHODS,
  PeerRpcGroup,
} from "./rpcRegistry.ts";

const decodeStatusFields = Schema.decodeUnknownSync(Schema.Struct(peerPluginStatusFields)),
  decodeJujutsuState = Schema.decodeUnknownSync(JujutsuState),
  decodeChangesStatus = Schema.decodeUnknownSync(PeerChangesStatus),
  decodeReport = Schema.decodeUnknownSync(ChangeReport),
  decodeHubChanges = Schema.decodeUnknownSync(HubChanges),
  decodeRow = Schema.decodeUnknownSync(ChangeRow),
  decodeProject = Schema.decodeUnknownSync(ProjectChanges),
  decodeDiff = Schema.decodeUnknownSync(ReviewDiff),
  decodePreview = Schema.decodeUnknownSync(UndoPreview);

const change = (id: string, over: Record<string, unknown> = {}) => ({
  changeId: id.padEnd(32, "k"),
  commitId: "3348b1d6".padEnd(40, "0"),
  parents: [],
  subject: "ORD-11: orderTotal returns integer cents",
  paths: ["order.js"],
  bookmarks: ["feature/ORD-11-cents"],
  conflict: false,
  empty: false,
  divergent: false,
  working: true,
  kind: "edit",
  ...over,
});

describe("jujutsu and changes registration", () => {
  it("places the plugin ids after herdr and agreements, with settings last", () => {
    const ids: ReadonlyArray<string> = PEER_PLUGIN_IDS;
    expect(ids.indexOf("jujutsu")).toBe(ids.indexOf("herdr") + 1);
    expect(ids.indexOf("changes")).toBe(ids.indexOf("agreements") + 1);
    expect(ids.at(-1)).toBe("settings");
  });

  it("registers every method with the scope of design D13", () => {
    const j = PEER_JUJUTSU_METHODS;
    expect(PEER_RPC_SCOPES[j.peerJujutsuOperations]).toBe(AuthOrchestrationReadScope);
    expect(PEER_RPC_SCOPES[j.peerJujutsuPreviewUndo]).toBe(AuthOrchestrationReadScope);
    expect(PEER_RPC_SCOPES[j.peerJujutsuAtOp]).toBe(AuthOrchestrationReadScope);
    expect(PEER_RPC_SCOPES[j.peerJujutsuUndo]).toBe(AuthOrchestrationOperateScope);
    expect(PEER_RPC_SCOPES[j.peerJujutsuFollow]).toBe(AuthOrchestrationOperateScope);
    expect(PEER_RPC_SCOPES[j.peerJujutsuIntegrate]).toBe(AuthOrchestrationOperateScope);
    expect(PEER_RPC_SCOPES[j.peerJujutsuConfigure]).toBe(AuthAccessWriteScope);
    const c = PEER_CHANGES_METHODS;
    expect(PEER_RPC_SCOPES[c.peerChangesSubscribe]).toBe(AuthOrchestrationReadScope);
    expect(PEER_RPC_SCOPES[c.peerChangesMarkReviewed]).toBe(AuthOrchestrationOperateScope);
    expect(PEER_RPC_SCOPES[c.peerChangesReviewDiff]).toBe(AuthOrchestrationReadScope);
    for (const tag of [...Object.values(j), ...Object.values(c)]) {
      expect(PeerRpcGroup.requests.has(tag)).toBe(true);
      expect(Object.values(PEER_WS_METHODS)).toContain(tag);
    }
    expect(PEER_STREAM_METHODS).toContain(c.peerChangesSubscribe);
    expect(PEER_JUJUTSU_METHODS.peerJujutsuUndo).toBe("peer.jujutsu.undo");
  });

  it("adds two optional status fields that decode when absent", () => {
    expect(Object.keys(peerPluginStatusFields)).toEqual(
      expect.arrayContaining(["jujutsu", "changes"]),
    );
    expect(decodeStatusFields({})).toEqual({});
    const state = {
      connection: "connected" as const,
      version: "0.46.0",
      agentWorkspaces: 2,
      protection: true,
    };
    expect(decodeJujutsuState(state)).toEqual(state);
    const changes = {
      hubSupport: "supported" as const,
      projects: [{ workspace: "acme", project: "ordering", inFlight: 4, needAttention: 1 }],
    };
    expect(decodeChangesStatus(changes)).toEqual(changes);
  });
});

describe("changes wire", () => {
  it("accepts a report within the Hub's limits and refuses one beyond them", () => {
    const decode = decodeReport;
    const report = {
      session: "s1",
      seq: 7,
      environment: "bob-mac",
      agent: "codex",
      task: null,
      changes: [change("mspqrmyv")],
    };
    expect(decode(report).changes).toHaveLength(1);
    expect(() => decode({ ...report, changes: Array(21).fill(change("m")) })).toThrow();
    expect(() =>
      decode({ ...report, changes: [change("m", { subject: "x".repeat(121) })] }),
    ).toThrow();
    expect(() => decode({ ...report, changes: [change("m", { changeId: "ABC" })] })).toThrow();
    expect(() => decode({ ...report, changes: [change("m", { kind: "other" })] })).toThrow();
  });

  it("reads the Hub's rows, and keeps an unknown version kind", () => {
    const row = {
      project: "ordering",
      ...change("lrorvllt"),
      author: { email: "ana@acme.test", agent: "claude-code" },
      versions: [{ commit: "a".repeat(40), at: "2026-10-18T14:57:00Z", kind: "squash" }],
      sessions: [
        {
          email: "bob@acme.test",
          agent: "codex",
          environment: "bob-mac",
          task: null,
          working: true,
        },
      ],
      lastReportAt: "2026-10-18T14:58:00Z",
      extraFromANewerHub: 1,
    };
    const decoded = decodeHubChanges({ changes: [row] }).changes[0];
    expect(decoded?.versions[0]?.kind).toBe("squash");
    expect(decoded?.source).toBeUndefined();
    expect(decodeRow(row)).not.toHaveProperty("extraFromANewerHub");
    const view = { workspace: "acme", project: "ordering", changes: [], marks: [], problems: [] };
    expect(decodeProject(view)).toEqual(view);
  });

  it("says which states a review diff and an undo preview can be in", () => {
    const diff = decodeDiff;
    expect(diff({ state: "notHere", mode: "since", files: [] }).files).toEqual([]);
    expect(
      diff({
        state: "partial",
        mode: "since",
        toVersion: 6,
        files: [
          { path: "order.js", added: 1, removed: 0, lines: [{ kind: "add", text: "+x", n: 5 }] },
        ],
      }).toVersion,
    ).toBe(6);
    const op = {
      id: "7a867867a1ed",
      time: "2026-10-18T14:55:00Z",
      user: "bob·codex",
      description: "restore into commit ac8515ad",
      args: "jj restore",
      changed: ["mspqrmyv"],
    };
    const preview = {
      operation: op,
      later: [{ ...op, id: "b", user: "peer·follow" }],
      shared: ["mspqrmyv"],
      commands: ["jj op revert 7a867867a1ed", "jj converge --no-interactive -r mspqrmyv"],
    };
    expect(decodePreview(preview)).toEqual(preview);
  });
});
