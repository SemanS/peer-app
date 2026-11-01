import type { PeerHubStatus, PeerPluginState } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { PeerWebPlugin } from "./slots.types";
import {
  canWatchThreads,
  needsYouCount,
  needsYouEmptyText,
  selectPeerPlugins,
} from "./slots.logic";

const REGISTRY = ["herdr", "github", "changes", "observe", "rooms"].map((id) => ({ id }));

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
  github: { cli: false, account: null, signIn: null, error: null },
  coordination: {
    enabled: true,
    policy: "coordinate",
    claudeHooks: false,
    logPath: "/home/ana/coordination.jsonl",
    sessions: [],
    overlaps: [],
    findings: [],
    contexts: [],
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
    const legacy = ["herdr", "github", "observe"];
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

describe("Needs you", () => {
  const changes: PeerWebPlugin = { id: "changes", needsYou: { count: () => 2 } };
  const rooms: PeerWebPlugin = { id: "rooms", needsYou: { count: () => 1 } };
  const herdr: PeerWebPlugin = {
    id: "herdr",
    needsYou: {
      emptyText: (_status, { running }) =>
        running === 0 ? "Nothing needs you. Agents you run in herdr show up here too." : null,
    },
  };
  const observe: PeerWebPlugin = { id: "observe" };

  it("adds what the active plugins say waits on the person", () => {
    expect(needsYouCount([observe, changes, rooms], status())).toBe(3);
    expect(needsYouCount([observe], status())).toBe(0);
    expect(needsYouCount([], status())).toBe(0);
  });

  it("says nothing waits, in the words of the first plugin with more to say", () => {
    expect(needsYouEmptyText([observe, herdr], status(), 0)).toBe(
      "Nothing needs you. Agents you run in herdr show up here too.",
    );
    expect(needsYouEmptyText([observe, herdr], status(), 1)).toBe("Nothing needs you right now.");
    expect(needsYouEmptyText([observe], status(), 0)).toBe("Nothing needs you right now.");
    // Before the status arrives no plugin is known, so only the plain line is true.
    expect(needsYouEmptyText([], null, 0)).toBe("Nothing needs you right now.");
  });

  it("lets threads be watched only while Observe is among the active plugins", () => {
    expect(canWatchThreads([herdr, observe])).toBe(true);
    expect(canWatchThreads([herdr, changes])).toBe(false);
    expect(canWatchThreads([])).toBe(false);
  });
});

it("shows a plugin only when active and keeps older environments quiet", () => {
  const registry = [...REGISTRY, { id: "audit" }];
  expect(ids(selectPeerPlugins(registry, status([plugin("audit")])))).toEqual(["audit"]);
  expect(ids(selectPeerPlugins(registry, status([plugin("audit", false)])))).toEqual([]);
  expect(ids(selectPeerPlugins(registry, status()))).not.toContain("audit");
});
