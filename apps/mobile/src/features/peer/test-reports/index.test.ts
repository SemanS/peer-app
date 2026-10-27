import { PEER_PLUGIN_IDS, type PeerHubStatus, type PeerPluginState } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

// The section is a React Native screen; the plugin's definition is plain data.
vi.mock("./ReportSection", () => ({ ReportSection: () => null }));

import { selectPeerPlugins } from "../slots.logic";
import { testReportsMobilePlugin } from "./index";

const status = (state: Partial<PeerPluginState>): Pick<PeerHubStatus, "plugins"> => ({
  plugins: [{ id: "test-reports", title: "Test reports", enabled: true, active: true, ...state }],
});

describe("the test-reports plugin on the phone", () => {
  it("fills the task's section only: reports are read-only here", () => {
    expect(PEER_PLUGIN_IDS).toContain(testReportsMobilePlugin.id);
    expect(testReportsMobilePlugin.taskSections).toBeDefined();
    expect(testReportsMobilePlugin).not.toHaveProperty("settingsRows");
    expect(testReportsMobilePlugin).not.toHaveProperty("workspaceSections");
    expect(testReportsMobilePlugin).not.toHaveProperty("taskBadges");
  });

  it("shows while active and not when the plugin is off", () => {
    expect(selectPeerPlugins([testReportsMobilePlugin], status({}))).toHaveLength(1);
    expect(
      selectPeerPlugins([testReportsMobilePlugin], status({ active: false, enabled: false })),
    ).toHaveLength(0);
  });
});
