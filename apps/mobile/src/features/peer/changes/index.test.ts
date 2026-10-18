import { PEER_PLUGIN_IDS, type PeerHubStatus, type PeerPluginState } from "@t3tools/contracts";
import * as NodeFS from "node:fs";
import { describe, expect, it, vi } from "vite-plus/test";

// The screens are React Native; the plugin's definition is plain data.
vi.mock("./PeerChangesSection", () => ({ PeerChangesSection: () => null }));
vi.mock("./PeerTaskChanges", () => ({ PeerTaskChanges: () => null }));

import { selectPeerPlugins, workspaceSectionsAt } from "../slots.logic";
import { changesMobilePlugin } from "./index";

const plugin = (state: Partial<PeerPluginState> = {}): PeerPluginState => ({
  id: "changes",
  title: "Changes",
  enabled: true,
  active: true,
  ...state,
});
const status = (plugins: ReadonlyArray<PeerPluginState>): Pick<PeerHubStatus, "plugins"> => ({
  plugins,
});

describe("the changes plugin on the phone", () => {
  it("fills a workspace section below the tasks and the task sections, and nothing else", () => {
    expect(PEER_PLUGIN_IDS).toContain(changesMobilePlugin.id);
    const selected = selectPeerPlugins([changesMobilePlugin], status([plugin()]));
    expect(workspaceSectionsAt(selected, "tasks")).toHaveLength(1);
    expect(selected[0]?.taskSections).toBeDefined();
    expect(changesMobilePlugin).not.toHaveProperty("settingsRows");
  });

  it("shows nothing on an older Hub or with the plugin off", () => {
    for (const state of [
      { active: false, reason: "hub" },
      { enabled: false, active: false },
    ]) {
      const selected = selectPeerPlugins([changesMobilePlugin], status([plugin(state)]));
      expect(workspaceSectionsAt(selected, "tasks")).toEqual([]);
    }
  });

  it("is listed in the registry where the server lists it", () => {
    const source = NodeFS.readFileSync(new URL("../slots.ts", import.meta.url), "utf8");
    const listed = [
      ...(/export const PEER_MOBILE_PLUGINS[^=]*=\s*\[([^\]]*)\]/.exec(source)?.[1] ?? "").matchAll(
        /(\w+)MobilePlugin/g,
      ),
    ].map((match) => match[1]);
    expect(listed.indexOf("changes")).toBe(listed.indexOf("agreements") + 1);
    expect(PEER_PLUGIN_IDS.indexOf("changes")).toBe(PEER_PLUGIN_IDS.indexOf("agreements") + 1);
  });
});
