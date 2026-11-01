import type { PeerHubInfo, PeerPluginState } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { featuresFootnote, hubAddress, hubBuild, hubFeatureRows } from "./hubStatus.logic";

const plugin = (id: string, overrides: Partial<PeerPluginState> = {}): PeerPluginState => ({
  id,
  title: id,
  enabled: true,
  active: true,
  ...overrides,
});

/** A Hub that serves everything: every plugin that needs a feature is active. */
const everything = ["settings", "observe"].map((id) => plugin(id));

/** Every feature of the Hub this app has words for. */
const ALL = ["settings", "audit", "observe"];

/** What a Hub with the catalog says: it serves `serves`, and its operator turned `off` off. */
const catalog = (serves: ReadonlyArray<string>, off: ReadonlyArray<string> = []): PeerHubInfo => ({
  version: "0.8.4",
  commit: "a6bde95f1c2d3e4a5b6c7d8e9f0a1b2c3d4e5f60",
  features: Object.fromEntries(serves.map((id) => [id, 1])),
  featuresOff: [...off],
});

const rows = (input: Partial<Parameters<typeof hubFeatureRows>[0]> = {}) =>
  hubFeatureRows({
    plugins: everything,
    hub: undefined,
    ...input,
  });

const byId = (list: ReturnType<typeof rows>, id: string) => list.find((row) => row.id === id);

describe("the features of a Hub that serves them all", () => {
  it("lists coordination first and then every feature the Hub has, each on", () => {
    const list = rows({ hub: catalog(ALL) });
    expect(list.map((row) => row.id)).toEqual(["coordination", "settings", "audit", "observe"]);
    expect(list.every((row) => row.state === "on" && row.label === "Connected")).toBe(true);
  });

  it("says what coordination does, in the design's words", () => {
    expect(byId(rows(), "coordination")).toMatchObject({
      name: "Coordination",
      effect: "Agents check files with the Hub before they edit.",
    });
  });

  it("names the features as the design does", () => {
    const list = rows({ hub: catalog(ALL) });
    expect(byId(list, "audit")).toMatchObject({
      name: "Audit log",
      effect: "Every settings change is recorded with who, what, from and to.",
    });
  });
});

describe("a feature a Hub with a catalog does not serve", () => {
  it("is off on this Hub when its operator turned it off, and says what that means", () => {
    const list = rows({
      hub: catalog(
        ALL.filter((id) => id !== "audit"),
        ["audit"],
      ),
    });
    expect(byId(list, "audit")).toMatchObject({
      state: "off-hub",
      label: "Not available",
      effect: "The audit log can’t be read: this Hub doesn’t run it.",
    });
  });

  it("needs a newer Hub when it neither serves it nor turned it off", () => {
    const list = rows({ hub: catalog(ALL.filter((id) => id !== "observe")) });
    expect(byId(list, "observe")).toMatchObject({
      state: "newer",
      label: "Not available",
      effect: "Shared threads can’t be watched live until the Hub is updated.",
    });
  });

  it("is told by the catalog, not by whether the Hub serves settings", () => {
    const list = rows({
      hub: catalog(
        ALL.filter((id) => id !== "observe" && id !== "settings"),
        ["observe"],
      ),
    });
    expect(byId(list, "observe")?.state).toBe("off-hub");
    expect(byId(list, "settings")?.state).toBe("newer");
  });

  it("waits for a newer Hub when the Hub serves it, but not at the revision the plugin needs", () => {
    const list = rows({
      hub: catalog(ALL),
      plugins: everything.map((entry) =>
        entry.id === "observe" ? { ...entry, active: false, reason: "hub" } : entry,
      ),
    });
    expect(byId(list, "observe")?.state).toBe("newer");
  });
});

