import { PEER_PLUGIN_IDS, type PeerHubStatus, type PeerPluginState } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

// The row and the badge are React Native views; the plugin's definition is plain data.
vi.mock("./RoomTaskRow", () => ({ RoomTaskRow: () => null, RoomTaskBadge: () => null }));

import { selectPeerPlugins } from "../slots.logic";
import { roomsMobilePlugin } from "./index";

const status = (state: Partial<PeerPluginState>): Pick<PeerHubStatus, "plugins"> => ({
  plugins: [{ id: "rooms", title: "Task rooms", enabled: true, active: true, ...state }],
});

describe("the rooms plugin on the phone", () => {
  it("is a known plugin with a task row and a count", () => {
    expect(PEER_PLUGIN_IDS).toContain(roomsMobilePlugin.id);
    expect(roomsMobilePlugin.taskSections).toBeDefined();
    expect(roomsMobilePlugin.taskBadges).toBeDefined();
  });

  it("shows while active, and not while off or when the Hub does not serve it", () => {
    expect(selectPeerPlugins([roomsMobilePlugin], status({}))).toHaveLength(1);
    expect(
      selectPeerPlugins([roomsMobilePlugin], status({ enabled: false, active: false })),
    ).toHaveLength(0);
    expect(
      selectPeerPlugins([roomsMobilePlugin], status({ active: false, reason: "hub" })),
    ).toHaveLength(0);
  });
});
