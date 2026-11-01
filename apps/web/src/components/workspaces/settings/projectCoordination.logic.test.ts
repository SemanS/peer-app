import { validatePathPattern } from "@t3tools/client-runtime/peer-settings";
import { describe, expect, it } from "vite-plus/test";

import { draftSets, edit, type DraftState } from "./settingsDraft.logic";

import {
  MAX_RULES,
  POLICY_CHOICES,
  addRuleBlocker,
  canAddRule,
  checkPattern,
  choiceEdit,
  choiceOf,
  choiceReason,
  deciding,
  pathTest,
  readCoordination,
  removeRuleEdit,
  ruleCountSentence,
  rulesCountText,
  rulesOf,
  setRuleEdit,
  type ComputerCoordination,
  type CoordinationSettings,
  type Edit,
} from "./projectCoordination.logic";

/** Booking as the design draws it. */
const booking: CoordinationSettings = {
  policy: "coordinate",
  paths: { "docs/**": "notify", "migrations/**": "exclusive", "payments/**": "coordinate" },
};

describe("the policy", () => {
  it("lists each person decides first, then the four policies, with the design's words", () => {
    expect(POLICY_CHOICES.map((choice) => [choice.value, choice.title])).toEqual([
      ["computer", "Each person decides"],
      ["notify", "notify"],
      ["coordinate", "coordinate"],
      ["ask", "ask"],
      ["exclusive", "exclusive"],
    ]);
    expect(POLICY_CHOICES[0]?.description).toBe(
      "Every computer’s own default applies (Settings › This computer).",
    );
  });

  it("reads a project's coordination: its policy and its rules", () => {
    expect(
      readCoordination({
        policy: "coordinate",
        paths: { "migrations/**": "exclusive", "docs/**": 7, "payments/**": "coordinate" },
      }),
    ).toEqual({
      policy: "coordinate",
      paths: { "migrations/**": "exclusive", "payments/**": "coordinate" },
    });
  });

  it("reads no coordination as each person deciding, with no rules", () => {
    expect(readCoordination(undefined)).toEqual({ policy: undefined, paths: {} });
    expect(readCoordination({})).toEqual({ policy: undefined, paths: {} });
  });

  it.each<[string | undefined, string | null]>([
    [undefined, "computer"],
    ["notify", "notify"],
    ["exclusive", "exclusive"],
    ["whenever", null],
  ])("shows a project policy of %j as the choice %j", (policy, choice) => {
    expect(choiceOf(policy)).toBe(choice);
  });

  it("does not let each person decide while the project has path rules, and says why", () => {
    expect(choiceReason("computer", 0, "Booking")).toBeNull();
    expect(choiceReason("computer", 3, "Booking")).toBe(
      "Not while Booking has path rules: they are exceptions to its policy. Remove them first.",
    );
    expect(choiceReason("exclusive", 3, "Booking")).toBeNull();
  });

  it("sets a policy, and for each person decides takes the whole coordination away", () => {
    expect(choiceEdit("ask")).toEqual({ path: ["policy"], value: "ask" });
    expect(choiceEdit("computer")).toEqual({ path: [], value: undefined });
  });
});

