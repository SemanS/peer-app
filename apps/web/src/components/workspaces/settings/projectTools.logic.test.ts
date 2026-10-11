import { setAt } from "@t3tools/client-runtime/peer-settings";
import type { PeerSettingsTool, PeerTool } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { countChanges, draftSets } from "./settingsDraft.logic";
import {
  addTool,
  approvalChip,
  catalogChoices,
  catalogDefinition,
  catalogDefinitions,
  commandChip,
  commandProbe,
  docsUrl,
  envNameProblem,
  manifestDefinition,
  removeEnvEntry,
  removeTool,
  secretChip,
  secretNamesOf,
  setEnvEntry,
  setToolEnv,
  toolChanges,
  toolEntries,
  toolNotes,
  toolRow,
  type ToolDefinition,
} from "./projectTools.logic";

const jira: PeerSettingsTool = {
  name: "Jira",
  description: "Issues and sprints for BKG",
  mcp: {
    transport: "stdio",
    command: "jira-mcp",
    args: ["--project", "${secret:JIRA_PROJECT_KEY}"],
    env: { JIRA_TOKEN: "${secret:JIRA_TOKEN}", JIRA_PROJECT: "ABC" },
  },
  requires: [
    { command: "jira-mcp", install: "npm i -g jira-mcp", docs: "https://jira.example/docs" },
  ],
};

const sentry: PeerSettingsTool = {
  name: "Sentry",
  description: "Errors and releases",
  mcp: {
    transport: "http",
    url: "https://mcp.sentry.example/mcp",
    headers: { Authorization: "Bearer ${secret:SENTRY_TOKEN}" },
  },
};

describe("the project's list", () => {
  it("reads a bare id and an id with the project's settings", () => {
    expect(
      toolEntries(["jira", { tool: "postgres", env: { DB: "staging", n: 1 } }, 7, { tool: 3 }]),
    ).toEqual([
      { id: "jira", env: {} },
      { id: "postgres", env: { DB: "staging" } },
    ]);
    expect(toolEntries(undefined)).toEqual([]);
  });

  it("adds a tool at the end, once", () => {
    expect(addTool(["jira"], "sentry")).toEqual(["jira", "sentry"]);
    expect(addTool([{ tool: "jira", env: { A: "1" } }], "jira")).toEqual([
      { tool: "jira", env: { A: "1" } },
    ]);
    expect(addTool(undefined, "jira")).toEqual(["jira"]);
  });

  it("removes a tool, whichever way it is written", () => {
    expect(
      removeTool(["jira", { tool: "postgres", env: { A: "1" } }, "sentry"], "postgres"),
    ).toEqual(["jira", "sentry"]);
    expect(removeTool(["jira"], "jira")).toEqual([]);
  });

  it("gives a tool settings by making it {tool, env}, and takes them back to the bare id", () => {
    expect(setToolEnv(["jira", "sentry"], "jira", { A: "1" })).toEqual([
      { tool: "jira", env: { A: "1" } },
      "sentry",
    ]);
    expect(setToolEnv([{ tool: "jira", env: { A: "1" } }, "sentry"], "jira", {})).toEqual([
      "jira",
      "sentry",
    ]);
  });

  it("keeps the element of a tool whose settings did not change", () => {
    const list = [{ tool: "jira", env: { A: "1", B: "2" } }, "sentry"];
    expect(setToolEnv(list, "jira", { B: "2", A: "1" })[0]).toBe(list[0]);
    expect(setToolEnv(list, "sentry", {})[1]).toBe("sentry");
  });

  it("tells what the draft adds, changes and removes by tool id", () => {
    const saved = toolEntries(["jira", { tool: "postgres", env: { DB: "staging" } }, "figma"]);
    const draft = toolEntries(["jira", { tool: "postgres", env: { DB: "prod" } }, "sentry"]);
    expect(toolChanges(saved, draft)).toEqual({
      added: ["sentry"],
      changed: ["postgres"],
      removed: ["figma"],
    });
    expect(toolChanges(saved, saved)).toEqual({ added: [], changed: [], removed: [] });
  });
});

describe("what saving says of approval", () => {
  it("says each person approves an added tool on their own computer, as the design words it", () => {
    expect(toolNotes({ added: ["Sentry"], changed: [], people: 5 })).toEqual([
      "Saving adds Sentry for 5 people. Each approves it on their own computer before their agents get it.",
    ]);
  });

  it("says they approve a changed tool again", () => {
    expect(toolNotes({ added: [], changed: ["Postgres staging"], people: 12 })).toEqual([
      "Saving changes Postgres staging for 12 people. Each approves it again on their own computer before their agents get it.",
    ]);
  });

  it("speaks of one person in the singular, a line for each tool", () => {
    expect(toolNotes({ added: ["Sentry", "Figma"], changed: [], people: 1 })).toEqual([
      "Saving adds Sentry for 1 person, who approves it on their own computer before their agents get it.",
      "Saving adds Figma for 1 person, who approves it on their own computer before their agents get it.",
    ]);
    expect(toolNotes({ added: [], changed: [], people: 3 })).toEqual([]);
  });
});

