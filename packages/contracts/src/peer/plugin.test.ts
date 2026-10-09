import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { PeerHubStatus } from "../peerHub.ts";
import { PeerPluginId } from "./plugin.ts";

const decodeStatus = Schema.decodeUnknownSync(PeerHubStatus);
const isPluginId = Schema.is(PeerPluginId);

it("reads an operator lock while retaining compatibility with older plugin states", () => {
  const status = decodeStatus({
    ...statusBeforePlugins,
    plugins: [
      {
        id: "find",
        title: "Find",
        enabled: false,
        active: false,
        locked: true,
        reason: "FORCE_TEST=off",
      },
      { id: "ask", title: "Ask", enabled: true, active: true },
    ],
  });
  expect(status.plugins?.[0]?.locked).toBe(true);
  expect(status.plugins?.[1]?.locked).toBeUndefined();
});

/** A signed-out environment's status as a Peer from before plugins sends it. */
const statusBeforePlugins = {
  hubUrl: "https://hub.example.com",
  signedIn: false,
  email: null,
  pendingSignIn: null,
  workspaces: [],
  joinable: [],
  workspaceRoot: "/home/ana/Peer",
  environmentId: "ana-laptop",
  agents: { herdr: "not-running", list: [] },
  github: { cli: false, account: null, signIn: null, error: null },
  coordination: {
    enabled: false,
    policy: "coordinate",
    claudeHooks: false,
    logPath: "/home/ana/.t3/userdata/logs/coordination.jsonl",
    sessions: [],
    overlaps: [],
    findings: [],
    contexts: [],
    candidates: [],
  },
  sharedThreads: [],
  syncing: false,
  lastSyncAt: null,
  error: null,
};

describe("plugins in the Peer status", () => {
  it("reads the status of an environment from before plugins", () => {
    expect(decodeStatus(statusBeforePlugins).plugins).toBeUndefined();
  });

  it("reads plugins this client does not know", () => {
    const status = decodeStatus({
      ...statusBeforePlugins,
      plugins: [
        { id: "requests", title: "Team requests", enabled: true, active: false, reason: "hub" },
        {
          id: "telepathy",
          title: "Telepathy",
          enabled: false,
          active: false,
          reason: "off",
          error: "The Hub did not revoke the key.",
        },
      ],
    });
    expect(status.plugins?.map((plugin) => [plugin.id, plugin.active, plugin.reason])).toEqual([
      ["requests", false, "hub"],
      ["telepathy", false, "off"],
    ]);
    expect(isPluginId("telepathy")).toBe(false);
  });

  it("reads a reason a newer environment gives for an inactive plugin", () => {
    const status = decodeStatus({
      ...statusBeforePlugins,
      plugins: [{ id: "find", title: "Find", enabled: true, active: false, reason: "paused" }],
    });
    expect(status.plugins?.[0]?.reason).toBe("paused");
  });
});