describe("path rules", () => {
  it("lists them most specific first, which is also the order the design draws", () => {
    expect(rulesOf(booking.paths).map((rule) => rule.pattern)).toEqual([
      "migrations/**",
      "payments/**",
      "docs/**",
    ]);
    expect(rulesOf({ "src/**": "ask", "src/payments/**": "exclusive", "**": "notify" })).toEqual([
      { pattern: "src/payments/**", policy: "exclusive" },
      { pattern: "src/**", policy: "ask" },
      { pattern: "**", policy: "notify" },
    ]);
  });

  it("counts them against the limit of 50", () => {
    expect(rulesCountText(3)).toBe("3 of 50");
    expect(MAX_RULES).toBe(50);
  });

  it("adds and changes a rule by its pattern", () => {
    expect(setRuleEdit("infra/terraform/**", "exclusive")).toEqual({
      path: ["paths", "infra/terraform/**"],
      value: "exclusive",
    });
  });

  it("takes a rule away, and the last one takes the whole node so no empty one differs from what is saved", () => {
    expect(removeRuleEdit(booking.paths, "docs/**")).toEqual({
      path: ["paths", "docs/**"],
      value: undefined,
    });
    expect(removeRuleEdit({ "docs/**": "notify" }, "docs/**")).toEqual({
      path: ["paths"],
      value: undefined,
    });
  });

  it("does not take a rule before the project has a policy for it to be an exception to", () => {
    expect(addRuleBlocker({ policy: undefined, paths: {} }, "Booking")).toBe(
      "Pick a policy for Booking first: path rules are exceptions to it.",
    );
    expect(addRuleBlocker(booking, "Booking")).toBeNull();
  });

  it("does not take a rule beyond the limit, whatever is typed", () => {
    const full = Object.fromEntries(
      Array.from({ length: MAX_RULES }, (_, i) => [`dir${i}/**`, "notify"]),
    );
    expect(addRuleBlocker({ policy: "ask", paths: full }, "Booking")).toBe(
      "A project has at most 50 path rules.",
    );
    const { "dir0/**": _gone, ...oneFewer } = full;
    expect(addRuleBlocker({ policy: "ask", paths: oneFewer }, "Booking")).toBeNull();
  });

  it("says how many rules there are where only the count is known", () => {
    expect(ruleCountSentence(1, "Booking")).toBe("Booking has 1 path rule.");
    expect(ruleCountSentence(3, "Booking")).toBe("Booking has 3 path rules.");
  });
});

describe("the pattern being typed", () => {
  const existing = Object.keys(booking.paths);
  const check = (text: string, policy = "exclusive") => checkPattern(text, policy, existing);

  it("says nothing about an empty field, and cannot add it", () => {
    expect(check("")).toBeNull();
    expect(check("   ")).toBeNull();
    expect(canAddRule(check(""), "")).toBe(false);
    expect(canAddRule(check("  "), "  ")).toBe(false);
  });

  it.each(["infra/terraform/**", "*.md", "src/*/index.ts", "**/generated/**", "a b/c", "**"])(
    "accepts %j",
    (pattern) => {
      expect(check(pattern, "notify")).toBeNull();
      expect(canAddRule(check(pattern, "notify"), pattern)).toBe(true);
    },
  );

  it.each<[string, string]>([
    ["what?", "Use only * and **. These aren’t allowed: ? [ ] { } ! \\ :"],
    ["a[1]", "Use only * and **. These aren’t allowed: ? [ ] { } ! \\ :"],
    ["{a,b}/**", "Use only * and **. These aren’t allowed: ? [ ] { } ! \\ :"],
    ["!docs/**", "Use only * and **. These aren’t allowed: ? [ ] { } ! \\ :"],
    ["docs\\**", "Use only * and **. These aren’t allowed: ? [ ] { } ! \\ :"],
    ["c:/x", "Use only * and **. These aren’t allowed: ? [ ] { } ! \\ :"],
    ["/docs/**", "Leave out the leading and trailing /."],
    ["docs/", "Leave out the leading and trailing /."],
    ["a//b", "Leave out empty segments (//)."],
    ["./docs/**", "Leave out . and .. segments."],
    ["a/../b", "Leave out . and .. segments."],
    ["a**b/c", "Use ** as a whole segment, like a/**/b."],
    ["src/**x", "Use ** as a whole segment, like a/**/b."],
    ["a\u0007b", "Use no control characters."],
    ["a".repeat(201), "Use at most 200 characters."],
  ])("refuses %j and says how to fix it", (pattern, message) => {
    expect(check(pattern)).toEqual({ kind: "error", message });
    expect(canAddRule(check(pattern), pattern)).toBe(false);
  });

  it("takes 200 characters", () => {
    expect(check("a".repeat(200))).toBeNull();
  });

  it("refuses a pattern that already has a rule, rather than quietly changing its policy", () => {
    expect(check("docs/**")).toEqual({
      kind: "error",
      message: "docs/** already has a rule. Change its policy above.",
    });
    // Typed with spaces around it, it is the same pattern.
    expect(check("  docs/**  ")?.kind).toBe("error");
    // Patterns are case-sensitive, as the Hub matches them.
    expect(check("Docs/**")).toBeNull();
  });

  it("refuses a rule beyond the limit", () => {
    const full = Array.from({ length: MAX_RULES }, (_, i) => `dir${i}/**`);
    expect(checkPattern("other/**", "notify", full)).toEqual({
      kind: "error",
      message: "A project has at most 50 path rules.",
    });
    expect(checkPattern("other/**", "notify", full.slice(1))).toBeNull();
  });

  it("warns about ** as exclusive, which it still lets through", () => {
    const warning = check("**", "exclusive");
    expect(warning).toEqual({
      kind: "warning",
      message: "With exclusive, ** locks the whole repository for one session at a time.",
    });
    expect(canAddRule(warning, "**")).toBe(true);
    expect(check("**", "ask")).toBeNull();
    expect(check("src/**", "exclusive")).toBeNull();
  });

  // The page words the Hub's rules; it never accepts what the shared twin of the Hub's check refuses,
  // nor refuses what it accepts.
  it.each([
    "docs/**",
    "*",
    "**",
    "a/**/b",
    "src/a*b.ts",
    "a b",
    "é/ü/**",
    "a?",
    "a[",
    "a]",
    "a{",
    "a}",
    "a!",
    "a\\b",
    "a:b",
    "/a",
    "a/",
    "/",
    "a//b",
    ".",
    "..",
    "a/./b",
    "a/../b",
    "a**",
    "**a",
    "a/**b/c",
    "a/b**",
    "a\tb",
    "\u007f",
    "x".repeat(200),
    "x".repeat(201),
  ])("agrees with the Hub's check about %j", (pattern) => {
    expect(checkPattern(pattern, "notify", [])?.kind === "error").toBe(
      validatePathPattern(pattern) !== null,
    );
  });
});

