import type { PeerPluginState } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  COORDINATION_OFF_NOTE,
  DEFAULT_POLICIES,
  defaultPolicyHint,
  hubOffPlugins,
  isDefaultPolicy,
  pathRulesNote,
  pluginViews,
  projectsWithPathRules,
  splitByDefault,
  type PluginView,
} from "./coordinationAndPlugins.logic";

describe("the default policy", () => {
  it("offers notify, coordinate and ask with the design's words, and not exclusive", () => {
    expect(DEFAULT_POLICIES.map((policy) => [policy.value, policy.hint])).toEqual([
      ["notify", "Your agents learn who else is on a file and keep going."],
      ["coordinate", "Your agents wait until they confirm an overlap or leave a note."],
      ["ask", "Your agents ask you before they settle an overlap."],
    ]);
    expect(isDefaultPolicy("ask")).toBe(true);
    expect(isDefaultPolicy("exclusive")).toBe(false);
    expect(isDefaultPolicy(undefined)).toBe(false);
  });

  it("says what the chosen default means, and nothing for one it does not offer", () => {
    expect(defaultPolicyHint("ask")).toBe("Your agents ask you before they settle an overlap.");
    expect(defaultPolicyHint("exclusive")).toBeNull();
  });

  it("tells a computer with coordination off that no policy applies", () => {
    expect(COORDINATION_OFF_NOTE).toBe(
      "Agent coordination is off on this computer, so no policy applies. Turn it on under Agent coordination below.",
    );
  });
});

const project = (id: string, name: string) => ({ project: { id, name } });

/** The design's Acme: Booking and Peer Hub set a policy of their own, three projects follow the default. */
const acme = {
  slug: "acme",
  name: "Acme",
  projects: [
    project("camp-bot", "Camp-bot"),
    project("booking", "Booking"),
    project("city-bot", "City-bot"),
    project("peer-hub", "Peer Hub"),
    project("meal-planner", "Meal planner"),
  ],
};

