import type { PeerHubStatus, PeerPluginState } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { canWatchThreads, selectPeerPlugins } from "./slots.logic";

const REGISTRY = ["herdr", "changes", "observe", "rooms"].map((id) => ({ id }));

const plugin = (id: string, active = true): PeerPluginState => ({
  id,
  title: id,
  enabled: active,
  active,
  ...(active ? {} : { reason: "off" as const }),
});

const status = (plugins?: ReadonlyArray<PeerPluginState>): PeerHubStatus => ({
  hubUrl: "https://hub.example.com",
  signedIn: true,
  email: "ana@acme.test",
  pendingSignIn: null,
  workspaces: [],
  joinable: [],
  workspaceRoot: "/home/ana/Peer",
  environmentId: "ana-laptop",
  agents: { herdr: "not-running", list: [] },
  coordination: {
    enabled: true,
    claudeHooks: false,
    logPath: "/home/ana/coordination.jsonl",
    sessions: [],
    overlaps: [],
  },
  sharedThreads: [],
  syncing: false,
  lastSyncAt: null,
  error: null,
  ...(plugins === undefined ? {} : { plugins }),
});

const ids = (selected: ReadonlyArray<{ readonly id: string }>) => selected.map((p) => p.id);

describe("selectPeerPlugins", () => {
  it("selects only the plugins that are active, in registry order", () => {
    const listed = status([
      plugin("rooms"),
      plugin("observe", false),
      plugin("changes"),
      plugin("herdr"),
    ]);
    expect(ids(selectPeerPlugins(REGISTRY, listed))).toEqual(["herdr", "changes", "rooms"]);
  });

  it("selects the features that existed before plugins when the status lists none", () => {
    const legacy = ["herdr", "observe"];
    expect(ids(selectPeerPlugins(REGISTRY, status()))).toEqual(legacy);
    expect(ids(selectPeerPlugins(REGISTRY, status([])))).toEqual(legacy);
  });

  it("ignores a plugin the registry does not know", () => {
    expect(
      ids(selectPeerPlugins(REGISTRY, status([plugin("telepathy"), plugin("changes")]))),
    ).toEqual(["changes"]);
  });

  it("selects nothing before the status has arrived", () => {
    expect(selectPeerPlugins(REGISTRY, null)).toEqual([]);
  });
});

it("lets threads be watched only while Observe is among the active plugins", () => {
  expect(canWatchThreads([{ id: "herdr" }, { id: "observe" }])).toBe(true);
  expect(canWatchThreads([{ id: "herdr" }, { id: "changes" }])).toBe(false);
  expect(canWatchThreads([])).toBe(false);
});

it("shows a plugin only when active and keeps older environments quiet", () => {
  const registry = [...REGISTRY, { id: "audit" }];
  expect(ids(selectPeerPlugins(registry, status([plugin("audit")])))).toEqual(["audit"]);
  expect(ids(selectPeerPlugins(registry, status([plugin("audit", false)])))).toEqual([]);
  expect(ids(selectPeerPlugins(registry, status()))).not.toContain("audit");
});
