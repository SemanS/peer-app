import { PEER_PLUGIN_IDS, type PeerHubStatus, type PeerPluginState } from "@t3tools/contracts";
import * as NodeFS from "node:fs";
import { describe, expect, it, vi } from "vite-plus/test";

// The task section is a React Native screen; the plugin's definition is plain data.
vi.mock("./PeerTaskAgreements", () => ({ PeerTaskAgreements: () => null }));

import { selectPeerPlugins } from "../slots.logic";
import { agreementSignals } from "./agreements.logic";
import { agreementsMobilePlugin } from "./index";

const plugin = (state: Partial<PeerPluginState> = {}): PeerPluginState => ({
  id: "agreements",
  title: "Agreements",
  enabled: true,
  active: true,
  ...state,
});

const status = (plugins?: ReadonlyArray<PeerPluginState>): Pick<PeerHubStatus, "plugins"> =>
  plugins === undefined ? {} : { plugins };

const shown = (listed: Pick<PeerHubStatus, "plugins"> | null) =>
  selectPeerPlugins([agreementsMobilePlugin], listed).map((selected) => selected.id);

describe("the agreements plugin on the phone", () => {
  it("fills the project signal and the task section, and nothing that edits core's Needs you", () => {
    expect(PEER_PLUGIN_IDS).toContain(agreementsMobilePlugin.id);
    expect(agreementsMobilePlugin.projectSignals).toBe(agreementSignals);
    expect(agreementsMobilePlugin.taskSections).toBeDefined();
    // Mobile's Needs you is built in core client code, so a due agreement is a signal and a line on
    // the task; no badge, row or section of its own explains the plugin when it is off.
    for (const slot of [
      "taskBadges",
      "settingsRows",
      "workspaceSections",
      "alwaysWorkspaceSections",
      "taskLauncher",
      "background",
    ]) {
      expect(agreementsMobilePlugin, slot).not.toHaveProperty(slot);
    }
  });

  it("is shown while the plugin is active", () => {
    expect(shown(status([plugin()]))).toEqual(["agreements"]);
  });

  it("shows nothing of it while the plugin is off, locked off, or the Hub does not serve it", () => {
    for (const state of [
      { enabled: false, active: false, reason: "off" },
      { active: false, reason: "hub" },
      { active: false, reason: "hub-unknown" },
      { enabled: false, active: false, locked: true, reason: "PEER_AGREEMENTS=off" },
    ]) {
      expect(shown(status([plugin(state)])), JSON.stringify(state)).toEqual([]);
    }
  });

  it("shows nothing of it on a computer that does not know the plugin, or before its status arrived", () => {
    // A status without a plugin list counts only the features that existed before plugins.
    expect(shown(status())).toEqual([]);
    expect(shown(status([]))).toEqual([]);
    expect(shown(status([{ ...plugin(), id: "plans" }]))).toEqual([]);
    expect(shown(null)).toEqual([]);
  });
});

describe("the registry", () => {
  it("lists the plugin where the server lists it, right after Plans", () => {
    // The registry file imports every plugin's screens, which only React Native can load, so its
    // order is read from the source: a plugin missing from it, or out of place, fails here.
    const source = NodeFS.readFileSync(new URL("../slots.ts", import.meta.url), "utf8");
    const listed = [
      ...(/export const PEER_MOBILE_PLUGINS[^=]*=\s*\[([^\]]*)\]/.exec(source)?.[1] ?? "").matchAll(
        /(\w+)MobilePlugin/g,
      ),
    ].map((match) => match[1]);
    expect(listed.indexOf("plans")).toBeGreaterThanOrEqual(0);
    expect(listed.indexOf("agreements")).toBe(listed.indexOf("plans") + 1);
    expect(PEER_PLUGIN_IDS.indexOf("agreements")).toBe(PEER_PLUGIN_IDS.indexOf("plans") + 1);
    expect(PEER_PLUGIN_IDS.indexOf("agreements")).toBeLessThan(PEER_PLUGIN_IDS.indexOf("settings"));
  });
});
