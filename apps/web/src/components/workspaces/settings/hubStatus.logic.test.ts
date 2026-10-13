import type { PeerHubInfo, PeerPluginState } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { CHECKING, type ConnectionView } from "../../settings/connectionFacts";
import {
  featuresFootnote,
  hubAddress,
  hubBuild,
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
  "ownership",
].map((id) => plugin(id));

const flags = { pathRules: true, webhooks: true, github: true };

/** Every feature of the Hub this app has words for. */
const ALL = [
  "settings",
  "resources",
  "github",
  "audit",
  "metrics",
  "webhooks",
  "slack",
  "requests",
  "observe",
  "knowledge",
  "memory",
  "handoff",
  "dependencies",
  "announcements",
  "digest",
  "impact",
  "ownership",
];

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
    flags,
    pathRuleProjects: [],
    ...input,
  });

const byId = (list: ReturnType<typeof rows>, id: string) => list.find((row) => row.id === id);

describe("the features of a Hub that serves them all", () => {
  it("lists coordination first and then every feature the Hub has, each on", () => {
    const list = rows({ hub: catalog(ALL) });
    expect(list.map((row) => row.id)).toEqual([
      "coordination",
      "settings",
      "resources",
      "github",
      "audit",
      "metrics",
      "webhooks",
      "slack",
      "requests",
      "observe",
      "knowledge",
      "memory",
      "handoff",
      "dependencies",
      "announcements",
      "digest",
      "impact",
      "ownership",
    ]);
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
    expect(byId(list, "resources")?.name).toBe("Path rules");
    expect(byId(list, "audit")).toMatchObject({
      name: "Audit log",
      effect: "Every settings change is recorded with who, what, from and to.",
    });
    expect(byId(list, "metrics")).toMatchObject({
      name: "Team metrics",
      effect: "Workspace › People shows usage per person.",
    });
  });
});

describe("a feature a Hub with a catalog does not serve", () => {
  it("is off on this Hub when its operator turned it off, and says what that means", () => {
    const list = rows({
      hub: catalog(
        ALL.filter((id) => id !== "resources"),
        ["resources"],
      ),
      pathRuleProjects: ["Booking", "Peer Hub"],
    });
    expect(byId(list, "resources")).toMatchObject({
      state: "off-hub",
      label: "Not available",
      effect:
        "Booking’s and Peer Hub’s path rules are saved but don’t apply. Agents get each project’s policy.",
    });
    expect(byId(list, "settings")?.state).toBe("on");
  });

  it("needs a newer Hub when it neither serves it nor turned it off", () => {
    const list = rows({ hub: catalog(ALL.filter((id) => id !== "handoff")) });
    expect(byId(list, "handoff")).toMatchObject({
      state: "newer",
      label: "Not available",
      effect: "Review packages can’t be stored until the Hub is updated.",
    });
  });

  it("is off, not waiting for an update, for what a Hub may be built without", () => {
    const list = rows({ hub: catalog(ALL.filter((id) => id !== "memory")) });
    expect(byId(list, "memory")).toMatchObject({
      state: "off-hub",
      effect: "This Hub was built without Memory, so projects can’t turn it on.",
    });
  });

  it("is told by the catalog, not by whether the Hub serves settings", () => {
    const list = rows({
      hub: catalog(
        ALL.filter((id) => id !== "slack" && id !== "settings"),
        ["slack"],
      ),
    });
    expect(byId(list, "slack")?.state).toBe("off-hub");
    expect(byId(list, "settings")?.state).toBe("newer");
  });

  it("waits for a newer Hub when the Hub serves it, but not at the revision the plugin needs", () => {
    const list = rows({
      hub: catalog(ALL),
      plugins: everything.map((entry) =>
        entry.id === "handoff" ? { ...entry, active: false, reason: "hub" } : entry,
      ),
    });
    expect(byId(list, "handoff")?.state).toBe("newer");
  });
});

describe("what the Hub says is not what this computer chose", () => {
  it("does not call a plugin turned off here a fact about a Hub that serves it", () => {
    const off = everything.map((entry) =>
      entry.id === "slack" ? { ...entry, enabled: false, active: false, reason: "off" } : entry,
    );
    const list = rows({ hub: catalog(ALL), plugins: off });
    expect(byId(list, "slack")).toMatchObject({ state: "on", label: "Connected" });
    expect(featuresFootnote(list)).not.toContain("this computer");
  });

  it("lists a feature whose plugin this build has not, as the Hub says, but not Memory", () => {
    const list = rows({
      hub: catalog(ALL),
      plugins: everything.filter((entry) => entry.id !== "memory" && entry.id !== "slack"),
    });
    expect(byId(list, "slack")?.state).toBe("on");
    // Memory is frozen in a build that has no plugin for it; a Hub that serves it is not advertised.
    expect(byId(list, "memory")).toBeUndefined();
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
    expect(list.map((row) => row.id)).toEqual([
      "coordination",
      "settings",
      "resources",
      "github",
      "webhooks",
      "slack",
      "requests",
      "observe",
      "knowledge",
      "memory",
      "handoff",
      "dependencies",
      "ownership",
    ]);
    expect(list.every((row) => row.state === "on" && row.label === "Connected")).toBe(true);
  });

  it("is the operator's choice when the Hub serves settings, so it is newer than the feature", () => {
    const memory = byId(rows({ plugins: without("memory") }), "memory");
    expect(memory).toMatchObject({
      state: "off-hub",
      label: "Not available",
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
      label: "Not available",
      effect: "Settings can be read here but not changed until the Hub is updated.",
    });
    expect(byId(list, "webhooks")?.state).toBe("newer");
    expect(byId(list, "requests")?.state).toBe("on");
  });

  it("still tells from the plugins when the catalog has no list of what is off", () => {
    const list = rows({
      hub: { features: { requests: 1, settings: 1 } },
      plugins: without("slack"),
    });
    expect(byId(list, "slack")?.state).toBe("off-hub");
    expect(byId(list, "requests")?.state).toBe("on");
  });

  it("says what path rules turned off do, naming the projects that have them", () => {
    const list = rows({
      flags: { ...flags, pathRules: false },
      pathRuleProjects: ["Booking", "Peer Hub"],
    });
    expect(byId(list, "resources")).toMatchObject({
      state: "off-hub",
      effect:
        "Booking’s and Peer Hub’s path rules are saved but don’t apply. Agents get each project’s policy.",
    });
  });

  it("says GitHub's checks are not served when the settings say so", () => {
    const list = rows({ flags: { ...flags, github: false } });
    expect(byId(list, "github")).toMatchObject({ state: "off-hub", label: "Not available" });
  });
});