describe("which rule decides", () => {
  const decide = (path: string, settings = booking, rulesApply = true) =>
    deciding({ path, settings, rulesApply });

  it("is the rule that matches the path, as the design shows it", () => {
    expect(decide("payments/webhooks.ts")).toEqual({
      kind: "rule",
      policy: "coordinate",
      pattern: "payments/**",
    });
    expect(decide("migrations/2026/001.sql")).toEqual({
      kind: "rule",
      policy: "exclusive",
      pattern: "migrations/**",
    });
  });

  it("is the project's policy for a path no rule matches", () => {
    expect(decide("src/index.ts")).toEqual({
      kind: "project",
      policy: "coordinate",
      rulesOff: false,
    });
  });

  it("is the most specific rule when several match", () => {
    const settings: CoordinationSettings = {
      policy: "notify",
      paths: {
        "src/**": "ask",
        "src/payments/**": "exclusive",
        "src/payments/legacy/*.ts": "notify",
      },
    };
    expect(decide("src/index.ts", settings)).toMatchObject({ pattern: "src/**", policy: "ask" });
    expect(decide("src/payments/a.ts", settings)).toMatchObject({
      pattern: "src/payments/**",
      policy: "exclusive",
    });
    expect(decide("src/payments/legacy/a.ts", settings)).toMatchObject({
      pattern: "src/payments/legacy/*.ts",
      policy: "notify",
    });
  });

  it("is each person's default where the project sets no policy", () => {
    expect(decide("payments/webhooks.ts", { policy: undefined, paths: {} })).toEqual({
      kind: "computer",
    });
  });

  it("is the project's policy, marked, where a rule matches but the Hub applies no path rules", () => {
    expect(decide("payments/webhooks.ts", booking, false)).toEqual({
      kind: "project",
      policy: "coordinate",
      rulesOff: true,
    });
    // Nothing is marked where no rule would have decided anyway.
    expect(decide("src/index.ts", booking, false)).toEqual({
      kind: "project",
      policy: "coordinate",
      rulesOff: false,
    });
  });

  it("keeps a policy this app does not know as it is", () => {
    expect(decide("src/index.ts", { policy: "whenever", paths: {} })).toEqual({
      kind: "project",
      policy: "whenever",
      rulesOff: false,
    });
  });

  it.each(["", "   ", "../outside", "a:b", "/etc/passwd"])("decides nothing for %j", (path) => {
    expect(decide(path)).toBeNull();
  });

  it("reads a path as the Hub does: trimmed, forward slashes, no leading ./", () => {
    expect(decide("  ./payments\\webhooks.ts ")).toMatchObject({ pattern: "payments/**" });
    // A claimed directory counts as the directory.
    expect(decide("payments/")).toMatchObject({ pattern: "payments/**" });
  });
});

