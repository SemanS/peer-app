import { PEER_PLUGIN_IDS, type PeerHubStatus, type PeerPluginState } from "@t3tools/contracts";
import * as NodeFS from "node:fs";
import { describe, expect, it, vi } from "vite-plus/test";

// The Team section is a React Native screen; the plugin's definition is plain data.
vi.mock("./TeamSection", () => ({ TeamSection: () => null }));

import { alwaysWorkspaceSectionsAt, selectPeerPlugins, workspaceSectionsAt } from "../slots.logic";
import { ownershipMobilePlugin } from "./index";

const plugin = (state: Partial<PeerPluginState> = {}): PeerPluginState => ({
  id: "ownership",
  title: "Ownership",
  enabled: true,
  active: true,
  ...state,
});

const status = (plugins?: ReadonlyArray<PeerPluginState>): Pick<PeerHubStatus, "plugins"> =>
  plugins === undefined ? {} : { plugins };

const registry = [ownershipMobilePlugin];
const sectionsOf = (listed: Pick<PeerHubStatus, "plugins"> | null) =>
  workspaceSectionsAt(selectPeerPlugins(registry, listed), "tasks").map((section) => section.key);

describe("the ownership plugin on the phone", () => {
  it("is one of Peer's plugins, with the Team section below the tasks and nothing else in a slot", () => {
    expect(PEER_PLUGIN_IDS).toContain(ownershipMobilePlugin.id);
    expect(ownershipMobilePlugin.workspaceSections?.map((section) => section.place)).toEqual([
      "tasks",
    ]);
    // An owner's call is a Needs you item, and the owners are read-only here: no task page, no
    // Settings row, no section that explains an inactive plugin.
    expect(ownershipMobilePlugin).not.toHaveProperty("taskBadges");
    expect(ownershipMobilePlugin).not.toHaveProperty("taskSections");
    expect(ownershipMobilePlugin).not.toHaveProperty("settingsRows");
    expect(ownershipMobilePlugin).not.toHaveProperty("alwaysWorkspaceSections");
  });

  it("shows the Team section while the plugin is active", () => {
    expect(sectionsOf(status([plugin()]))).toEqual(["ownership:0"]);
  });

  it("shows nothing of it while the plugin is off, locked off, or the Hub does not serve it", () => {
    for (const state of [
      { enabled: false, active: false, reason: "off" },
      { active: false, reason: "hub" },
      { active: false, reason: "hub-unknown" },
      { enabled: false, active: false, locked: true, reason: "PEER_OWNERSHIP=off" },
    ]) {
      const listed = status([plugin(state)]);
      expect(sectionsOf(listed), JSON.stringify(state)).toEqual([]);
      // Not even a line that says why: the phone drops the section, as it does for an older Hub.
      expect(alwaysWorkspaceSectionsAt(registry, listed, "tasks")).toEqual([]);
      expect(alwaysWorkspaceSectionsAt(registry, listed, "end")).toEqual([]);
    }
  });

  it("shows nothing of it on a computer that does not know the plugin, or before its status arrived", () => {
    // A status without a plugin list counts only the features that existed before plugins.
    expect(sectionsOf(status())).toEqual([]);
    expect(sectionsOf(status([]))).toEqual([]);
    expect(sectionsOf(status([{ ...plugin(), id: "impact" }]))).toEqual([]);
    expect(sectionsOf(null)).toEqual([]);
  });
});

describe("the registry", () => {
  it("lists the plugin where the server lists it, after Impact and before Settings", () => {
    // The registry file imports every plugin's screens, which only React Native can load, so its
    // order is read from the source: a plugin missing from it, or out of place, fails here.
    const source = NodeFS.readFileSync(new URL("../slots.ts", import.meta.url), "utf8");
    const listed = [
      ...(/export const PEER_MOBILE_PLUGINS[^=]*=\s*\[([^\]]*)\]/.exec(source)?.[1] ?? "").matchAll(
        /(\w+)MobilePlugin/g,
      ),
    ].map((match) => match[1]);
    expect(listed.indexOf("impact")).toBeGreaterThanOrEqual(0);
    expect(listed.indexOf("ownership")).toBe(listed.indexOf("impact") + 1);
    expect(PEER_PLUGIN_IDS.indexOf("ownership")).toBe(PEER_PLUGIN_IDS.indexOf("impact") + 1);
    expect(PEER_PLUGIN_IDS.indexOf("ownership")).toBeLessThan(PEER_PLUGIN_IDS.indexOf("settings"));
  });
});
