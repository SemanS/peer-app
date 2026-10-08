import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { PeerHubStatus } from "../peerHub.ts";
import { PeerPluginId } from "./plugin.ts";

const decodeStatus = Schema.decodeUnknownSync(PeerHubStatus);
const isPluginId = Schema.is(PeerPluginId);

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
});
