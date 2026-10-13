import { NOW, PAY } from "@t3tools/client-runtime/testing/peer-plans";
import type { PeerPlansStatus, PeerPluginState } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { PLANS_SUMMARY, plansSettingsState } from "./plans.logic";

describe("the state line in Settings", () => {
  const on: PeerPluginState = { id: "plans", title: "Plans", enabled: true, active: true };
  const base: PeerPlansStatus = {
    enabled: true,
    forcedOff: false,
    hubSupport: "supported",
    lastContact: "2026-10-12T20:11:00Z",
    revision: 1,
    counts: [],
  };

  it("says what Plans holds and when the Hub last answered", () => {
    expect(plansSettingsState(on, base, NOW)).toBe(
      "No live plans on tasks. The Hub serves plans; last contact 2 min ago.",
    );
    const busy: PeerPlansStatus = {
      ...base,
      counts: [
        { ...PAY, task: "ord-9", plans: 2, relations: 3 },
        { ...PAY, task: "ord-11", plans: 1, relations: 1 },
        { ...PAY, task: "ord-15", plans: 0, relations: 1 },
      ],
    };
    expect(plansSettingsState(on, busy, NOW)).toBe(
      "3 live plans on 2 tasks. The Hub serves plans; last contact 2 min ago.",
    );
    const one: PeerPlansStatus = {
      ...base,
      counts: [{ ...PAY, task: "ord-9", plans: 1, relations: 0 }],
    };
    expect(plansSettingsState(on, { ...one, lastContact: undefined }, NOW)).toBe(
      "1 live plan on 1 task. The Hub serves plans.",
    );
  });

  it("says what the Hub says when it has not served plans or has not been asked", () => {
    expect(plansSettingsState(on, { ...base, hubSupport: "unsupported" }, NOW)).toBe(
      "No live plans on tasks. The Hub did not serve plans when Peer last asked.",
    );
    expect(plansSettingsState(on, { ...base, hubSupport: "unknown" }, NOW)).toBe(
      "No live plans on tasks. The Hub has not been asked yet.",
    );
  });

  it("says what inactive means, whatever made it inactive, and leaves the why to the plugin list", () => {
    const inactive: ReadonlyArray<PeerPluginState> = [
      { id: "plans", title: "Plans", enabled: false, active: false, reason: "off" },
      {
        id: "plans",
        title: "Plans",
        enabled: false,
        active: false,
        reason: "PEER_PLANS=off",
        locked: true,
      },
      { id: "plans", title: "Plans", enabled: true, active: false, reason: "hub" },
    ];
    const lines = new Set(inactive.map((plugin) => plansSettingsState(plugin, undefined, NOW)));
    expect([...lines]).toEqual([
      "While it is inactive, this computer’s agents are not asked for plans, and task pages show no Plans section.",
    ]);
    for (const line of lines) expect(line).not.toMatch(/PEER_PLANS|newer Hub|turned off/i);
  });

  it("has no row for an environment that does not list Plans, and no line before its status field", () => {
    expect(plansSettingsState(undefined, undefined, NOW)).toBeNull();
    expect(plansSettingsState(on, undefined, NOW)).toBeNull();
    expect(PLANS_SUMMARY).toBe(
      "Before editing, agents say what they will change, use and provide; Peer says whose work meets theirs.",
    );
  });
});