describe("where the default applies", () => {
  it("splits the projects into those it applies to and those that set their own, as the design does", () => {
    const split = splitByDefault(
      [acme],
      { acme: { booking: "coordinate", "peer-hub": "notify" } },
      "ask",
    );
    expect(split.applies.map((ref) => ref.name)).toEqual(["Camp-bot", "City-bot", "Meal planner"]);
    expect(split.own.map((row) => [row.project.name, row.policy, row.overridden])).toEqual([
      ["Booking", "coordinate", "ask"],
      ["Peer Hub", "notify", "ask"],
    ]);
    expect(split.unread).toEqual([]);
  });

  it("changes with the default: a project that sets what the default now is no longer struck through", () => {
    const policies = { acme: { booking: "coordinate", "peer-hub": "notify" } };
    const split = splitByDefault([acme], policies, "coordinate");
    expect(split.own.map((row) => [row.project.name, row.overridden])).toEqual([
      ["Booking", null],
      ["Peer Hub", "coordinate"],
    ]);
    // A project that sets a policy is not one the default applies to, even where they agree.
    expect(split.applies.map((ref) => ref.name)).not.toContain("Booking");
  });

  it("names exclusive and a policy this app does not know as the project's own", () => {
    const split = splitByDefault(
      [acme],
      { acme: { booking: "exclusive", "peer-hub": "someday" } },
      "notify",
    );
    expect(split.own.map((row) => [row.project.name, row.policy, row.overridden])).toEqual([
      ["Booking", "exclusive", "notify"],
      ["Peer Hub", "someday", "notify"],
    ]);
  });

  it("applies the default everywhere once a workspace is read and no project sets a policy", () => {
    const split = splitByDefault([acme], { acme: {} }, "ask");
    expect(split.applies).toHaveLength(5);
    expect(split.own).toEqual([]);
  });

  it("keeps the workspace of each project, since ids are only unique inside one", () => {
    const split = splitByDefault(
      [acme, { slug: "webinson", name: "Webinson", projects: [project("booking", "Booking")] }],
      { acme: { booking: "ask" }, webinson: {} },
      "notify",
    );
    expect(split.own.map((row) => [row.project.workspace, row.project.id])).toEqual([
      ["acme", "booking"],
    ]);
    expect(
      split.applies.filter((ref) => ref.id === "booking").map((ref) => ref.workspaceName),
    ).toEqual(["Webinson"]);
  });

  it("does not claim the default for a workspace the Hub has not been read for", () => {
    const split = splitByDefault(
      [acme, { slug: "webinson", name: "Webinson", projects: [project("site", "Site")] }],
      { acme: {} },
      "ask",
    );
    expect(split.unread.map((ref) => ref.name)).toEqual(["Site"]);
    expect(split.applies.map((ref) => ref.name)).not.toContain("Site");
  });

  it("leaves every project unread for an environment that reports no policies", () => {
    const split = splitByDefault([acme], undefined, "ask");
    expect(split.unread).toHaveLength(5);
    expect(split.applies).toEqual([]);
    expect(split.own).toEqual([]);
  });

  it("reads a workspace named like an object's own property as unread, not as a policy list", () => {
    const split = splitByDefault(
      [{ slug: "constructor", name: "Odd", projects: [project("a", "A")] }],
      {},
      "ask",
    );
    expect(split.unread.map((ref) => ref.id)).toEqual(["a"]);
  });

  it("has no projects to split for no workspace", () => {
    expect(splitByDefault([], { acme: {} }, "ask")).toEqual({ applies: [], own: [], unread: [] });
  });
});

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
  it("shows a plugin its owner left on as on, by them, with a switch they can change", () => {
    expect(only([plugin("handoff")])).toMatchObject({
      state: "On",
      source: "by you",
      tone: "ok",
      checked: true,
      disabled: false,
      note: null,
      consequence: null,
    });
  });

  it("shows a plugin its owner turned off as off, by them", () => {
    expect(only([plugin("find", { enabled: false, active: false, reason: "off" })])).toMatchObject({
      state: "Off",
      source: "by you",
      tone: "ok",
      checked: false,
      disabled: false,
    });
  });

  it("shows a plugin an operator forces off as off, in amber, with the policy and no way to change it", () => {
    const view = only([
      plugin("find", {
        enabled: false,
        active: false,
        reason: "FORCE_TEST=off",
        locked: true,
      }),
    ]);
    expect(view).toMatchObject({
      state: "Off",
      source: "forced off by the operator",
      tone: "warn",
      note: "Forced off by FORCE_TEST=off.",
      checked: false,
      disabled: true,
    });
  });

  it("shows a plugin whose feature the Hub turned off as off in amber, switch off and locked", () => {
    expect(only([plugin("webhooks")], { ...OWNER, hubOff: new Set(["webhooks"]) })).toMatchObject({
      state: "Off",
      source: "turned off on this Hub",
      tone: "warn",
      checked: false,
      disabled: true,
      consequence: null,
    });
  });

  it("says what stops applying where the Hub turned path rules off", () => {
    expect(
      only([plugin("resources", { title: "Resource claims" })], {
        ...OWNER,
        hubOff: new Set(["resources"]),
      }),
    ).toMatchObject({
      title: "Resource claims",
      state: "Off",
      source: "turned off on this Hub",
      consequence: "path-rules",
    });
  });

  it("prefers the owner's own choice over the Hub's: a plugin they turned off is off by them", () => {
    expect(
      only([plugin("webhooks", { enabled: false, active: false, reason: "off" })], {
        ...OWNER,
        hubOff: new Set(["webhooks"]),
      }),
    ).toMatchObject({ state: "Off", source: "by you", tone: "ok", consequence: null });
  });

  it("shows a plugin a Hub too old to have it cannot run as unavailable, and says the Hub must be updated", () => {
    expect(only([plugin("requests", { active: false, reason: "hub" })])).toMatchObject({
      state: "Unavailable",
      source: "needs a newer Hub",
      tone: "ok",
      note: "The Hub must be updated before this works.",
      checked: false,
      disabled: true,
    });
  });

  it("shows everyone but the owner what is so, with the switch off their hands and the owner named", () => {
    const reader = { owner: false, pending: null, hubOff: NO_HUB_OFF } as const;
    expect(only([plugin("handoff")], reader)).toMatchObject({
      state: "On",
      source: "by this computer’s owner",
      checked: true,
      disabled: true,
    });
    expect(
      only([plugin("find", { enabled: false, active: false, reason: "off" })], reader),
    ).toMatchObject({ state: "Off", source: "by this computer’s owner", disabled: true });
  });

  it("holds the switch of the plugin whose change is on its way, and says which", () => {
    const views = pluginViews([plugin("requests"), plugin("observe")], {
      ...OWNER,
      pending: "observe",
    });
    expect(views.map((view) => [view.id, view.busy, view.disabled])).toEqual([
      ["requests", false, false],
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
    ).toMatchObject({ state: "Off", error: "The Hub did not revoke the key." });
  });

  it("keeps the order of the environment's list, and leaves memory out while the build does", () => {
    expect(
      pluginViews([plugin("requests"), plugin("memory"), plugin("find")], OWNER).map(
        (view) => view.id,
      ),
    ).toEqual(["requests", "find"]);
  });

  it("knows which plugins a Hub that lists them says its operator turned off", () => {
    expect(hubOffPlugins({ featuresOff: [] }, null)).toEqual(new Set());
    expect(hubOffPlugins({ featuresOff: ["resources", "audit"] }, null)).toEqual(
      new Set(["resources", "audit"]),
    );
  });

  it("believes the Hub's list over the flags of the settings it shows", () => {
    // A Hub that lists nothing off is not contradicted by flags that say otherwise.
    expect(
      hubOffPlugins({ featuresOff: [] }, { pathRules: false, webhooks: false, github: true }),
    ).toEqual(new Set());
    expect(
      hubOffPlugins({ featuresOff: ["slack"] }, { pathRules: true, webhooks: true, github: true }),
    ).toEqual(new Set(["slack"]));
  });

  it("falls back to the settings a Hub that serves them shows, where it lists nothing", () => {
    expect(hubOffPlugins(undefined, null)).toEqual(new Set());
    expect(hubOffPlugins({}, { pathRules: true, webhooks: true, github: true })).toEqual(new Set());
    expect(hubOffPlugins({}, { pathRules: false, webhooks: true, github: false })).toEqual(
      new Set(["resources"]),
    );
    expect(hubOffPlugins(undefined, { pathRules: false, webhooks: false, github: true })).toEqual(
      new Set(["resources", "webhooks"]),
    );
  });
});