describe("what the Hub says is not what this computer chose", () => {
  it("does not call a plugin turned off here a fact about a Hub that serves it", () => {
    const off = everything.map((entry) =>
      entry.id === "observe" ? { ...entry, enabled: false, active: false, reason: "off" } : entry,
    );
    const list = rows({ hub: catalog(ALL), plugins: off });
    expect(byId(list, "observe")).toMatchObject({ state: "on", label: "Connected" });
    expect(featuresFootnote(list)).not.toContain("this computer");
  });

  it("lists a feature whose plugin this build has not, as the Hub says", () => {
    const list = rows({
      hub: catalog(ALL),
      plugins: everything.filter((entry) => entry.id !== "observe"),
    });
    expect(byId(list, "observe")?.state).toBe("on");
  });
});

describe("the features of the plugins this version of Peer has", () => {
  it("has words for Observe, not the line for what it knows nothing of", () => {
    const list = rows({ hub: catalog(ALL) });
    expect(byId(list, "observe")).toMatchObject({
      name: "Observe",
      state: "on",
      effect: "Teammates can watch a thread you share, live.",
    });
    expect(list.some((row) => row.effect.includes("has no words for"))).toBe(false);
  });

  it("says what each means for the workspace when the Hub does not run it", () => {
    const list = rows({
      hub: catalog(
        ALL.filter((id) => id !== "observe"),
        ["observe"],
      ),
    });
    expect(byId(list, "observe")).toMatchObject({
      state: "off-hub",
      label: "Not available",
      effect: "Shared threads can’t be watched live: this Hub doesn’t run it.",
    });
  });
});

describe("features this version of Peer has no words for", () => {
  it("lists the ones the Hub serves or turned off, after the rest", () => {
    const list = rows({
      hub: { ...catalog([...ALL, "telepathy", "bio-sync"], ["clairvoyance"]) },
    });
    expect(list.slice(-3).map((row) => [row.id, row.name, row.state])).toEqual([
      ["bio-sync", "Bio sync", "on"],
      ["telepathy", "Telepathy", "on"],
      ["clairvoyance", "Clairvoyance", "off-hub"],
    ]);
    expect(list.at(-1)?.effect).toBe(
      "A feature of this Hub that this version of Peer has no words for.",
    );
  });
});

describe("a feature the Hub does not serve, for a Hub that sends no catalog", () => {
  const without = (id: string) =>
    everything.map((entry) =>
      entry.id === id ? { ...entry, active: false, reason: "hub" } : entry,
    );

  it("lists coordination and every feature the app can tell, each on", () => {
    const list = rows();
    expect(list.map((row) => row.id)).toEqual(["coordination", "settings", "observe"]);
    expect(list.every((row) => row.state === "on" && row.label === "Connected")).toBe(true);
  });

  it("needs a newer Hub when the Hub does not even serve settings", () => {
    const old = everything.map((entry) =>
      ["settings", "observe"].includes(entry.id)
        ? { ...entry, active: false, reason: "hub" }
        : entry,
    );
    const list = rows({ plugins: old });
    expect(byId(list, "settings")).toMatchObject({
      state: "newer",
      label: "Not available",
      effect: "Settings can be read here but not changed until the Hub is updated.",
    });
    expect(byId(list, "observe")?.state).toBe("newer");
  });

  it("still tells from the plugins when the catalog has no list of what is off", () => {
    const list = rows({
      hub: { features: { changes: 1, settings: 1 } },
      plugins: without("observe"),
    });
    expect(byId(list, "observe")?.state).toBe("off-hub");
    expect(byId(list, "settings")?.state).toBe("on");
  });
});

