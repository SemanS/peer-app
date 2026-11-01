// @effect-diagnostics globalDate:off - it times how long a pure function takes.
import { describe, expect, it } from "@effect/vitest";

import {
  allocationOf,
  decisionParts,
  decisionText,
  effectivePolicy,
  getAt,
  harnessLabel,
  jsonEqual,
  planClass,
  planLabel,
  policiesOf,
  readDocument,
  setAt,
  setsFor,
  whereUsable,
} from "./peerSettings.ts";

describe("the draft", () => {
  const base = {
    currency: "EUR",
    projects: {
      booking: {
        name: "Booking",
        members: ["ana@acme.dev"],
        leads: ["ana@acme.dev"],
        coordination: { policy: "notify", paths: { "docs/**": "notify" } },
      },
      camp: { name: "Camp-bot" },
    },
  };

  it("reads a node at a path whose keys are data, and enters only mappings", () => {
    const keyed = {
      paths: { "migrations/**": "exclusive", "a.b": 1, constructor: "own" },
      list: [1],
    };
    expect(getAt(keyed, ["paths", "migrations/**"])).toBe("exclusive");
    expect(getAt(keyed, ["paths", "a.b"])).toBe(1);
    expect(getAt(keyed, ["paths", "constructor"])).toBe("own");
    expect(getAt(keyed, [])).toBe(keyed);
    expect(getAt(keyed, ["paths", "missing"])).toBeUndefined();
    // Not a key of its own, so not there; and a list is no mapping to enter.
    expect(getAt({}, ["constructor"])).toBeUndefined();
    expect(getAt({}, ["__proto__"])).toBeUndefined();
    expect(getAt(keyed, ["list", "0"])).toBeUndefined();
    expect(getAt(null, ["a"])).toBeUndefined();
  });

  it("sets and removes a node without touching the rest, copying only the way to it", () => {
    const changed = setAt(base, ["projects", "booking", "coordination", "policy"], "coordinate");
    expect(getAt(changed, ["projects", "booking", "coordination", "policy"])).toBe("coordinate");
    expect(getAt(base, ["projects", "booking", "coordination", "policy"])).toBe("notify");
    expect(changed.projects.camp).toBe(base.projects.camp);
    expect(changed.projects.booking.members).toBe(base.projects.booking.members);
    expect(Object.keys(changed.projects.booking)).toEqual(Object.keys(base.projects.booking));
    const without = setAt(
      base,
      ["projects", "booking", "coordination", "paths", "docs/**"],
      undefined,
    );
    expect(getAt(without, ["projects", "booking", "coordination", "paths"])).toEqual({});
    expect(Object.keys(setAt(base, ["projects", "camp"], undefined).projects)).toEqual(["booking"]);
    expect(setAt(undefined, ["a", "b"], 1)).toEqual({ a: { b: 1 } });
    expect(setAt(base, [], "whole")).toBe("whole");
  });

  it("keeps a key called __proto__ a key, and never a prototype", () => {
    const made = setAt({}, ["paths", "__proto__"], { polluted: true }) as { paths: object };
    expect(Object.keys(made.paths)).toEqual(["__proto__"]);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    expect((made.paths as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it("compares as JSON does: keys in any order, lists in order, nothing as null", () => {
    expect(jsonEqual({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(jsonEqual([1, 2], [2, 1])).toBe(false);
    expect(jsonEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(jsonEqual(undefined, null)).toBe(true);
    expect(jsonEqual({ a: undefined }, {})).toBe(true);
    expect(jsonEqual({ a: null }, {})).toBe(true);
    expect(jsonEqual("", undefined)).toBe(false);
    expect(jsonEqual(0, null)).toBe(false);
    expect(jsonEqual([], {})).toBe(false);
    expect(jsonEqual({ toString: 1 }, {})).toBe(false);
  });

  it("turns a draft into the sets of what changed at the paths a page edits", () => {
    const draft = setAt(
      setAt(
        setAt(base, ["projects", "booking", "coordination", "policy"], "coordinate"),
        ["projects", "booking", "coordination", "paths", "migrations/**"],
        "exclusive",
      ),
      ["projects", "booking", "leads"],
      ["ana@acme.dev", "eva@acme.dev"],
    );
    const paths = [
      ["projects", "booking", "coordination", "policy"],
      ["projects", "booking", "coordination", "paths"],
      ["projects", "booking", "leads"],
      ["projects", "booking", "members"],
      ["currency"],
    ];
    expect(setsFor(base, draft, paths)).toEqual([
      { path: ["projects", "booking", "coordination", "policy"], value: "coordinate" },
      {
        path: ["projects", "booking", "coordination", "paths"],
        value: { "docs/**": "notify", "migrations/**": "exclusive" },
      },
      { path: ["projects", "booking", "leads"], value: ["ana@acme.dev", "eva@acme.dev"] },
    ]);
    expect(setsFor(base, base, paths)).toEqual([]);
    expect(setsFor(base, structuredCloneOf(base), paths)).toEqual([]);
  });

  it("sends null for what the draft no longer has, and the whole value of what it adds", () => {
    const removed = setAt(base, ["projects", "booking", "coordination"], undefined);
    expect(setsFor(base, removed, [["projects", "booking", "coordination"]])).toEqual([
      { path: ["projects", "booking", "coordination"], value: null },
    ]);
    const added = setAt(base, ["projects", "city"], { name: "City-bot", leads: ["bob@acme.dev"] });
    expect(setsFor(base, added, [["projects", "city"]])).toEqual([
      { path: ["projects", "city"], value: { name: "City-bot", leads: ["bob@acme.dev"] } },
    ]);
    expect(
      setsFor(base, setAt(base, ["projects", "camp"], undefined), [["projects", "camp"]]),
    ).toEqual([{ path: ["projects", "camp"], value: null }]);
  });

  it("leaves a path to its ancestor when both are named, and a path named twice to once", () => {
    const draft = setAt(base, ["projects", "booking", "coordination", "policy"], "ask");
    const policy = ["projects", "booking", "coordination", "policy"];
    const coordination = ["projects", "booking", "coordination"];
    for (const paths of [
      [policy, coordination],
      [coordination, policy],
      [coordination, coordination],
    ]) {
      expect(setsFor(base, draft, paths)).toEqual([
        { path: coordination, value: { policy: "ask", paths: { "docs/**": "notify" } } },
      ]);
    }
    expect(setsFor(base, draft, [policy, policy])).toEqual([{ path: policy, value: "ask" }]);
  });
});

const structuredCloneOf = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe("where a value comes from", () => {
  const projects = {
    booking: { coordination: { policy: "coordinate" } },
    hub: { coordination: { policy: "notify" } },
    camp: {},
    city: { coordination: {} },
  };

  it("takes the project's policy where it sets one, else the computer's, and keeps what it beat", () => {
    const policies = policiesOf(projects);
    expect(policies).toEqual({
      booking: "coordinate",
      hub: "notify",
      camp: undefined,
      city: undefined,
    });
    expect(effectivePolicy(policies, "booking", "ask")).toEqual({
      value: "coordinate",
      source: "project",
      overridden: { value: "ask" },
    });
    expect(effectivePolicy(policies, "hub", "ask")).toEqual({
      value: "notify",
      source: "project",
      overridden: { value: "ask" },
    });
    expect(effectivePolicy(policies, "camp", "ask")).toEqual({ value: "ask", source: "computer" });
    expect(effectivePolicy(policies, "city", "ask")).toEqual({ value: "ask", source: "computer" });
    // A project that says the same as the computer still decides; nothing is struck through.
    expect(effectivePolicy(policies, "booking", "coordinate")).toEqual({
      value: "coordinate",
      source: "project",
    });
    expect(effectivePolicy(policies, "unknown", "notify")).toEqual({
      value: "notify",
      source: "computer",
    });
    expect(effectivePolicy({ constructor: undefined }, "constructor", "ask").source).toBe(
      "computer",
    );
  });

  it("says a decision in the words of the design", () => {
    expect(
      decisionText({ policy: "coordinate", source: "project", pattern: "payments/**" }, "Booking"),
    ).toBe("coordinate · payments/** in Booking");
    expect(decisionText({ policy: "coordinate", source: "project" }, "Booking")).toBe(
      "coordinate · Booking's policy",
    );
    expect(decisionText({ policy: "ask", source: "client" }, "Camp-bot")).toBe(
      "ask · your computer, Camp-bot has no policy",
    );
    expect(
      decisionText({ policy: "coordinate", source: "project", pathRulesOff: true }, "Booking"),
    ).toBe("coordinate · Booking's policy · path rules were off");
    expect(decisionText({ policy: "notify", source: "project", pattern: "docs/**" })).toBe(
      "notify · docs/** in the project",
    );
    expect(decisionText({ policy: "ask", source: "client" })).toBe(
      "ask · your computer, the project has no policy",
    );
    expect(decisionText(undefined)).toBeNull();
    expect(decisionText(null, "Booking")).toBeNull();
  });

  it("keeps a computer's default apart from the project's, and says whose it was", () => {
    // A `client` decision is the default of the computer that asked, which may not be this one.
    expect(decisionText({ policy: "ask", source: "client" }, "Camp-bot", "another")).toBe(
      "ask · another computer's default, Camp-bot has no policy",
    );
    expect(decisionParts({ policy: "ask", source: "client" }, "Camp-bot", "yours")).toEqual({
      policy: "ask",
      from: "your computer, Camp-bot has no policy",
      pathRulesOff: false,
    });
    // The project decides for everyone: whose computer asked changes nothing.
    expect(
      decisionParts(
        { policy: "notify", source: "project", pattern: "docs/**" },
        "Booking",
        "another",
      ),
    ).toEqual({ policy: "notify", from: "docs/** in Booking", pathRulesOff: false });
    expect(
      decisionParts({ policy: "coordinate", source: "project", pathRulesOff: true }, "Booking")
        .pathRulesOff,
    ).toBe(true);
  });
});

describe("shared capacity and plans", () => {
  const booking = {
    name: "Booking",
    client: "Northwind Hotels",
    members: ["ana@acme.dev", "bob@acme.dev"],
    capacity: {
      personal: "commercial",
      shared: {
        pool: "default",
        budget: { amount: 150 },
        allocations: { "bob@acme.dev": 170 },
        defaultAllocation: 40,
      },
    },
  };

  it("gives a person their own cap, else the project's default", () => {
    expect(allocationOf(booking, "bob@acme.dev")).toEqual({ value: 170, source: "custom" });
    expect(allocationOf(booking, "ana@acme.dev")).toEqual({ value: 40, source: "project default" });
    expect(allocationOf({ capacity: { shared: { allocations: {} } } }, "ana@acme.dev")).toEqual({
      value: undefined,
      source: "project default",
    });
    expect(allocationOf({}, "ana@acme.dev")).toEqual({
      value: undefined,
      source: "project default",
    });
    expect(allocationOf({ capacity: { shared: { allocations: { x: 0 } } } }, "x")).toEqual({
      value: 0,
      source: "custom",
    });
    expect(allocationOf({ capacity: { shared: { allocations: {} } } }, "constructor").source).toBe(
      "project default",
    );
  });

  it("sorts plans the way the Hub counts them", () => {
    for (const plan of ["pro", "max", "plus", "Max"])
      expect(planClass(plan), plan).toBe("consumer");
    for (const plan of ["team", "business", "enterprise", "api", "Team"]) {
      expect(planClass(plan), plan).toBe("commercial");
    }
    for (const plan of ["other", "edu", ""]) expect(planClass(plan), plan).toBe("other");
    expect(planLabel("max")).toBe("Max");
    expect(planLabel("api")).toBe("API key");
    expect(harnessLabel("claude")).toBe("Claude Code");
    expect(harnessLabel("future")).toBe("future");
  });

  it("says where each plan may be used and why not, as the design's Me page does", () => {
    const plans = [
      { harness: "claude", plan: "max" },
      { harness: "codex", plan: "team" },
    ];
    const used = whereUsable(
      {
        booking,
        "peer-hub": { name: "Peer Hub", members: ["*"], capacity: { personal: "any" } },
        "camp-bot": {
          name: "Camp-bot",
          members: ["ana@acme.dev"],
          capacity: { personal: "none", shared: { pool: "default" } },
        },
      },
      plans,
    );
    expect(used.map((use) => [use.name, use.rule, use.ruleText, use.shared])).toEqual([
      ["Booking", "commercial", "Commercial plans only", true],
      ["Peer Hub", "any", "Any plan", false],
      ["Camp-bot", "none", "Shared capacity only", true],
    ]);
    expect(used[0]!.plans.map((plan) => [plan.plan, plan.usable])).toEqual([
      ["max", false],
      ["team", true],
    ]);
    expect(used[0]!.plans[0]!.reason).toBe(
      "Booking is client work for Northwind Hotels and allows commercial plans only. Max is a consumer plan.",
    );
    expect(used[0]!.plans[1]!.reason).toBeUndefined();
    expect(used[1]!.plans.every((plan) => plan.usable)).toBe(true);
    expect(used[2]!.plans.map((plan) => plan.reason)).toEqual([
      "Camp-bot runs on shared capacity only.",
      "Camp-bot runs on shared capacity only.",
    ]);
  });

  it("blocks a plan that is neither, where only commercial ones are allowed, and reads a missing rule as any", () => {
    const [use] = whereUsable({ x: { name: "X", capacity: { personal: "commercial" } } }, [
      { harness: "cursor", plan: "edu" },
    ]);
    expect(use!.plans[0]).toMatchObject({ class: "other", usable: false });
    expect(use!.plans[0]!.reason).toBe(
      "X allows commercial plans only. Edu is not a commercial plan.",
    );
    expect(whereUsable({ x: { name: "X" } }, [{ harness: "codex", plan: "pro" }])[0]).toMatchObject(
      {
        rule: "any",
        shared: false,
      },
    );
    expect(whereUsable({ x: { name: "X", capacity: { personal: "future" } } }, [])[0]!.rule).toBe(
      "any",
    );
  });

  it("lists only the projects a person is on, when asked for one", () => {
    const projects = {
      all: { name: "All", members: ["*"] },
      mine: { name: "Mine", members: ["Ana@acme.dev"] },
      theirs: { name: "Theirs", members: ["bob@acme.dev"] },
      unlisted: { name: "Unlisted" },
    };
    expect(whereUsable(projects, [], "ana@acme.dev").map((use) => use.project)).toEqual([
      "all",
      "mine",
      "unlisted",
    ]);
    expect(whereUsable(projects, []).map((use) => use.project)).toEqual([
      "all",
      "mine",
      "theirs",
      "unlisted",
    ]);
  });
});

describe("the document", () => {
  it("reads the parts the pages read, leaving out an entry that does not read", () => {
    const parts = readDocument({
      currency: "EUR",
      people: { "ana@acme.dev": { name: "Ana", personal: [{ harness: "codex", plan: "team" }] } },
      projects: {
        booking: {
          name: "Booking",
          members: ["*"],
          leads: [],
          repositories: [],
          tools: ["postgres"],
          capacity: { personal: "any" },
          future: { kept: true },
        },
        broken: { members: "everyone" },
      },
      tools: { postgres: { name: "Postgres", mcp: { command: "npx" } } },
      capacity: { default: { name: "Default", models: [] } },
      gateway: { url: "https://llm.acme.dev" },
    });
    expect(parts.currency).toBe("EUR");
    expect(Object.keys(parts.projects)).toEqual(["booking"]);
    expect(parts.projects.booking!.future).toEqual({ kept: true });
    expect(parts.people["ana@acme.dev"]!.personal?.[0]?.plan).toBe("team");
    expect(Object.keys(parts.tools)).toEqual(["postgres"]);
    expect(Object.keys(parts.pools)).toEqual(["default"]);
    expect(readDocument({})).toEqual({
      currency: undefined,
      people: {},
      projects: {},
      tools: {},
      pools: {},
    });
    expect(readDocument({ projects: ["no", "mapping"], tools: null }).projects).toEqual({});
  });
});