describe("what stops applying while path rules are off", () => {
  it("names the projects that have path rules, as the design does", () => {
    expect(pathRulesNote(["Booking"])).toBe("Booking’s path rules don’t apply while this is off.");
    expect(pathRulesNote(["Booking", "Peer Hub"])).toBe(
      "Booking’s and Peer Hub’s path rules don’t apply while this is off.",
    );
    expect(pathRulesNote(["Booking", "Peer Hub", "Camp-bot"])).toBe(
      "Booking’s, Peer Hub’s and Camp-bot’s path rules don’t apply while this is off.",
    );
  });

  it("finds the projects of a settings document that have path rules, among those the person is on", () => {
    const document = {
      projects: {
        booking: {
          name: "Booking",
          coordination: { policy: "coordinate", paths: { "migrations/**": "exclusive" } },
        },
        "peer-hub": { name: "Peer Hub", coordination: { paths: { "docs/**": "notify" } } },
        "camp-bot": { name: "Camp-bot", coordination: { policy: "ask", paths: {} } },
        city: { name: "City-bot", coordination: { policy: "notify" } },
        nameless: { coordination: { paths: { "a/**": "ask" } } },
        elsewhere: { name: "Elsewhere", coordination: { paths: { "x/**": "ask" } } },
      },
    };
    const mine = new Set(["booking", "peer-hub", "camp-bot", "city", "nameless"]);
    expect(projectsWithPathRules(document, mine)).toEqual(["Booking", "Peer Hub", "nameless"]);
    expect(projectsWithPathRules(document, new Set(["elsewhere"]))).toEqual(["Elsewhere"]);
    expect(projectsWithPathRules(document, new Set())).toEqual([]);
  });

  it("finds none in a document without projects, or before it is read", () => {
    const mine = new Set(["booking"]);
    expect(projectsWithPathRules(undefined, mine)).toEqual([]);
    expect(projectsWithPathRules({}, mine)).toEqual([]);
    expect(projectsWithPathRules({ projects: [] }, mine)).toEqual([]);
  });
});