describe("the path test", () => {
  const project = { id: "booking", name: "Booking" };
  const mine: ComputerCoordination = { enabled: true, policy: "notify" };
  const test = (
    path: string,
    settings: CoordinationSettings = booking,
    options: { rulesApply?: boolean; computer?: ComputerCoordination } = {},
  ) =>
    pathTest({
      path,
      settings,
      rulesApply: options.rulesApply ?? true,
      project,
      computer: options.computer ?? mine,
    });

  it("names this computer's mode, and where it is set, where each person decides", () => {
    expect(test("payments/webhooks.ts", { policy: undefined, paths: {} })).toEqual({
      via: "no path rule → the project lets each person decide",
      pattern: null,
      scope: "On this computer",
      mode: "notify",
      source: "Your default · set in This computer › Coordination & plugins",
      changeable: true,
      others:
        "Everyone else uses their computer’s default: notify, coordinate or ask. Peer cannot see their choice.",
      warn: false,
    });
  });

  it("follows the default this computer has, whichever it is", () => {
    const each = { policy: undefined, paths: {} };
    expect(test("src/a.ts", each, { computer: { enabled: true, policy: "ask" } })).toMatchObject({
      mode: "ask",
    });
  });

  it("does not claim a mode for a computer where agent coordination is off", () => {
    const off = test(
      "src/a.ts",
      { policy: undefined, paths: {} },
      { computer: { enabled: false, policy: "notify" } },
    );
    expect(off).toMatchObject({ scope: "On this computer", mode: "off", changeable: true });
    expect(off?.source).toBe(
      "Agent coordination is off on this computer · turn it on in This computer › Coordination & plugins",
    );
  });

  it("names the rule that decides, for everyone, as the design shows it", () => {
    expect(test("payments/webhooks.ts")).toEqual({
      via: "path rule",
      pattern: "payments/**",
      scope: "For everyone",
      mode: "coordinate",
      source: "The agent waits until it confirms the overlap or leaves a note. Set by the project.",
      changeable: false,
      others: null,
      warn: false,
    });
    expect(test("migrations/001.sql")).toMatchObject({
      pattern: "migrations/**",
      mode: "exclusive",
      source: "One agent at a time edits these files. Set by the project.",
    });
  });

  it("names the project's policy, for everyone, where no rule matches", () => {
    expect(test("src/index.ts")).toMatchObject({
      via: "no path rule → Booking’s policy",
      pattern: null,
      scope: "For everyone",
      mode: "coordinate",
      changeable: false,
      others: null,
      warn: false,
    });
    // This computer's own default does not count where the project has a policy.
    expect(
      test("src/index.ts", booking, { computer: { enabled: true, policy: "ask" } }),
    ).toMatchObject({ mode: "coordinate" });
  });

  it("marks the answer where a rule matches but the Hub applies no path rules", () => {
    expect(test("payments/webhooks.ts", booking, { rulesApply: false })).toMatchObject({
      via: "a path rule matches, but path rules are off on this Hub → Booking’s policy",
      mode: "coordinate",
      scope: "For everyone",
      warn: true,
    });
    expect(test("src/index.ts", booking, { rulesApply: false })?.warn).toBe(false);
  });

  it("says nothing of what a policy does that this app does not know", () => {
    expect(test("src/index.ts", { policy: "whenever", paths: {} })).toMatchObject({
      mode: "whenever",
      source: "Set by the project.",
    });
  });

  it.each(["", "   ", "../outside", "a:b", "/etc/passwd"])("tests nothing for %j", (path) => {
    expect(test(path)).toBeNull();
  });
});