describe("a project's settings for a tool", () => {
  it.each([
    ["", "Give the setting a name."],
    ["1A", "Use letters, digits and underscores, and do not start with a digit."],
    ["A B", "Use letters, digits and underscores, and do not start with a digit."],
    ["A=B", "Use letters, digits and underscores, and do not start with a digit."],
    ["JIRA_PROJECT", "There is a setting with that name already."],
  ])("refuses %j", (name, problem) => {
    expect(envNameProblem(name, ["JIRA_PROJECT"])).toBe(problem);
  });

  it("takes a plain name", () => {
    expect(envNameProblem("_private", ["JIRA_PROJECT"])).toBeNull();
    expect(envNameProblem("Region2", [])).toBeNull();
  });

  it("changes a setting in its place, adds one at the end, and removes one", () => {
    const env = { A: "1", B: "2", C: "3" };
    expect(Object.entries(setEnvEntry(env, "B", "BB", "22"))).toEqual([
      ["A", "1"],
      ["BB", "22"],
      ["C", "3"],
    ]);
    expect(Object.entries(setEnvEntry(env, null, "D", "4")).at(-1)).toEqual(["D", "4"]);
    expect(Object.entries(removeEnvEntry(env, "B"))).toEqual([
      ["A", "1"],
      ["C", "3"],
    ]);
  });
});

describe("what a tool is", () => {
  it("reads a catalog tool that runs a command", () => {
    expect(catalogDefinition("jira", jira)).toMatchObject({
      id: "jira",
      name: "Jira",
      transport: "stdio",
      strings: ["jira-mcp", "--project", "${secret:JIRA_PROJECT_KEY}"],
      env: { JIRA_TOKEN: "${secret:JIRA_TOKEN}", JIRA_PROJECT: "ABC" },
    });
  });

  it("reads a remote catalog tool, and takes no environment for it", () => {
    expect(catalogDefinition("sentry", sentry)).toMatchObject({
      transport: "http",
      strings: ["https://mcp.sentry.example/mcp", "Bearer ${secret:SENTRY_TOKEN}"],
      env: {},
    });
  });

  it("takes a tool with no transport as stdio when it has a command, else http", () => {
    expect(catalogDefinition("a", { name: "A", mcp: { command: "a" } }).transport).toBe("stdio");
    expect(catalogDefinition("b", { name: "B", mcp: { url: "https://b.example" } }).transport).toBe(
      "http",
    );
  });

  it("reads a tool of the manifest, either way it runs", () => {
    const local: PeerTool = {
      id: "pg",
      name: "Postgres",
      mcp: { transport: "stdio", command: "pg", args: ["--ro"], env: { DB: "x" } },
      requires: [{ command: "psql" }],
    };
    const remote: PeerTool = {
      id: "sentry",
      name: "Sentry",
      mcp: { transport: "sse", url: "https://s.example", headers: { A: "b" } },
      requires: [],
    };
    expect(manifestDefinition(local)).toMatchObject({
      transport: "stdio",
      strings: ["pg", "--ro"],
      env: { DB: "x" },
      requires: [{ command: "psql" }],
    });
    expect(manifestDefinition(remote)).toMatchObject({
      transport: "sse",
      strings: ["https://s.example", "b"],
      env: {},
    });
  });

  it("finds the secrets a tool names wherever it may, sorted and once", () => {
    const definition = catalogDefinition("jira", jira);
    expect(secretNamesOf(definition)).toEqual(["JIRA_PROJECT_KEY", "JIRA_TOKEN"]);
    // A project's settings count too, and may name another.
    expect(secretNamesOf(definition, { EXTRA: "${secret:ZED} ${secret:JIRA_TOKEN}" })).toEqual([
      "JIRA_PROJECT_KEY",
      "JIRA_TOKEN",
      "ZED",
    ]);
    expect(secretNamesOf(catalogDefinition("sentry", sentry))).toEqual(["SENTRY_TOKEN"]);
  });

  it("does not count a remote tool's project settings, nor a secret named in lower case", () => {
    expect(secretNamesOf(catalogDefinition("sentry", sentry), { X: "${secret:OTHER}" })).toEqual([
      "SENTRY_TOKEN",
    ]);
    expect(
      secretNamesOf({
        ...catalogDefinition("a", { name: "A", mcp: { command: "a" } }),
        strings: ["${secret:lower}", "${secret:UPPER"],
      }),
    ).toEqual([]);
  });

  it("links a tool's documentation only where it is a web address", () => {
    expect(docsUrl([{ command: "a" }, { command: "b", docs: "https://b.example/docs" }])).toBe(
      "https://b.example/docs",
    );
    expect(
      docsUrl([
        { command: "a", docs: "javascript:alert(1)" },
        { command: "b", docs: "docs" },
      ]),
    ).toBe(undefined);
    expect(
      docsUrl([
        { command: "a", docs: "javascript:alert(1)" },
        { command: "b", docs: "http://b.example" },
      ]),
    ).toBe("http://b.example");
    expect(docsUrl([])).toBeUndefined();
  });

  it("offers the catalog's tools the project does not use, by name", () => {
    const catalog = catalogDefinitions({
      jira,
      sentry,
      figma: {
        name: "Figma",
        description: "Design files and comments",
        mcp: { transport: "http", url: "https://f.example" },
      },
      bare: { name: "Bare", mcp: { transport: "stdio", command: "bare" } },
    });
    expect(catalogChoices(catalog, ["jira"])).toEqual([
      { id: "bare", name: "Bare", detail: "stdio" },
      { id: "figma", name: "Figma", detail: "Design files and comments · http" },
      { id: "sentry", name: "Sentry", detail: "Errors and releases · http" },
    ]);
    expect(catalogChoices(catalog, ["jira", "sentry", "figma", "bare"])).toEqual([]);
  });
});

