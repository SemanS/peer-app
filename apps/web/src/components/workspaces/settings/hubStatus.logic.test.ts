import type { PeerPluginState } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  featuresFootnote,
  hubAddress,
  hubFeatureRows,
  pathRulesOffEffect,
  projectsWithPathRules,
} from "./hubStatus.logic";

const plugin = (id: string, overrides: Partial<PeerPluginState> = {}): PeerPluginState => ({
  id,
  title: id,
  enabled: true,
  active: true,
  ...overrides,
});

/** A Hub that serves everything: every plugin that needs a feature is active. */
const everything = [
  "settings",
  "webhooks",
  "slack",
  "requests",
  "observe",
  "knowledge",
  "memory",
  "handoff",
  "dependencies",
].map((id) => plugin(id));

const flags = { pathRules: true, webhooks: true, github: true };

const rows = (input: Partial<Parameters<typeof hubFeatureRows>[0]> = {}) =>
  hubFeatureRows({ plugins: everything, flags, pathRuleProjects: [], ...input });

const byId = (list: ReturnType<typeof rows>, id: string) => list.find((row) => row.id === id);

describe("the features of a Hub that serves them all", () => {
  it("lists coordination first and every feature the app can tell, each on", () => {
    const list = rows();
    expect(list.map((row) => row.id)).toEqual([
      "coordination",
      "settings",
      "path-rules",
      "github",
      "webhooks",
      "slack",
      "requests",
      "observe",
      "knowledge",
      "memory",
      "handoff",
      "dependencies",
    ]);
    expect(list.every((row) => row.state === "on" && row.label === "On")).toBe(true);
  });

  it("says what coordination does, in the design's words", () => {
    expect(byId(rows(), "coordination")).toMatchObject({
      name: "Coordination",
      effect: "Agents check files with the Hub before they edit.",
    });
  });
});

describe("a feature the Hub does not serve", () => {
  const without = (id: string) =>
    everything.map((entry) =>
      entry.id === id ? { ...entry, active: false, reason: "hub" } : entry,
    );

  it("is the operator's choice when the Hub serves settings, so it is newer than the feature", () => {
    const memory = byId(rows({ plugins: without("memory") }), "memory");
    expect(memory).toMatchObject({
      state: "off-hub",
      label: "Off on this Hub",
      effect: "This Hub was built without Memory, so projects can’t turn it on.",
    });
  });

  it("needs a newer Hub when the Hub does not even serve settings", () => {
    const old = everything.map((entry) =>
      ["settings", "webhooks", "slack", "handoff", "dependencies"].includes(entry.id)
        ? { ...entry, active: false, reason: "hub" }
        : entry,
    );
    const list = rows({ plugins: old, flags: null });
    expect(byId(list, "settings")).toMatchObject({
      state: "newer",
      label: "Needs a newer Hub",
      effect: "Settings can be read here but not changed until the Hub is updated.",
    });
    expect(byId(list, "webhooks")?.state).toBe("newer");
    expect(byId(list, "requests")?.state).toBe("on");
  });

  it("says what path rules turned off do, naming the projects that have them", () => {
    const list = rows({
      flags: { ...flags, pathRules: false },
      pathRuleProjects: ["Booking", "Peer Hub"],
    });
    expect(byId(list, "path-rules")).toMatchObject({
      state: "off-hub",
      effect:
        "Booking’s and Peer Hub’s path rules are saved but don’t apply. Agents get each project’s policy.",
    });
  });

  it("says GitHub's checks are not served when the settings say so", () => {
    const list = rows({ flags: { ...flags, github: false } });
    expect(byId(list, "github")).toMatchObject({ state: "off-hub", label: "Off on this Hub" });
  });
});

describe("what the app cannot tell", () => {
  it("leaves out path rules and GitHub where the settings cannot be read", () => {
    const list = rows({ flags: null });
    expect(byId(list, "path-rules")).toBeUndefined();
    expect(byId(list, "github")).toBeUndefined();
  });

  it("leaves out a plugin the build does not have", () => {
    const list = rows({ plugins: everything.filter((entry) => entry.id !== "memory") });
    expect(byId(list, "memory")).toBeUndefined();
    expect(byId(list, "handoff")).toBeDefined();
  });

  it("is only coordination for an environment that lists no plugins", () => {
    expect(rows({ plugins: undefined }).map((row) => row.id)).toEqual(["coordination"]);
  });

  it("does not call a plugin turned off here a fact about the Hub", () => {
    const off = everything.map((entry) =>
      entry.id === "slack" ? { ...entry, enabled: false, active: false, reason: "off" } : entry,
    );
    expect(byId(rows({ plugins: off }), "slack")).toMatchObject({
      state: "off-here",
      label: "Off on this computer",
      effect: "Turned off on this computer. Its owner turns it on in Coordination & plugins.",
    });
  });

  it("says who forced a plugin off", () => {
    const locked = everything.map((entry) =>
      entry.id === "slack"
        ? { ...entry, enabled: false, active: false, reason: "the operator", locked: true }
        : entry,
    );
    expect(byId(rows({ plugins: locked }), "slack")?.effect).toBe("Forced off by the operator.");
  });
});

describe("the path rules a Hub saves without applying", () => {
  it("names the projects that have them, by name", () => {
    expect(
      projectsWithPathRules({
        projects: {
          peer: {
            name: "Peer Hub",
            coordination: { policy: "notify", paths: { "src/**": "ask" } },
          },
          booking: {
            name: "Booking",
            coordination: { policy: "coordinate", paths: { "migrations/**": "exclusive" } },
          },
          camp: { name: "Camp-bot", coordination: { policy: "notify", paths: {} } },
          plain: { name: "Plain" },
          nameless: { coordination: { paths: { "a/**": "ask" } } },
        },
      }),
    ).toEqual(["Booking", "nameless", "Peer Hub"]);
  });

  it("are none without a document", () => {
    expect(projectsWithPathRules(null)).toEqual([]);
    expect(projectsWithPathRules({})).toEqual([]);
  });

  it("says it plainly when no project has any yet", () => {
    expect(pathRulesOffEffect([])).toBe(
      "Path rules are saved but don’t apply. Agents get each project’s policy.",
    );
    expect(pathRulesOffEffect(["Booking"])).toBe(
      "Booking’s path rules are saved but don’t apply. Agents get each project’s policy.",
    );
  });
});

describe("around the table", () => {
  it("explains the two states the Hub is in", () => {
    expect(featuresFootnote(rows())).toBe(
      "“Off on this Hub” is the operator’s choice. “Needs a newer Hub” goes away with an update.",
    );
  });

  it("explains a choice made on this computer when one is in the table", () => {
    const off = everything.map((entry) =>
      entry.id === "slack" ? { ...entry, enabled: false, active: false, reason: "off" } : entry,
    );
    expect(featuresFootnote(rows({ plugins: off }))).toContain(
      "“Off on this computer” is a choice made here, in Coordination & plugins.",
    );
  });

  it("shows the address without its scheme", () => {
    expect(hubAddress("https://hub.acme.dev")).toBe("hub.acme.dev");
    expect(hubAddress("https://hub.acme.dev/")).toBe("hub.acme.dev");
    expect(hubAddress("https://acme.dev/hub")).toBe("acme.dev/hub");
    expect(hubAddress("http://localhost:5190")).toBe("http://localhost:5190");
  });
});
