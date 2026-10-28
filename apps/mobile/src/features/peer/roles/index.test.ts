import { PEER_PLUGIN_IDS, type PeerHubStatus, type PeerPluginState } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

// The section is a React Native screen; the plugin's definition is plain data.
vi.mock("./RoleMark", () => ({ TaskRoles: () => null, RoleMark: () => null }));

import { selectPeerPlugins } from "../slots.logic";
import { rolesMobilePlugin } from "./index";

const status = (state: Partial<PeerPluginState>): Pick<PeerHubStatus, "plugins"> => ({
  plugins: [{ id: "roles", title: "Review sessions", enabled: true, active: true, ...state }],
});

describe("the roles plugin on the phone", () => {
  it("fills the task's section only: roles change on a computer", () => {
    expect(PEER_PLUGIN_IDS).toContain(rolesMobilePlugin.id);
    expect(rolesMobilePlugin.taskSections).toBeDefined();
    expect(rolesMobilePlugin).not.toHaveProperty("settingsRows");
    expect(rolesMobilePlugin).not.toHaveProperty("workspaceSections");
    expect(rolesMobilePlugin).not.toHaveProperty("taskLauncher");
  });

  it("shows while active and not when the Hub lacks the feature", () => {
    expect(selectPeerPlugins([rolesMobilePlugin], status({}))).toHaveLength(1);
    expect(
      selectPeerPlugins([rolesMobilePlugin], status({ active: false, reason: "hub" })),
    ).toHaveLength(0);
  });
});