describe("what this computer says", () => {
  it("says a tool is approved, or needs approval, on this computer", () => {
    expect(approvalChip({ state: "on" })).toEqual({
      value: "approved",
      source: "on this computer",
      tone: "ok",
    });
    expect(approvalChip({ state: "review" })).toEqual({
      value: "needs approval",
      source: "on this computer",
      tone: "warn",
      action: "review",
    });
    expect(approvalChip({ state: "changed" })).toMatchObject({
      value: "needs approval again",
      tone: "warn",
      action: "review",
    });
    expect(approvalChip({ state: "off" })).toMatchObject({ value: "off", tone: "warn" });
  });

  it("calls a tool that waits on a secret approved, and says why an invalid one is", () => {
    expect(approvalChip({ state: "secret" })).toMatchObject({ value: "approved", tone: "ok" });
    expect(
      approvalChip({ state: "invalid", reason: "Tool id must be lowercase kebab-case." }),
    ).toEqual({
      value: "invalid",
      source: "Tool id must be lowercase kebab-case.",
      tone: "warn",
    });
  });

  it("says nothing of approval for a tool this computer has not seen", () => {
    expect(approvalChip(undefined)).toBeUndefined();
  });

  it("says a secret is set here, missing here, or that each computer sets its own", () => {
    expect(
      secretChip("JIRA_TOKEN", { name: "JIRA_TOKEN", source: "stored", environmentSet: false }),
    ).toEqual({
      value: "JIRA_TOKEN",
      source: "set on this computer",
      tone: "ok",
    });
    expect(
      secretChip("A", { name: "A", source: "environment", environmentSet: true }),
    ).toMatchObject({ source: "set on this computer", tone: "ok" });
    expect(
      secretChip("A", { name: "A", source: "environment", environmentSet: false }),
    ).toMatchObject({ source: "missing on this computer", tone: "warn", action: "secrets" });
    expect(secretChip("A", { name: "A", source: "missing", environmentSet: true })).toMatchObject({
      source: "missing on this computer",
      tone: "warn",
    });
    expect(secretChip("SENTRY_TOKEN", undefined)).toEqual({
      value: "SENTRY_TOKEN",
      source: "each computer sets its own",
      tone: "ok",
    });
  });

  it("says a command a tool needs is installed, missing, or not looked for", () => {
    expect(commandProbe("psql", ["psql"], [])).toBe("installed");
    expect(commandProbe("psql", ["psql"], ["psql"])).toBe("missing");
    expect(commandProbe("psql", undefined, [])).toBe("unknown");
    expect(commandProbe("psql", ["other"], [])).toBe("unknown");
    expect(commandChip("psql", "installed")).toEqual({
      value: "psql",
      source: "required, installed",
      tone: "ok",
    });
    expect(commandChip("psql", "missing")).toMatchObject({
      source: "required, not installed",
      tone: "warn",
    });
    expect(commandChip("psql", "unknown")).toMatchObject({ source: "required", tone: "ok" });
  });
});

