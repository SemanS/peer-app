import { AuthAccessWriteScope, AuthOrchestrationOperateScope } from "@t3tools/contracts";
import type { PeerHubStatus, PeerPluginState } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  activePlugin,
  canChangePeerPlugins,
  featuresBuiltWithout,
  hubFeatureState,
  inactivePluginReason,
  pluginLockNote,
} from "./plugins.ts";

const plugin = (
  id: string,
  state: Partial<Pick<PeerPluginState, "enabled" | "active" | "reason" | "locked">> = {},
): PeerPluginState => ({
  id,
  title: id,
  enabled: true,
  active: true,
  ...state,
});

const status = (plugins?: ReadonlyArray<PeerPluginState>): Pick<PeerHubStatus, "plugins"> =>
  plugins === undefined ? {} : { plugins };

it("explains explicit policy locks without guessing from a newer reason", () => {
  expect(pluginLockNote(plugin("find", { locked: true, reason: "FORCE_TEST=off" }))).toBe(
    "Forced off by FORCE_TEST=off.",
  );
  expect(pluginLockNote(plugin("find", { locked: true }))).toBe(
    "Forced off by the environment operator.",
  );
  expect(pluginLockNote(plugin("find", { reason: "future-reason" }))).toBeNull();
  expect(
    inactivePluginReason(
      status([plugin("find", { active: false, enabled: false, locked: true })]),
      "find",
    ),
  ).toBe("locked");
});

describe("activePlugin", () => {
  it("treats the features that existed before plugins as active without a plugin list", () => {
    for (const id of ["requests", "observe", "herdr", "github", "capacity", "knowledge"]) {
      expect(activePlugin(status(), id)).toBe(true);
    }
    expect(activePlugin(status(), "telepathy")).toBe(false);
  });

  it("treats an empty list like a missing one", () => {
    expect(activePlugin(status([]), "requests")).toBe(true);
    expect(activePlugin(status([]), "telepathy")).toBe(false);
  });

  it("follows the list once the environment sends one", () => {
    const listed = status([
      plugin("requests"),
      plugin("observe", { enabled: false, active: false, reason: "off" }),
      plugin("knowledge", { active: false, reason: "hub" }),
    ]);
    expect(activePlugin(listed, "requests")).toBe(true);
    expect(activePlugin(listed, "observe")).toBe(false);
    expect(activePlugin(listed, "knowledge")).toBe(false);
    // Not in the list: the environment does not have it.
    expect(activePlugin(listed, "herdr")).toBe(false);
  });

  it("shows nothing before the status has arrived", () => {
    expect(activePlugin(null, "requests")).toBe(false);
    expect(activePlugin(undefined, "requests")).toBe(false);
  });

  it("keeps memory hidden while the build excludes it", () => {
    expect(activePlugin(status(), "memory")).toBe(false);
    expect(activePlugin(status([plugin("memory")]), "memory")).toBe(false);
  });
});

describe("inactivePluginReason", () => {
  it("says why a plugin is not active", () => {
    const listed = status([
      plugin("requests"),
      plugin("observe", { enabled: false, active: false, reason: "off" }),
      plugin("knowledge", { active: false, reason: "hub" }),
    ]);
    expect(inactivePluginReason(listed, "requests")).toBeNull();
    expect(inactivePluginReason(listed, "observe")).toBe("off");
    expect(inactivePluginReason(listed, "knowledge")).toBe("hub");
    expect(inactivePluginReason(listed, "herdr")).toBe("missing");
    expect(inactivePluginReason(status(), "requests")).toBeNull();
  });

  it("waits for a Hub while none has answered, or while nobody is signed in", () => {
    const unanswered = status([plugin("knowledge", { active: false, reason: "hub-unknown" })]);
    expect(inactivePluginReason(unanswered, "knowledge")).toBe("waiting");
    // An environment from before `hub-unknown` says `hub` while signed out, when no Hub can say.
    const older = status([plugin("knowledge", { active: false, reason: "hub" })]);
    expect(inactivePluginReason({ ...older, signedIn: false }, "knowledge")).toBe("waiting");
    expect(inactivePluginReason({ ...older, signedIn: true }, "knowledge")).toBe("hub");
    const off = status([plugin("knowledge", { enabled: false, active: false, reason: "off" })]);
    expect(inactivePluginReason({ ...off, signedIn: false }, "knowledge")).toBe("off");
  });

  it("offers nothing to turn on for memory while the build excludes it", () => {
    const off = status([plugin("memory", { enabled: false, active: false, reason: "off" })]);
    expect(inactivePluginReason(off, "memory")).toBe("missing");
    expect(inactivePluginReason(status(), "memory")).toBe("missing");
  });
});

