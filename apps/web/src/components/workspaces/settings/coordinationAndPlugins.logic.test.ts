import type { PeerPluginState } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { hubOffPlugins, pluginViews, type PluginView } from "./coordinationAndPlugins.logic";

const plugin = (id: string, extra: Partial<PeerPluginState> = {}): PeerPluginState => ({
  id,
  title: id,
  enabled: true,
  active: true,
  ...extra,
});

const NO_HUB_OFF: ReadonlySet<string> = new Set();
const OWNER = { owner: true, pending: null, hubOff: NO_HUB_OFF } as const;

const only = (
  plugins: ReadonlyArray<PeerPluginState>,
  input: Parameters<typeof pluginViews>[1] = OWNER,
): PluginView => {
  const [view] = pluginViews(plugins, input);
  if (view === undefined) throw new Error("no plugin view");
  return view;
};

describe("the plugins and where each comes from", () => {
  it("shows a plugin its owner left on as Connected, by them, with a switch they can change", () => {
    expect(only([plugin("changes")])).toMatchObject({
      status: "connected",
      source: "by you",
      checked: true,
      disabled: false,
      note: null,
    });
  });

  it("shows a plugin its owner turned off as Off, by them", () => {
    expect(only([plugin("find", { enabled: false, active: false, reason: "off" })])).toMatchObject({
      status: "off",
      source: "by you",
      checked: false,
      disabled: false,
    });
  });

  it("shows a plugin an operator forces off as Not available, with the policy and no way to change it", () => {
    const view = only([
      plugin("find", {
        enabled: false,
        active: false,
        reason: "FORCE_TEST=off",
        locked: true,
      }),
    ]);
    expect(view).toMatchObject({
      status: "unavailable",
      source: "forced off by the operator",
      note: "Forced off by FORCE_TEST=off.",
      checked: false,
      disabled: true,
    });
  });

  it("shows a plugin whose feature the Hub turned off as Not available, switch off and locked", () => {
    expect(only([plugin("changes")], { ...OWNER, hubOff: new Set(["changes"]) })).toMatchObject({
      status: "unavailable",
      source: "turned off on this Hub",
      checked: false,
      disabled: true,
    });
  });

  it("prefers the owner's own choice over the Hub's: a plugin they turned off is off by them", () => {
    expect(
      only([plugin("changes", { enabled: false, active: false, reason: "off" })], {
        ...OWNER,
        hubOff: new Set(["changes"]),
      }),
    ).toMatchObject({ status: "off", source: "by you" });
  });

  it("shows a plugin a Hub too old to have it cannot run as Not available, and says the Hub must be updated", () => {
    expect(only([plugin("changes", { active: false, reason: "hub" })])).toMatchObject({
      status: "unavailable",
      source: "needs a newer Hub",
      note: "The Hub must be updated before this works.",
      checked: false,
      disabled: true,
    });
  });

  it("shows a plugin waiting for its Hub's answer as Checking, not as needing a newer Hub", () => {
    expect(
      only([plugin("dependencies", { active: false, reason: "hub-unknown" })], {
        ...OWNER,
        signedIn: true,
      }),
    ).toMatchObject({
      status: "off",
      statusLabel: "Checking…",
      source: "",
      note: "Works once Peer reaches its Peer Hub.",
      checked: false,
      disabled: true,
    });
  });

  it("does not say it is checking when nobody is signed in: the plugin works once they sign in", () => {
    const view = only([plugin("dependencies", { active: false, reason: "hub-unknown" })], {
      ...OWNER,
      signedIn: false,
    });
    expect(view).toMatchObject({
      status: "unavailable",
      source: "sign in to a Peer Hub",
      note: "Works once you sign in to a Peer Hub.",
    });
    expect(view.statusLabel).toBeUndefined();
  });

  it("never reads On, Enabled or Authenticated as a status", () => {
    const statuses = pluginViews(
      [
        plugin("changes"),
        plugin("find", { enabled: false, active: false, reason: "off" }),
        plugin("changes", { active: false, reason: "hub" }),
      ],
      OWNER,
    ).map((view) => view.statusLabel ?? view.status);
    expect(statuses).toEqual(["connected", "off", "unavailable"]);
  });

  it("shows everyone but the owner what is so, with the switch off their hands and the owner named", () => {
    const reader = { owner: false, pending: null, hubOff: NO_HUB_OFF } as const;
    expect(only([plugin("changes")], reader)).toMatchObject({
      status: "connected",
      source: "by this computer’s owner",
      checked: true,
      disabled: true,
    });
    expect(
      only([plugin("find", { enabled: false, active: false, reason: "off" })], reader),
    ).toMatchObject({ status: "off", source: "by this computer’s owner", disabled: true });
  });

  it("holds the switch of the plugin whose change is on its way, and says which", () => {
    const views = pluginViews([plugin("changes"), plugin("observe")], {
      ...OWNER,
      pending: "observe",
    });
    expect(views.map((view) => [view.id, view.busy, view.disabled])).toEqual([
      ["changes", false, false],
      ["observe", true, true],
    ]);
  });

  it("shows a cleanup that failed, whatever the plugin's state", () => {
    expect(
      only([
        plugin("capacity", {
          enabled: false,
          active: false,
          reason: "off",
          error: "The Hub did not revoke the key.",
        }),
      ]),
    ).toMatchObject({ status: "off", error: "The Hub did not revoke the key." });
  });

  it("keeps the order of the environment's list", () => {
    expect(
      pluginViews([plugin("changes"), plugin("observe")], OWNER).map((view) => view.id),
    ).toEqual(["changes", "observe"]);
  });

  it("knows which plugins a Hub that lists them says its operator turned off", () => {
    expect(hubOffPlugins({ featuresOff: [] })).toEqual(new Set());
    expect(hubOffPlugins({ featuresOff: ["audit"] })).toEqual(new Set(["audit"]));
  });
});