describe("a tool's row", () => {
  const postgres: ToolDefinition = {
    id: "postgres",
    name: "Postgres staging",
    description: "Read-only SQL on the staging database",
    transport: "stdio",
    strings: ["pg-mcp"],
    env: {},
    requires: [{ command: "psql", install: "brew install libpq", docs: "https://pg.example/docs" }],
  };

  it("shows approval, secrets, then commands, with the docs link", () => {
    const row = toolRow({
      entry: { id: "jira", env: {} },
      definition: catalogDefinition("jira", jira),
      seen: ["jira-mcp"],
      trust: { state: "on" },
      secrets: [
        { name: "JIRA_TOKEN", source: "stored", environmentSet: false },
        { name: "JIRA_PROJECT_KEY", source: "missing", environmentSet: false },
      ],
      missing: [],
    });
    expect(row).toMatchObject({
      id: "jira",
      name: "Jira",
      description: "Issues and sprints for BKG",
      docs: "https://jira.example/docs",
      takesSettings: true,
      installHints: [],
    });
    expect(row.chips.map((chip) => `${chip.value} · ${chip.source}`)).toEqual([
      "approved · on this computer",
      "JIRA_PROJECT_KEY · missing on this computer",
      "JIRA_TOKEN · set on this computer",
      "jira-mcp · required, installed",
    ]);
  });

  it("tells how to install a command this computer lacks, and marks the tool as waiting", () => {
    const row = toolRow({
      entry: { id: "postgres", env: {} },
      definition: postgres,
      seen: ["psql"],
      trust: { state: "review" },
      secrets: [],
      missing: ["psql"],
    });
    expect(row.chips.map((chip) => `${chip.value} · ${chip.source}`)).toEqual([
      "needs approval · on this computer",
      "psql · required, not installed",
    ]);
    expect(row.installHints).toEqual(["Install psql: brew install libpq"]);
  });

  it("shows a tool the draft adds without approval, its secrets as each computer's own", () => {
    const row = toolRow({
      entry: { id: "sentry", env: {} },
      definition: catalogDefinition("sentry", sentry),
      seen: undefined,
      trust: undefined,
      secrets: [],
      missing: [],
    });
    expect(row.chips).toEqual([
      { value: "SENTRY_TOKEN", source: "each computer sets its own", tone: "ok" },
    ]);
    expect(row.takesSettings).toBe(false);
  });

  it("counts a secret the project's settings name", () => {
    const row = toolRow({
      entry: { id: "postgres", env: { URL: "${secret:PG_URL}" } },
      definition: postgres,
      seen: ["psql"],
      trust: { state: "on" },
      secrets: [{ name: "PG_URL", source: "stored", environmentSet: false }],
      missing: [],
    });
    expect(row.chips.map((chip) => chip.value)).toEqual(["approved", "PG_URL", "psql"]);
    expect(row.env).toEqual({ URL: "${secret:PG_URL}" });
  });

  it("shows a command a tool lists twice once", () => {
    const row = toolRow({
      entry: { id: "postgres", env: {} },
      definition: { ...postgres, requires: [{ command: "psql" }, { command: "psql" }] },
      seen: ["psql"],
      trust: undefined,
      secrets: [],
      missing: [],
    });
    expect(row.chips).toEqual([{ value: "psql", source: "required, installed", tone: "ok" }]);
  });

  it("names a tool nobody knows by its id", () => {
    expect(
      toolRow({
        entry: { id: "ghost", env: {} },
        definition: undefined,
        seen: undefined,
        trust: undefined,
        secrets: [],
        missing: [],
      }),
    ).toMatchObject({ id: "ghost", name: "ghost", chips: [], takesSettings: false });
  });
});

describe("what the draft saves", () => {
  const slice = ["projects", "booking"] as const;
  const path = ["projects", "booking", "tools"];
  const list = ["jira", { tool: "postgres", env: { DB: "staging" } }];
  const base = { projects: { booking: { name: "Booking", tools: list } } };
  const draftOf = (next: ReadonlyArray<unknown>) => setAt(base, path, next);

  it("saves an added tool as the list with its bare id last, one change", () => {
    const next = addTool(list, "sentry");
    expect(countChanges(base, draftOf(next), slice)).toBe(1);
    expect(draftSets(base, draftOf(next), slice)).toEqual([{ path, value: [...list, "sentry"] }]);
  });

  it("counts a removal and a change to a tool's settings as one change each", () => {
    expect(countChanges(base, draftOf(removeTool(list, "jira")), slice)).toBe(1);
    expect(countChanges(base, draftOf(setToolEnv(list, "postgres", { DB: "prod" })), slice)).toBe(
      1,
    );
    expect(countChanges(base, draftOf(setToolEnv(list, "jira", { A: "1" })), slice)).toBe(1);
  });

  it("has nothing to save once a tool's settings are put back, to the bare id it was", () => {
    const given = setToolEnv(list, "jira", { A: "1" });
    expect(countChanges(base, draftOf(setToolEnv(given, "jira", {})), slice)).toBe(0);
  });
});
