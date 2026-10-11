import type { PeerPluginState } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { pluginRows, reasonText } from "./PeerPluginsSettings.logic";

const state = (id: string, extra: Partial<PeerPluginState> = {}): PeerPluginState => ({
  id,
  title: id,
  enabled: true,
  active: true,
  ...extra,
});

const OWNER = { owner: true, pending: null } as const;

describe("pluginRows", () => {
  it("locks an operator-disabled choice and explains the environment policy", () => {
    const [row] = pluginRows(
      [state("find", { enabled: false, active: false, reason: "FORCE_TEST=off", locked: true })],
      OWNER,
    );
    expect(row).toMatchObject({ on: false, locked: true, note: "Forced off by FORCE_TEST=off." });
  });
  it("gives owners a switch that shows their choice", () => {
    const rows = pluginRows(
      [state("requests"), state("observe", { enabled: false, active: false, reason: "off" })],
      OWNER,
    );
    expect(rows.map((row) => [row.id, row.control, row.on, row.state])).toEqual([
      ["requests", "switch", true, "on"],
      ["observe", "switch", false, "off"],
    ]);
  });

  it("gives everyone else no switch, only the state", () => {
    const rows = pluginRows([state("requests"), state("herdr", { enabled: false })], {
      owner: false,
      pending: null,
    });
    expect(rows.map((row) => [row.control, row.state])).toEqual([
      ["state", "on"],
      ["state", "off"],
    ]);
  });

  it("says the Hub must be updated for a plugin it does not serve", () => {
    const [row] = pluginRows([state("requests", { active: false, reason: "hub" })], OWNER);
    expect(row).toMatchObject({ on: true, state: "hub" });
    expect(row?.note).toContain("Hub must be updated");
    const [off] = pluginRows(
      [state("requests", { enabled: false, active: false, reason: "off" })],
      OWNER,
    );
    expect(off?.note).toBeNull();
  });

  it("shows a cleanup that failed, and keeps the choice", () => {
    const [row] = pluginRows(
      [
        state("capacity", {
          enabled: false,
          active: false,
          reason: "off",
          error: "The Hub did not revoke the key.",
        }),
      ],
      OWNER,
    );
    expect(row).toMatchObject({ on: false, error: "The Hub did not revoke the key." });
    expect(pluginRows([state("capacity")], OWNER)[0]?.error).toBeNull();
  });

  it("marks the plugin whose change is in flight", () => {
    const rows = pluginRows([state("requests"), state("observe")], {
      owner: true,
      pending: "observe",
    });
    expect(rows.map((row) => row.busy)).toEqual([false, true]);
  });

  it("leaves memory out while the build excludes it", () => {
    expect(pluginRows([state("memory"), state("requests")], OWNER).map((row) => row.id)).toEqual([
      "requests",
    ]);
  });
});

describe("reasonText", () => {
  const hub = { hub: { features: { requests: 1 }, featuresOff: ["slack"] } };

  it("says a plugin the Hub does not serve needs a newer Hub, as an older Hub's silence allows", () => {
    expect(reasonText("hub", {}, "slack")).toBe("needs a newer Peer Hub.");
    expect(reasonText("hub", { hub: { features: { requests: 1 } } }, "slack")).toBe(
      "needs a newer Peer Hub.",
    );
  });

  it("says the Hub turned the feature off where the Hub lists it, and a newer one is still needed otherwise", () => {
    expect(reasonText("hub", hub, "slack")).toBe("is turned off on this Peer Hub.");
    expect(reasonText("hub", hub, "handoff")).toBe("needs a newer Peer Hub.");
  });

  it("leaves every other reason as it was, whatever the Hub says", () => {
    expect(reasonText("off", hub, "slack")).toBe("is turned off on this environment.");
    expect(reasonText("locked", hub, "slack")).toBe("is forced off by the environment operator.");
    expect(reasonText("missing", hub, "slack")).toBe("is not available on this environment.");
  });
});