describe("canChangePeerPlugins", () => {
  it("lets only a session with access-write change plugins", () => {
    expect(canChangePeerPlugins({ authenticated: true, scopes: [AuthAccessWriteScope] })).toBe(
      true,
    );
    expect(
      canChangePeerPlugins({ authenticated: true, scopes: [AuthOrchestrationOperateScope] }),
    ).toBe(false);
    expect(canChangePeerPlugins({ authenticated: true })).toBe(false);
    expect(canChangePeerPlugins({ authenticated: false, scopes: [AuthAccessWriteScope] })).toBe(
      false,
    );
    expect(canChangePeerPlugins(null)).toBe(false);
  });
});

describe("hubFeatureState", () => {
  const hub = (info: NonNullable<PeerHubStatus["hub"]>): Pick<PeerHubStatus, "hub"> => ({
    hub: info,
  });
  const told = hub({ features: { requests: 1, settings: 2 }, featuresOff: ["resources"] });

  it("is on where the Hub serves the feature, off where its operator turned it off", () => {
    expect(hubFeatureState(told, "requests")).toBe("on");
    expect(hubFeatureState(told, "resources")).toBe("off");
  });

  it("is newer where the Hub does neither, which an update fixes", () => {
    expect(hubFeatureState(told, "impact")).toBe("newer");
  });

  it("needs the revision the plugin needs, or a later one", () => {
    expect(hubFeatureState(told, "settings", 2)).toBe("on");
    expect(hubFeatureState(told, "settings", 3)).toBe("newer");
  });

  it("does not guess where the Hub says too little", () => {
    // No catalog at all: an older Hub.
    expect(hubFeatureState({}, "requests")).toBeUndefined();
    expect(hubFeatureState(null, "requests")).toBeUndefined();
    expect(hubFeatureState(hub({ version: "0.8.4" }), "requests")).toBeUndefined();
    // A catalog without the list of what is off: a feature missing from it may be either.
    const catalogOnly = hub({ features: { requests: 1 } });
    expect(hubFeatureState(catalogOnly, "requests")).toBe("on");
    expect(hubFeatureState(catalogOnly, "resources")).toBeUndefined();
  });

  it("believes the operator's list even where the Hub sent no catalog", () => {
    expect(hubFeatureState(hub({ featuresOff: ["resources"] }), "resources")).toBe("off");
    expect(hubFeatureState(hub({ featuresOff: ["resources"] }), "impact")).toBeUndefined();
  });
});

describe("featuresBuiltWithout", () => {
  const hub = (info: NonNullable<PeerHubStatus["hub"]>): Pick<PeerHubStatus, "hub"> => ({
    hub: info,
  });

  it("names Memory where a Hub with a full catalog neither serves it nor turned it off", () => {
    expect(featuresBuiltWithout(hub({ features: { requests: 1 }, featuresOff: [] }))).toEqual(
      new Set(["memory"]),
    );
  });

  it("names nothing where the Hub serves it, or its operator turned it off", () => {
    expect(
      featuresBuiltWithout(hub({ features: { requests: 1, memory: 1 }, featuresOff: [] })),
    ).toEqual(new Set());
    expect(
      featuresBuiltWithout(hub({ features: { requests: 1 }, featuresOff: ["memory"] })),
    ).toEqual(new Set());
  });

  it("does not guess where the Hub says too little, and never names a feature every Hub has", () => {
    expect(featuresBuiltWithout(null)).toEqual(new Set());
    expect(featuresBuiltWithout({})).toEqual(new Set());
    expect(featuresBuiltWithout(hub({ features: { requests: 1 } }))).toEqual(new Set());
    expect(featuresBuiltWithout(hub({ features: {}, featuresOff: [] }))).toEqual(
      new Set(["memory"]),
    );
  });
});
