// @effect-diagnostics globalDate:off - it times how long a pure function takes.
import { describe, expect, it } from "@effect/vitest";

import {
  allocationOf,
  comparePatterns,
  decisionParts,
  decisionText,
  effectivePolicy,
  getAt,
  harnessLabel,
  jsonEqual,
  matchesPattern,
  pathRuleFor,
  planClass,
  planLabel,
  policiesOf,
  rankedPathRules,
  readDocument,
  repositoryPath,
  setAt,
  setsFor,
  validatePathPattern,
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

// Twin of the Hub's server/src/coord/rules/matching.rs and grammar.rs, and of the app's
// plugins/resources/pathRules.test.ts: change the tables together.
const VECTORS = [
  ["migrations/**", "migrations/0019_a.sql", true],
  ["migrations/**", "migrations/legacy/0001.sql", true],
  ["migrations/**", "src/migrations/x.sql", false],
  ["docs/*.md", "docs/a.md", true],
  ["docs/*.md", "docs/api/a.md", false],
  ["**/*.sql", "x.sql", true],
  ["**/*.sql", "db/x.sql", true],
  ["package.json", "package.json", true],
  ["package.json", "apps/web/package.json", false],
  ["src/*/index.ts", "src/a/index.ts", true],
  ["src/*/index.ts", "src/a/b/index.ts", false],
  ["migrations/**", "migrations", true],
  ["migrations/**", "migrations/", true],
  ["migrations/**", "migrationsx/a.sql", false],
  ["**", "a/b/c.ts", true],
  ["**", "README.md", true],
  ["a/**/b", "a/b", true],
  ["a/**/b", "a/x/y/b", true],
  ["a/**/b", "a/x/b/c", false],
  ["**/index.ts", "index.ts", true],
  ["**/index.ts", "a/index.tsx", false],
  ["*", "file.ts", true],
  ["*", "dir/file.ts", false],
  ["docs/*.md", "docs/.md", true],
  ["docs/*.md", "docs/a.mdx", false],
  ["*a*", "bab", true],
  ["*a*", "bbb", false],
  ["src/*.test.ts", "src/pay.test.ts", true],
  ["src/*.test.ts", "src/pay.ts", false],
  ["Migrations/**", "migrations/x.sql", false],
  ["with space/*.md", "with space/a b.md", true],
  ["čaj/*.md", "čaj/x.md", true],
] as const;
const BEST = [
  [["src/**", "src/payments/**"], "src/payments/pay.ts", "src/payments/**"],
  [["src/**", "src/payments/**"], "src/util.ts", "src/**"],
  [["**/*.sql", "migrations/**"], "migrations/x.sql", "migrations/**"],
  [["docs/**", "docs/*.md"], "docs/a.md", "docs/*.md"],
  [["**", "package.json"], "package.json", "package.json"],
  [["a/**", "a/*"], "a/b", "a/*"],
  [["*a*", "a*"], "ab", "a*"],
  [["a/*", "*/b"], "a/b", "*/b"],
] as const;

describe("which path rule decides", () => {
  it("matches the Hub's whole table of patterns and paths", () => {
    for (const [glob, path, expected] of VECTORS) {
      expect(validatePathPattern(glob), glob).toBeNull();
      expect(matchesPattern(glob, path), `${glob} against ${path}`).toBe(expected);
    }
  });

  it("picks the most specific pattern that matches, whatever the order they are listed in", () => {
    for (const [patterns, path, winner] of BEST) {
      const rules = patterns.map((pattern) => ({ pattern, policy: "notify" }));
      expect(pathRuleFor(path, rules)?.pattern, `${patterns} on ${path}`).toBe(winner);
      expect(pathRuleFor(path, rules.toReversed())?.pattern, "in any order").toBe(winner);
      expect(pathRuleFor(path, Object.fromEntries(patterns.map((p) => [p, "ask"])))?.pattern).toBe(
        winner,
      );
    }
    expect(pathRuleFor("src/a.ts", [{ pattern: "docs/**", policy: "ask" }])).toBeUndefined();
    expect(pathRuleFor("src/a.ts", [])).toBeUndefined();
  });

  it("ranks patterns by literal characters, then fewer **, then fewer *, then by name", () => {
    expect(comparePatterns("src/payments/**", "src/**")).toBeLessThan(0);
    expect(comparePatterns("a/*", "a/**")).toBeLessThan(0);
    expect(comparePatterns("a/b", "a/b")).toBe(0);
    expect(comparePatterns("abc", "abd")).toBeLessThan(0);
    expect(comparePatterns("a😀", "a￿")).toBeGreaterThan(0);
    expect(
      rankedPathRules({
        "**": "notify",
        "src/**": "ask",
        "src/payments/**": "exclusive",
        "src/payments/README.md": "ask",
      }).map((rule) => rule.pattern),
    ).toEqual(["src/payments/README.md", "src/payments/**", "src/**", "**"]);
  });

  it("decides the way the Hub plans a path, with its policy and a path as the Hub reads one", () => {
    const rules = {
      "migrations/**": "exclusive",
      "docs/**": "notify",
      "src/**": "notify",
      "src/payments/**": "exclusive",
      "src/payments/README.md": "ask",
    };
    expect(pathRuleFor("migrations/0019_a.sql", rules)).toEqual({
      pattern: "migrations/**",
      policy: "exclusive",
    });
    expect(pathRuleFor("migrations/", rules)?.pattern).toBe("migrations/**");
    expect(pathRuleFor("src/payments/pay.ts", rules)?.pattern).toBe("src/payments/**");
    expect(pathRuleFor("src/payments/README.md", rules)).toEqual({
      pattern: "src/payments/README.md",
      policy: "ask",
    });
    expect(pathRuleFor("./src//util.ts", rules)?.pattern).toBe("src/**");
    expect(pathRuleFor("docs\\guide.md", rules)?.pattern).toBe("docs/**");
    expect(pathRuleFor("web/form.tsx", rules)).toBeUndefined();
    // Not a path inside the repository, so no rule decides it.
    for (const outside of ["", "/etc/passwd", "../x", "a/../b", "c:/x", "a\tb"]) {
      expect(pathRuleFor(outside, rules), outside).toBeUndefined();
    }
    expect(repositoryPath("./web//form.tsx")).toBe("web/form.tsx");
    expect(repositoryPath("dir//sub/")).toBe("dir/sub/");
    expect(repositoryPath("./")).toBeUndefined();
  });

  it("does not let a pattern that is no pattern decide", () => {
    expect(pathRuleFor("src/a.ts", [{ pattern: "src/[ab].ts", policy: "ask" }])).toBeUndefined();
    expect(
      pathRuleFor("a.ts", [
        { pattern: "**b", policy: "ask" },
        { pattern: "*.ts", policy: "notify" },
      ]),
    ).toEqual({
      pattern: "*.ts",
      policy: "notify",
    });
  });

  it("accepts the Hub's patterns and names each class of mistake as it does", () => {
    for (const glob of [
      "migrations/**",
      "docs/**",
      "docs/*.md",
      "**/*.sql",
      "package.json",
      "src/*/index.ts",
      "src/payments/**",
      "src/**",
      "**",
      "a/**/b",
      "*",
      "*.lock",
      "with space/x.md",
      "unicode/čaj.md",
      "a".repeat(200),
    ]) {
      expect(validatePathPattern(glob), glob).toBeNull();
    }
    for (const [glob, named] of [
      ["", "not empty"],
      ["a".repeat(201), "at most 200 characters"],
      ["/etc/**", "no leading `/`"],
      ["docs/", "no trailing `/`"],
      ["docs\\*.md", "not `\\`"],
      ["c:/x", "no `:`"],
      ["a\tb", "control characters"],
      ["a\u0007", "control characters"],
      ["src/?.ts", "`?` is not supported"],
      ["src/[ab].ts", "`[` is not supported"],
      ["src/a].ts", "`]` is not supported"],
      ["src/{a,b}/**", "`{` is not supported"],
      ["src/a}.ts", "`}` is not supported"],
      ["!src/**", "`!` is not supported"],
      ["./src/**", "no `.` or `..` segment"],
      ["src/../x", "no `.` or `..` segment"],
      ["src/**.ts", "`**` is a whole segment"],
      ["**b", "`**` is a whole segment"],
      ["a/***", "`**` is a whole segment"],
      ["a//b", "no empty segment"],
    ] as const) {
      expect(validatePathPattern(glob), glob).toContain(named);
    }
  });

  it("stays cheap on a long path against many wildcards", () => {
    const started = Date.now();
    expect(matchesPattern(`${"**/".repeat(60)}c`, `${"a/".repeat(140)}b`)).toBe(false);
    expect(matchesPattern("*a".repeat(60), `${"a".repeat(250)}b`)).toBe(false);
    expect(Date.now() - started).toBeLessThan(1_000);
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
          knowledge: { kontext: true, company: true },
          capacity: { personal: "any" },
          future: { kept: true },
        },
        broken: { members: "everyone" },
      },
      tools: { postgres: { name: "Postgres", mcp: { command: "npx" } } },
      capacity: { default: { name: "Default", models: [] } },
      webhooks: { ops: { format: "teams", url: "${secret:OPS}", events: [], enabled: true } },
      gateway: { url: "https://llm.acme.dev" },
    });
    expect(parts.currency).toBe("EUR");
    expect(Object.keys(parts.projects)).toEqual(["booking"]);
    expect(parts.projects.booking!.future).toEqual({ kept: true });
    expect(parts.people["ana@acme.dev"]!.personal?.[0]?.plan).toBe("team");
    expect(Object.keys(parts.tools)).toEqual(["postgres"]);
    expect(Object.keys(parts.pools)).toEqual(["default"]);
    expect(parts.webhooks.ops!.url).toBe("${secret:OPS}");
    expect(readDocument({})).toEqual({
      currency: undefined,
      people: {},
      projects: {},
      tools: {},
      pools: {},
      webhooks: {},
    });
    expect(readDocument({ projects: ["no", "mapping"], tools: null }).projects).toEqual({});
  });
});
