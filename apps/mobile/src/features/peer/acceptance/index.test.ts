import { PEER_PLUGIN_IDS, type PeerHubStatus, type PeerPluginState } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

// The section and the badge are React Native views; the plugin's definition is plain data.
vi.mock("./AcceptanceSection", () => ({ AcceptanceSection: () => null }));
vi.mock("./AcceptedBadge", () => ({ AcceptedBadge: () => null }));

import { selectPeerPlugins } from "../slots.logic";
import { acceptanceMobilePlugin } from "./index";

const status = (state: Partial<PeerPluginState>): Pick<PeerHubStatus, "plugins"> => ({
  plugins: [{ id: "acceptance", title: "Acceptance", enabled: true, active: true, ...state }],
});

describe("the acceptance plugin on the phone", () => {
  it("fills the task's section and badge only: acceptance is read-only here", () => {
    expect(PEER_PLUGIN_IDS).toContain(acceptanceMobilePlugin.id);
    expect(acceptanceMobilePlugin.taskSections).toBeDefined();
    expect(acceptanceMobilePlugin.taskBadges).toBeDefined();
    expect(acceptanceMobilePlugin).not.toHaveProperty("settingsRows");
    expect(acceptanceMobilePlugin).not.toHaveProperty("workspaceSections");
  });

  it("shows while active and not when the Hub does not serve it", () => {
    expect(selectPeerPlugins([acceptanceMobilePlugin], status({}))).toHaveLength(1);
    expect(
      selectPeerPlugins([acceptanceMobilePlugin], status({ active: false, reason: "hub" })),
    ).toHaveLength(0);
  });
});