describe("what the app cannot tell", () => {
  it("leaves out path rules and GitHub where the settings cannot be read", () => {
    const list = rows({ flags: null });
    expect(byId(list, "resources")).toBeUndefined();
    expect(byId(list, "github")).toBeUndefined();
  });

  it("leaves out the features no plugin waits for, which an older Hub says nothing of", () => {
    const list = rows();
    for (const id of ["audit", "metrics", "announcements", "impact"]) {
      expect(byId(list, id)).toBeUndefined();
    }
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
      label: "Off",
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
  it("explains that a feature the Hub cannot do is the Hub's, and the row says which", () => {
    expect(featuresFootnote(rows())).toBe(
      "“Not available” is the Hub’s: its operator turned the feature off, or the Hub needs an update, and the row says which.",
    );
  });

  it("explains a choice made on this computer when one is in the table", () => {
    const off = everything.map((entry) =>
      entry.id === "slack" ? { ...entry, enabled: false, active: false, reason: "off" } : entry,
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
    expect(hubBuild({ features: { requests: 1 } })).toBeNull();
    expect(hubBuild({ version: " ", commit: "" })).toBeNull();
  });
});

describe("a feature in the status language", () => {
  it("maps what the Hub does onto Connected, Not available and Off", () => {
    const list = rows({
      hub: catalog(
        ALL.filter((id) => id !== "resources" && id !== "handoff"),
        ["resources"],
      ),
    });
    expect(byId(list, "settings")).toMatchObject({ connection: "connected", label: "Connected" });
    expect(byId(list, "resources")).toMatchObject({
      connection: "unavailable",
      label: "Not available",
    });
    expect(byId(list, "handoff")).toMatchObject({
      connection: "unavailable",
      label: "Not available",
    });
    const off = everything.map((entry) =>
      entry.id === "slack" ? { ...entry, enabled: false, active: false, reason: "off" } : entry,
    );
    expect(byId(rows({ plugins: off }), "slack")).toMatchObject({
      connection: "off",
      label: "Off",
    });
  });

  it("never calls a feature On, Enabled or Authenticated", () => {
    const list = rows({ hub: catalog(ALL, ["telepathy"]) });
    for (const row of list) expect(row.label).not.toMatch(/^(On|Enabled|Authenticated)$/);
  });
});

describe("Slack and GitHub's checks, which the workspace connects too", () => {
  const slackSetup: ConnectionView = {
    state: "setup",
    step: { n: 3, of: 4, title: "verify the stored token with Slack" },
  };
  const githubOff: ConnectionView = {
    state: "off",
    detail: "Agents can’t prove a merge yet.",
  };

  it("says Slack needs setup, at its step, while the workspace has not finished", () => {
    const row = byId(rows({ connections: { slack: slackSetup } }), "slack");
    expect(row).toMatchObject({
      state: "on",
      connection: "setup",
      label: "Needs setup",
      effect:
        "Step 3 of 4: verify the stored token with Slack. Until then agents ask only in Peer.",
    });
  });

  it("says GitHub's checks are off with what that means for pull requests", () => {
    const row = byId(rows({ connections: { github: githubOff } }), "github");
    expect(row).toMatchObject({
      connection: "off",
      label: "Off",
      effect: "Agents can’t prove a merge yet. Pull requests count as their agents report them.",
    });
  });

  it("keeps what the feature does once the workspace is connected", () => {
    const row = byId(
      rows({ connections: { slack: { state: "connected", detail: "Acme as @peer" } } }),
      "slack",
    );
    expect(row).toMatchObject({
      connection: "connected",
      label: "Connected",
      effect: "Agents can ask people in Slack when they wait.",
    });
  });

  it("says Checking… and what the feature does while the connection is being read", () => {
    const row = byId(rows({ connections: { slack: CHECKING } }), "slack");
    expect(row).toMatchObject({
      connection: "off",
      label: "Checking…",
      effect: "Agents can ask people in Slack when they wait.",
    });
  });

  it("leaves the rest to what the Hub does when it knows nothing of the connection", () => {
    const row = byId(rows({ connections: {} }), "slack");
    expect(row).toMatchObject({ connection: "connected", label: "Connected" });
    expect(row?.effect).toBe("Agents can ask people in Slack when they wait.");
  });

  it("does not tell a connection of a feature the Hub cannot serve", () => {
    const list = rows({
      hub: catalog(ALL.filter((id) => id !== "slack")),
      connections: { slack: slackSetup },
    });
    expect(byId(list, "slack")).toMatchObject({
      state: "newer",
      connection: "unavailable",
      label: "Not available",
      effect: "Agents can’t ask people in Slack until the Hub is updated.",
    });
  });
});