describe("what a draft saves, for the edits the page makes", () => {
  const slice = ["projects", "booking", "coordination"];
  const at = (...below: string[]) => [...slice, ...below];
  const coordination = { policy: "coordinate", paths: booking.paths };

  /** Applies the edits to a draft of the document, as the page does one after the other. */
  const saves = (
    edits: ReadonlyArray<Edit>,
    project: unknown = { name: "Booking", coordination },
  ) => {
    const document = { projects: { booking: project } };
    const state = edits.reduce<DraftState | null>(
      (draft, change) =>
        edit(draft, "booking", { revision: 7, document }, slice, change.path, change.value),
      null,
    );
    return state === null
      ? []
      : draftSets(state.base, state.document, slice).sort((a, b) =>
          a.path.join("/").localeCompare(b.path.join("/")),
        );
  };

  it("sends a new policy as the policy", () => {
    expect(saves([choiceEdit("ask")])).toEqual([{ path: at("policy"), value: "ask" }]);
    expect(saves([choiceEdit("ask"), choiceEdit("coordinate")])).toEqual([]);
  });

  it("sends a policy for a project that had none as its whole coordination", () => {
    expect(saves([choiceEdit("notify")], { name: "Booking" })).toEqual([
      { path: slice, value: { policy: "notify" } },
    ]);
  });

  it("takes the coordination away for each person decides, which a project without any already is", () => {
    expect(
      saves([choiceEdit("computer")], { name: "Booking", coordination: { policy: "ask" } }),
    ).toEqual([{ path: slice, value: null }]);
    expect(saves([choiceEdit("computer")], { name: "Booking" })).toEqual([]);
  });

  it("sends a rule as that rule, so what others changed meanwhile merges", () => {
    expect(saves([setRuleEdit("infra/terraform/**", "exclusive")])).toEqual([
      { path: at("paths", "infra/terraform/**"), value: "exclusive" },
    ]);
    expect(saves([setRuleEdit("docs/**", "ask")])).toEqual([
      { path: at("paths", "docs/**"), value: "ask" },
    ]);
  });

  it("sends the first rule of a project as its whole paths", () => {
    expect(
      saves([setRuleEdit("docs/**", "notify")], {
        name: "Booking",
        coordination: { policy: "coordinate" },
      }),
    ).toEqual([{ path: at("paths"), value: { "docs/**": "notify" } }]);
  });

  it("sends nothing for a rule added and removed again, even the only one", () => {
    const bare = { name: "Booking", coordination: { policy: "coordinate" } };
    expect(
      saves(
        [setRuleEdit("docs/**", "notify"), removeRuleEdit({ "docs/**": "notify" }, "docs/**")],
        bare,
      ),
    ).toEqual([]);
    expect(
      saves([
        setRuleEdit("a/**", "ask"),
        removeRuleEdit({ "docs/**": "notify", "a/**": "ask" }, "a/**"),
      ]),
    ).toEqual([]);
  });

  it("takes a rule away, and the last one takes the whole paths", () => {
    expect(saves([removeRuleEdit(booking.paths, "docs/**")])).toEqual([
      { path: at("paths", "docs/**"), value: null },
    ]);
    const one = {
      name: "Booking",
      coordination: { policy: "coordinate", paths: { "docs/**": "notify" } },
    };
    expect(saves([removeRuleEdit({ "docs/**": "notify" }, "docs/**")], one)).toEqual([
      { path: at("paths"), value: null },
    ]);
  });
});