describe("what the app cannot tell", () => {
  it("leaves out the features no plugin waits for, which an older Hub says nothing of", () => {
    const list = rows();
    for (const id of ["audit"]) {
      expect(byId(list, id)).toBeUndefined();
    }
  });

  it("leaves out a plugin the build does not have", () => {
    const list = rows({ plugins: everything.filter((entry) => entry.id !== "observe") });
    expect(byId(list, "observe")).toBeUndefined();
    expect(byId(list, "settings")).toBeDefined();
  });

  it("is only coordination for an environment that lists no plugins", () => {
    expect(rows({ plugins: undefined }).map((row) => row.id)).toEqual(["coordination"]);
  });

  it("does not call a plugin turned off here a fact about the Hub", () => {
    const off = everything.map((entry) =>
      entry.id === "observe" ? { ...entry, enabled: false, active: false, reason: "off" } : entry,
    );
    expect(byId(rows({ plugins: off }), "observe")).toMatchObject({
      state: "off-here",
      label: "Off",
      effect: "Turned off on this computer. Its owner turns it on in Coordination & plugins.",
    });
  });

  it("says who forced a plugin off", () => {
    const locked = everything.map((entry) =>
      entry.id === "observe"
        ? { ...entry, enabled: false, active: false, reason: "the operator", locked: true }
        : entry,
    );
    expect(byId(rows({ plugins: locked }), "observe")?.effect).toBe("Forced off by the operator.");
  });
});

describe("around the table", () => {
  it("explains that a feature the Hub cannot do is the Hub's, and the row says which", () => {
    expect(featuresFootnote(rows())).toBe(
      "“Not available” is the Hub’s: its operator turned the feature off, or the Hub needs an update, and the row says which.",
    );
  });

  it("explains a choice made on this computer when one is in the table", () => {
    const off = everything.map((entry) =>
      entry.id === "observe" ? { ...entry, enabled: false, active: false, reason: "off" } : entry,
    );
    expect(featuresFootnote(rows({ plugins: off }))).toContain(
      "“Off” is a choice made on this computer, in Coordination & plugins.",
    );
  });

  it("shows the address without its scheme", () => {
    expect(hubAddress("https://hub.acme.dev")).toBe("hub.acme.dev");
    expect(hubAddress("https://hub.acme.dev/")).toBe("hub.acme.dev");
    expect(hubAddress("https://acme.dev/hub")).toBe("acme.dev/hub");
    expect(hubAddress("http://localhost:5190")).toBe("http://localhost:5190");
  });

  it("shows the build as a release and the start of its commit, as far as the Hub says", () => {
    expect(hubBuild(catalog([]))).toEqual({ version: "0.8.4", commit: "a6bde95" });
    expect(hubBuild({ version: "0.8.4" })).toEqual({ version: "0.8.4", commit: null });
    expect(hubBuild({ commit: "a6bde95f1c" })).toEqual({ version: null, commit: "a6bde95" });
  });

  it("shows no build for a Hub that does not name one", () => {
    expect(hubBuild(undefined)).toBeNull();
    expect(hubBuild({ features: { changes: 1 } })).toBeNull();
    expect(hubBuild({ version: " ", commit: "" })).toBeNull();
  });
});

describe("a feature in the status language", () => {
  it("maps what the Hub does onto Connected, Not available and Off", () => {
    const list = rows({
      hub: catalog(
        ALL.filter((id) => id !== "audit" && id !== "observe"),
        ["audit"],
      ),
    });
    expect(byId(list, "settings")).toMatchObject({ connection: "connected", label: "Connected" });
    expect(byId(list, "audit")).toMatchObject({
      connection: "unavailable",
      label: "Not available",
    });
    expect(byId(list, "observe")).toMatchObject({
      connection: "unavailable",
      label: "Not available",
    });
    const off = everything.map((entry) =>
      entry.id === "observe" ? { ...entry, enabled: false, active: false, reason: "off" } : entry,
    );
    expect(byId(rows({ plugins: off }), "observe")).toMatchObject({
      connection: "off",
      label: "Off",
    });
  });

  it("never calls a feature On, Enabled or Authenticated", () => {
    const list = rows({ hub: catalog(ALL, ["telepathy"]) });
    for (const row of list) expect(row.label).not.toMatch(/^(On|Enabled|Authenticated)$/);
  });
});
