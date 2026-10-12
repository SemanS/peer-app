import { setAt } from "@t3tools/client-runtime/peer-settings";
import type { PeerTool } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { countChanges, draftSets } from "./settingsDraft.logic";
import {
  argsEdit,
  checkNewTool,
  commandEdit,
  deleteToolOperation,
  deleteWords,
  descriptionEdit,
  docsEdit,
  docsLinkProblem,
  emptyCatalogPage,
  envVariableProblem,
  headerNameProblem,
  joinArgs,
  manifestCatalog,
  mcpOf,
  nameEdit,
  newToolEdit,
  newToolValue,
  pairsEdit,
  pauseNote,
  pausesTool,
  peopleUsing,
  readCatalog,
  readProjects,
  readToolValue,
  removeRequirementEdit,
  requirementCommandProblem,
  restoreTransport,
  secretNamesIn,
  secretsNote,
  setRequirementEdit,
  splitArgs,
  switchTransport,
  toolIdFromName,
  toolMeta,
  toolProblems,
  toolUrlProblem,
  transportEdit,
  urlEdit,
  usageEdit,
  withPair,
  withoutPair,
  type Edit,
  type ToolValue,
} from "./toolCatalog.logic";

const postgres = {
  name: "Postgres staging",
  description: "Read-only SQL on the staging database",
  mcp: {
    transport: "stdio",
    command: "npx",
    args: ["@acme/mcp-postgres", "--read-only"],
    env: { DATABASE_URL: "${secret:STAGING_DB_URL}", PGSSLMODE: "require" },
  },
  requires: [
    { command: "psql", install: "brew install libpq", docs: "https://wiki.acme.dev/mcp/postgres" },
  ],
};
const jira = {
  name: "Jira",
  mcp: {
    transport: "http",
    url: "https://mcp.acme.dev/jira",
    headers: { Authorization: "Bearer ${secret:JIRA_TOKEN}" },
  },
  requires: [],
};
const sentry = {
  name: "Sentry",
  mcp: { transport: "http", url: "https://mcp.sentry.example/mcp", headers: {} },
  requires: [],
};
const figma = {
  name: "Figma",
  mcp: { transport: "sse", url: "https://mcp.figma.example/sse", headers: {} },
  requires: [],
};

const document = {
  tools: { jira, "postgres-staging": postgres, sentry, figma },
  projects: {
    booking: {
      name: "Booking",
      members: ["ana@acme.dev", "bob@acme.dev"],
      leads: ["ana@acme.dev"],
      tools: ["jira", { tool: "postgres-staging", env: { A: "1" } }],
    },
    "peer-hub": { name: "Peer Hub", members: ["*"], leads: ["ana@acme.dev"], tools: ["jira"] },
    "camp-bot": {
      name: "Camp-bot",
      members: ["eva@acme.dev"],
      leads: ["eva@acme.dev"],
      tools: ["figma"],
    },
  },
};

/** What the draft sends once the edits are applied, as the editor's Save would. */
function sentFor(edits: ReadonlyArray<Edit>, base: Record<string, unknown> = document) {
  const next = edits.reduce((current, edit) => setAt(current, edit.path, edit.value), base);
  return { count: countChanges(base, next), sets: draftSets(base, next), next };
}

const tool = (patch: Partial<ToolValue> = {}): ToolValue => ({
  ...readToolValue(postgres),
  ...patch,
});

describe("the catalog", () => {
  it("lists the tools by name with the projects that use each", () => {
    expect(readCatalog(document).map((entry) => [entry.id, entry.name, entry.transport])).toEqual([
      ["figma", "Figma", "sse"],
      ["jira", "Jira", "http"],
      ["postgres-staging", "Postgres staging", "stdio"],
      ["sentry", "Sentry", "http"],
    ]);
    expect(readCatalog(document).find((entry) => entry.id === "jira")?.projects).toEqual([
      { id: "booking", name: "Booking" },
      { id: "peer-hub", name: "Peer Hub" },
    ]);
  });

  it("says where each is used, as the design does", () => {
    const meta = Object.fromEntries(
      readCatalog(document).map((entry) => [entry.id, toolMeta(entry)]),
    );
    expect(meta).toEqual({
      figma: "sse · Camp-bot",
      jira: "http · 2 projects",
      "postgres-staging": "stdio · Booking",
      sentry: "http · not in a project yet",
    });
  });

  it("calls a tool by its id when it has no name, and is empty without tools", () => {
    expect(readCatalog({ tools: { raw: {} } })[0]).toMatchObject({ id: "raw", name: "raw" });
    expect(readCatalog({})).toEqual([]);
  });

  it("reads the projects in the document's order, with their tools and their people", () => {
    expect(
      readProjects(document).map((project) => [project.id, project.tools, project.people]),
    ).toEqual([
      ["booking", ["jira", "postgres-staging"], ["ana@acme.dev", "bob@acme.dev", "ana@acme.dev"]],
      ["peer-hub", ["jira"], ["*", "ana@acme.dev"]],
      ["camp-bot", ["figma"], ["eva@acme.dev", "eva@acme.dev"]],
    ]);
    expect(readProjects(undefined)).toEqual([]);
  });

  it("takes the tools from the manifest where the settings cannot be read", () => {
    const manifestTool = (id: string, name: string): PeerTool => ({
      id,
      name,
      description: `${name} things`,
      mcp: { transport: "http", url: `https://${id}.example`, headers: {} },
      requires: [{ command: id }],
    });
    const catalog = manifestCatalog([
      { project: { id: "booking", name: "Booking", tools: [manifestTool("jira", "Jira")] } },
      {
        project: {
          id: "camp-bot",
          name: "Camp-bot",
          tools: [manifestTool("jira", "Jira"), manifestTool("figma", "Figma")],
        },
      },
    ]);
    expect(catalog.map((entry) => [entry.id, entry.projects.map((p) => p.name)])).toEqual([
      ["figma", ["Camp-bot"]],
      ["jira", ["Booking", "Camp-bot"]],
    ]);
    expect(readToolValue(catalog[1]?.raw)).toMatchObject({
      name: "Jira",
      description: "Jira things",
      transport: "http",
      url: "https://jira.example",
      requires: [{ command: "jira" }],
    });
  });
});

describe("an empty catalog", () => {
  it("names the workspace and explains how a tool gets from the catalog to an agent", () => {
    const page = emptyCatalogPage("Acme");
    expect(page.title).toBe("No tools in Acme’s catalog yet");
    expect(page.steps).toEqual(["Catalog", "Project", "Your computer"]);
    expect(page.body).toContain("turned on per project");
    expect(page.body).toContain("trusts it on their own computer");
    expect(page.add.label).toBe("Add the first tool");
  });
});

describe("a tool as the editor holds it", () => {
  it("reads a local tool", () => {
    expect(readToolValue(postgres)).toEqual({
      name: "Postgres staging",
      description: "Read-only SQL on the staging database",
      docs: "https://wiki.acme.dev/mcp/postgres",
      transport: "stdio",
      command: "npx",
      args: ["@acme/mcp-postgres", "--read-only"],
      url: "",
      pairs: [
        ["DATABASE_URL", "${secret:STAGING_DB_URL}"],
        ["PGSSLMODE", "require"],
      ],
      requires: [
        {
          command: "psql",
          install: "brew install libpq",
          docs: "https://wiki.acme.dev/mcp/postgres",
        },
      ],
    });
  });

  it("reads a remote tool, whose pairs are its headers", () => {
    expect(readToolValue(jira)).toMatchObject({
      transport: "http",
      url: "https://mcp.acme.dev/jira",
      command: "",
      pairs: [["Authorization", "Bearer ${secret:JIRA_TOKEN}"]],
    });
    expect(readToolValue(figma).transport).toBe("sse");
  });

  it("takes a command without a transport as local, as the Hub does, and anything else as remote", () => {
    expect(readToolValue({ name: "x", mcp: { command: "kontext", args: ["mcp"] } }).transport).toBe(
      "stdio",
    );
    expect(readToolValue({ name: "x", mcp: { url: "https://x" } }).transport).toBe("http");
    expect(readToolValue(undefined)).toMatchObject({ name: "", transport: "http", pairs: [] });
  });

  it("starts a new tool as a local one with nothing to fill in but a command", () => {
    expect(newToolValue("  Sentry  ")).toEqual({
      name: "Sentry",
      mcp: { transport: "stdio", command: "", args: [], env: {} },
      requires: [],
    });
    expect(newToolEdit("sentry", "Sentry")).toEqual({
      path: ["tools", "sentry"],
      value: newToolValue("Sentry"),
    });
    expect(readToolValue(newToolValue("Sentry"))).toMatchObject({
      transport: "stdio",
      command: "",
    });
  });
});

describe("a new tool", () => {
  const taken = new Set(["jira", "sentry"]);

  it("is a name and an id nobody has", () => {
    expect(checkNewTool({ name: " Postgres staging ", id: "postgres-staging", taken })).toEqual({
      ok: true,
      id: "postgres-staging",
      name: "Postgres staging",
    });
    expect(toolIdFromName("Postgres staging")).toBe("postgres-staging");
  });

  it("says nothing while the name is empty", () => {
    expect(checkNewTool({ name: " ", id: "", taken })).toEqual({ ok: false, problem: null });
  });

  it("asks for letters and digits when the name has none", () => {
    expect(checkNewTool({ name: "???", id: "", taken }).ok).toBe(false);
  });

  it.each(["Jira", "j ira", "-jira", "jira-", "ji--ra", "a".repeat(49)])(
    "refuses the id %j",
    (id) => {
      expect(checkNewTool({ name: "Jira", id, taken })).toEqual({
        ok: false,
        problem: "An ID is lowercase letters and digits joined by hyphens, like postgres-staging.",
      });
    },
  );

  it("refuses an id the catalog has", () => {
    expect(checkNewTool({ name: "Jira", id: "jira", taken })).toEqual({
      ok: false,
      problem: "A tool with the ID “jira” exists already. Pick another.",
    });
  });
});

describe("arguments", () => {
  it("are split on spaces", () => {
    expect(splitArgs("@acme/mcp-postgres --read-only")).toEqual({
      ok: true,
      args: ["@acme/mcp-postgres", "--read-only"],
    });
    expect(splitArgs("  a   b  ")).toEqual({ ok: true, args: ["a", "b"] });
    expect(splitArgs("")).toEqual({ ok: true, args: [] });
  });

  it("keep a quoted word together, with either quote", () => {
    expect(splitArgs("--name \"Acme Labs\" 'x y' plain")).toEqual({
      ok: true,
      args: ["--name", "Acme Labs", "x y", "plain"],
    });
    expect(splitArgs('a"b c"d')).toEqual({ ok: true, args: ["ab cd"] });
  });

  it("can be empty words, and can escape", () => {
    expect(splitArgs('"" a')).toEqual({ ok: true, args: ["", "a"] });
    expect(splitArgs('say\\ hi "quote \\" here" back\\\\slash')).toEqual({
      ok: true,
      args: ["say hi", 'quote " here', "back\\slash"],
    });
    expect(splitArgs("'a\\b'")).toEqual({ ok: true, args: ["a\\b"] });
  });

  it("leave a secret as it is written", () => {
    expect(splitArgs("--token ${secret:API_TOKEN}")).toEqual({
      ok: true,
      args: ["--token", "${secret:API_TOKEN}"],
    });
  });

  it("say a quote is left open", () => {
    expect(splitArgs('--name "Acme')).toEqual({ ok: false, problem: "A quote is not closed." });
    expect(splitArgs("'x")).toEqual({ ok: false, problem: "A quote is not closed." });
  });

  it("are shown quoted only where a word needs it", () => {
    expect(joinArgs(["@acme/mcp-postgres", "--read-only"])).toBe("@acme/mcp-postgres --read-only");
    expect(joinArgs(["--name", "Acme Labs", "", 'say "hi"', "back\\slash"])).toBe(
      '--name "Acme Labs" "" "say \\"hi\\"" "back\\\\slash"',
    );
    expect(joinArgs([])).toBe("");
  });

  it.each([
    [[]],
    [["a"]],
    [["--name", "Acme Labs"]],
    [["", " ", "'", '"', "\\", "a b", "c\td", "é ü", "${secret:X}", "x\ny"]],
  ])("read back as written: %j", (args) => {
    expect(splitArgs(joinArgs(args))).toEqual({ ok: true, args });
  });
});

describe("what is wrong with a definition", () => {
  it("has nothing wrong with the design's tools", () => {
    for (const raw of [postgres, jira, sentry, figma]) {
      expect(toolProblems(readToolValue(raw))).toEqual({});
    }
  });

  it("needs a name", () => {
    expect(toolProblems(tool({ name: "  " })).name).toBe("A tool needs a name.");
  });

  it("needs a command it can run, in one word", () => {
    expect(toolProblems(tool({ command: "" })).command).toBe(
      "Enter the command that starts it, like npx.",
    );
    expect(toolProblems(tool({ command: "npx -y" })).command).toBe(
      "The command is one word. Put the rest in the arguments.",
    );
    expect(toolProblems(tool({ command: "/Applications/My App/bin/x" })).command).toBeUndefined();
    expect(toolProblems(tool({ command: "./bin/jira-mcp" })).command).toBeUndefined();
  });

  it("needs an http(s) address for a remote tool", () => {
    const remote = readToolValue(jira);
    expect(toolProblems({ ...remote, url: "" }).url).toBe(
      "Enter the tool’s address, like https://mcp.acme.dev/jira.",
    );
    expect(toolProblems({ ...remote, url: "ftp://x" }).url).toBe(
      "An address starting with https:// or http://.",
    );
    expect(toolProblems({ ...remote, url: "mcp.acme.dev" }).url).not.toBeUndefined();
    expect(toolProblems({ ...remote, url: "http://localhost:3000/mcp" }).url).toBeUndefined();
    expect(toolUrlProblem("https://${secret:HOST}/x")).toBeNull();
  });

  it("does not ask a local tool for an address, nor a remote one for a command", () => {
    expect(toolProblems(tool({ url: "" })).url).toBeUndefined();
    expect(toolProblems({ ...readToolValue(jira), command: "" }).command).toBeUndefined();
  });

  it("takes a documentation link that is a web address, or none", () => {
    expect(docsLinkProblem("")).toBeNull();
    expect(docsLinkProblem("https://wiki.acme.dev/mcp")).toBeNull();
    expect(docsLinkProblem("wiki.acme.dev")).toBe("A web address starting with https://.");
    expect(toolProblems(tool({ docs: "nope" })).docs).toBe("A web address starting with https://.");
  });

  it("names secrets as every computer accepts them", () => {
    const named = (value: string) => toolProblems(tool({ pairs: [["TOKEN", value]] })).secret;
    expect(named("${secret:STAGING_DB_URL}")).toBeUndefined();
    expect(named("${secret:_X9}")).toBeUndefined();
    expect(named("${secret:lower}")).toBe(
      "Secret names are capital letters, digits and underscores, like STAGING_DB_URL.",
    );
    expect(named("${secret:../X}")).toContain("Secret names are");
    expect(named("${secret:X")).toBe("A secret is written ${secret:NAME}: close it with }.");
    expect(toolProblems(tool({ command: "${secret:bad}" })).secret).toContain("Secret names are");
    expect(toolProblems(tool({ args: ["--k", "${secret:bad}"] })).secret).toContain(
      "Secret names are",
    );
    expect(
      toolProblems({ ...readToolValue(jira), url: "https://x/${secret:bad}" }).secret,
    ).toContain("Secret names are");
  });

  it("takes only environment variables that are names, and headers that are", () => {
    expect(toolProblems(tool({ pairs: [["1BAD", "x"]] })).pairs).toBe(
      "Use letters, digits and underscores, and do not start with a digit.",
    );
    expect(toolProblems(tool({ pairs: [["", "x"]] })).pairs).toBe("Give the variable a name.");
    expect(toolProblems(readToolValueWith({ pairs: [["Bad Header", "x"]] })).pairs).toBe(
      "Use letters, digits and - _ . only.",
    );
    expect(envVariableProblem("PG_HOST", ["PGSSLMODE"])).toBeNull();
    expect(envVariableProblem("PG_HOST", ["PG_HOST"])).toBe(
      "There is a variable with that name already.",
    );
    expect(headerNameProblem("X-Api-Key", ["x-api-key"])).toBe(
      "There is a header with that name already.",
    );
    expect(headerNameProblem("X-Api-Key", [])).toBeNull();
  });

  it("wants the name of a command to look for, not a command line", () => {
    expect(requirementCommandProblem("psql")).toBeNull();
    expect(requirementCommandProblem("/usr/local/bin/psql")).toBeNull();
    expect(requirementCommandProblem("psql --version")).toBe(
      "Name only the command, like psql. Peer looks for it on the PATH and never runs it.",
    );
    expect(
      toolProblems(tool({ requires: [{ command: "psql --version", install: "", docs: "" }] }))
        .requires,
    ).toContain("Name only the command");
    expect(
      toolProblems(tool({ requires: [{ command: "", install: "brew install libpq", docs: "" }] }))
        .requires,
    ).toBe("Name the command this install line is for.");
  });

  function readToolValueWith(patch: Partial<ToolValue>): ToolValue {
    return { ...readToolValue(jira), ...patch };
  }
});

describe("secrets", () => {
  it("names the ones a definition uses, once, sorted, wherever it writes them", () => {
    expect(secretNamesIn(readToolValue(postgres))).toEqual(["STAGING_DB_URL"]);
    expect(
      secretNamesIn(
        tool({
          command: "run-${secret:B_KEY}",
          args: ["--k=${secret:A_KEY}", "${secret:B_KEY}"],
          pairs: [["X", "${secret:C_KEY} ${secret:lower}"]],
        }),
      ),
    ).toEqual(["A_KEY", "B_KEY", "C_KEY"]);
    expect(secretNamesIn(readToolValue(jira))).toEqual(["JIRA_TOKEN"]);
    expect(secretNamesIn(readToolValue(sentry))).toEqual([]);
  });

  it("says each person sets their own, in the design's words", () => {
    expect(secretsNote(["STAGING_DB_URL"])).toBe(
      "Secret values never go here. Each person sets STAGING_DB_URL on their own computer, in Tool trust.",
    );
    expect(secretsNote(["A", "B"])).toBe(
      "Secret values never go here. Each person sets A and B on their own computer, in Tool trust.",
    );
    expect(secretsNote([])).toBe(
      "Secret values never go here. Write ${secret:NAME} and each person sets NAME on their own computer, in Tool trust.",
    );
  });
});

describe("the writes", () => {
  it("change a field of the tool at its own path", () => {
    expect(nameEdit("jira", "Jira Cloud")).toEqual({
      path: ["tools", "jira", "name"],
      value: "Jira Cloud",
    });
    expect(descriptionEdit("jira", "  Issues ")).toEqual({
      path: ["tools", "jira", "description"],
      value: "Issues",
    });
    expect(descriptionEdit("jira", "  ")).toEqual({
      path: ["tools", "jira", "description"],
      value: undefined,
    });
    expect(commandEdit("postgres-staging", " bunx ")).toEqual({
      path: ["tools", "postgres-staging", "mcp", "command"],
      value: "bunx",
    });
    expect(argsEdit("postgres-staging", ["a"])).toEqual({
      path: ["tools", "postgres-staging", "mcp", "args"],
      value: ["a"],
    });
    expect(urlEdit("jira", " https://new ")).toEqual({
      path: ["tools", "jira", "mcp", "url"],
      value: "https://new",
    });
  });

  it("send what changed in one field as one change, which the Hub merges with the rest", () => {
    const sent = sentFor([commandEdit("postgres-staging", "bunx")]);
    expect(sent.count).toBe(1);
    expect(sent.sets).toEqual([
      { path: ["tools", "postgres-staging", "mcp", "command"], value: "bunx" },
    ]);
  });

  it("keep the environment as the mapping the Hub keeps, in order, a variable at a time", () => {
    const pairs = readToolValue(postgres).pairs;
    const added = withPair(pairs, null, "PGHOST", "db.staging");
    expect(added.map(([name]) => name)).toEqual(["DATABASE_URL", "PGSSLMODE", "PGHOST"]);
    const renamed = withPair(pairs, "PGSSLMODE", "PGSSL", "verify-full");
    expect(renamed).toEqual([
      ["DATABASE_URL", "${secret:STAGING_DB_URL}"],
      ["PGSSL", "verify-full"],
    ]);
    expect(withoutPair(pairs, "DATABASE_URL")).toEqual([["PGSSLMODE", "require"]]);
    expect(pairsEdit("postgres-staging", "stdio", added)).toEqual({
      path: ["tools", "postgres-staging", "mcp", "env"],
      value: {
        DATABASE_URL: "${secret:STAGING_DB_URL}",
        PGSSLMODE: "require",
        PGHOST: "db.staging",
      },
    });
    expect(pairsEdit("jira", "http", [["X-Key", "1"]]).path).toEqual([
      "tools",
      "jira",
      "mcp",
      "headers",
    ]);
    expect(pairsEdit("sentry", "sse", []).value).toEqual({});
  });

  describe("another way of reaching it", () => {
    it("makes a local tool of a remote one with a command to fill in, and the other way round", () => {
      expect(switchTransport(jira.mcp, "stdio")).toEqual({
        transport: "stdio",
        command: "",
        args: [],
        env: {},
      });
      expect(switchTransport(postgres.mcp, "http")).toEqual({
        transport: "http",
        url: "",
        headers: {},
      });
    });

    it("keeps the address and headers between http and sse", () => {
      expect(switchTransport(jira.mcp, "sse")).toEqual({
        transport: "sse",
        url: "https://mcp.acme.dev/jira",
        headers: { Authorization: "Bearer ${secret:JIRA_TOKEN}" },
      });
    });

    it("leaves a local tool that stays local as it is", () => {
      expect(switchTransport(postgres.mcp, "stdio")).toBe(postgres.mcp);
    });

    it("comes back to what was typed for a way of reaching the tool that was left", () => {
      expect(mcpOf(postgres)).toBe(postgres.mcp);
      expect(restoreTransport(postgres.mcp, "stdio")).toBe(postgres.mcp);
      expect(restoreTransport(jira.mcp, "sse")).toEqual({ ...jira.mcp, transport: "sse" });
      expect(restoreTransport(undefined, "stdio")).toEqual({});
    });

    it("is one write to the tool's `mcp` node", () => {
      expect(transportEdit("jira", jira, "stdio")).toEqual({
        path: ["tools", "jira", "mcp"],
        value: { transport: "stdio", command: "", args: [], env: {} },
      });
      const sent = sentFor([transportEdit("sentry", sentry, "sse")]);
      expect(sent.sets).toEqual([{ path: ["tools", "sentry", "mcp", "transport"], value: "sse" }]);
    });
  });

  describe("what a tool needs on the computer", () => {
    it("changes one command and how to install it, keeping the documentation link", () => {
      const edit = setRequirementEdit("postgres-staging", postgres, 0, {
        command: " pg_dump ",
        install: " brew install libpq ",
      });
      expect(edit).toEqual({
        path: ["tools", "postgres-staging", "requires"],
        value: [
          {
            command: "pg_dump",
            install: "brew install libpq",
            docs: "https://wiki.acme.dev/mcp/postgres",
          },
        ],
      });
    });

    it("drops the install line when it is emptied", () => {
      const edit = setRequirementEdit("postgres-staging", postgres, 0, {
        command: "psql",
        install: "",
      });
      expect(edit.value).toEqual([{ command: "psql", docs: "https://wiki.acme.dev/mcp/postgres" }]);
    });

    it("adds a command at the end, and takes one away", () => {
      const added = setRequirementEdit("postgres-staging", postgres, null, {
        command: "jq",
        install: "brew install jq",
      });
      expect(added.value).toEqual([
        ...postgres.requires,
        { command: "jq", install: "brew install jq" },
      ]);
      expect(removeRequirementEdit("postgres-staging", postgres, 0).value).toEqual([]);
    });

    it("keeps the link with the first command that has one", () => {
      const raw = {
        requires: [{ command: "a" }, { command: "b", docs: "https://b.example" }],
      };
      expect(docsEdit("x", raw, "https://new.example").value).toEqual([
        { command: "a" },
        { command: "b", docs: "https://new.example" },
      ]);
      expect(docsEdit("x", raw, "  ").value).toEqual([{ command: "a" }, { command: "b" }]);
      expect(docsEdit("x", { requires: [{ command: "a" }] }, "https://a.example").value).toEqual([
        { command: "a", docs: "https://a.example" },
      ]);
    });
  });
});

describe("which projects use a tool", () => {
  it("gives a project the tool at the end of its list, or takes it away", () => {
    expect(usageEdit(document, "camp-bot", "jira", true)).toEqual({
      path: ["projects", "camp-bot", "tools"],
      value: ["figma", "jira"],
    });
    expect(usageEdit(document, "booking", "postgres-staging", false)).toEqual({
      path: ["projects", "booking", "tools"],
      value: ["jira"],
    });
  });

  it("does not give a project a tool twice", () => {
    expect(usageEdit(document, "booking", "jira", true).value).toEqual([
      "jira",
      { tool: "postgres-staging", env: { A: "1" } },
    ]);
  });

  it("is one change to the project's tools, merged by tool id", () => {
    const sent = sentFor([usageEdit(document, "camp-bot", "jira", true)]);
    expect(sent.count).toBe(1);
    expect(sent.sets).toEqual([
      { path: ["projects", "camp-bot", "tools"], value: ["figma", "jira"] },
    ]);
  });
});

describe("deleting a tool", () => {
  it("removes it and takes it out of every project that uses it", () => {
    const operation = deleteToolOperation({
      workspace: "acme",
      base: 42,
      document,
      id: "jira",
    });
    expect(operation).toEqual({
      kind: "save",
      workspace: "acme",
      base: 42,
      set: [
        { path: ["tools", "jira"], value: null },
        {
          path: ["projects", "booking", "tools"],
          value: [{ tool: "postgres-staging", env: { A: "1" } }],
        },
        { path: ["projects", "peer-hub", "tools"], value: [] },
      ],
    });
  });

  it("only removes a tool no project uses", () => {
    expect(
      deleteToolOperation({ workspace: "acme", base: 1, document, id: "sentry" }),
    ).toMatchObject({ set: [{ path: ["tools", "sentry"], value: null }] });
  });

  it("says what it takes with it", () => {
    expect(deleteWords("Jira", ["Booking", "Peer Hub"])).toEqual([
      "Jira leaves the catalog, so no project can pick it again.",
      "It is taken out of Booking and Peer Hub: agents there stop getting it.",
    ]);
    expect(deleteWords("Sentry", [])[1]).toBe("No project uses it, so no one’s agents change.");
  });
});

describe("what saving a definition does to the people who approved it", () => {
  it("pauses it when it is reached another way, not when it is only described again", () => {
    const before = readToolValue(postgres);
    expect(pausesTool(before, before)).toBe(false);
    expect(pausesTool(before, { ...before, name: "PG", description: "x", docs: "https://y" })).toBe(
      false,
    );
    expect(pausesTool(before, { ...before, requires: [] })).toBe(false);
    expect(pausesTool(before, { ...before, command: "bunx" })).toBe(true);
    expect(pausesTool(before, { ...before, args: ["@acme/mcp-postgres"] })).toBe(true);
    expect(
      pausesTool(before, {
        ...before,
        pairs: [["PGSSLMODE", "disable"], ...before.pairs.slice(0, 1)],
      }),
    ).toBe(true);
    expect(pausesTool(before, { ...before, transport: "http", url: "https://x" })).toBe(true);
  });

  it("does not care in which order the environment is written", () => {
    const before = readToolValue(postgres);
    expect(pausesTool(before, { ...before, pairs: before.pairs.toReversed() })).toBe(false);
  });

  it("ignores what a local tool keeps of a remote one's, and the other way round", () => {
    const before = readToolValue(postgres);
    expect(pausesTool(before, { ...before, url: "https://anything" })).toBe(false);
    const remote = readToolValue(jira);
    expect(pausesTool(remote, { ...remote, command: "x", args: ["y"] })).toBe(false);
    expect(pausesTool(remote, { ...remote, url: "https://other" })).toBe(true);
  });

  it("counts the people on the projects that use it, everyone if one is for the whole workspace", () => {
    const projects = readProjects(document);
    const using = (id: string) => projects.filter((project) => project.tools.includes(id));
    expect(peopleUsing(using("postgres-staging"), 9)).toBe(2);
    expect(peopleUsing(using("figma"), 9)).toBe(1);
    expect(peopleUsing(using("jira"), 9)).toBe(9);
    expect(peopleUsing([], 9)).toBe(0);
    expect(
      peopleUsing([{ people: ["Ana@acme.dev", "ana@acme.dev"] }, { people: ["bob@acme.dev"] }], 9),
    ).toBe(2);
  });

  it("says who is paused, in the design's words", () => {
    expect(pauseNote({ tool: "Postgres staging", people: 5, projects: ["Booking"] })).toBe(
      "Saving pauses Postgres staging for the 5 people in Booking until each of them approves it again on their computer.",
    );
    expect(pauseNote({ tool: "Figma", people: 1, projects: ["Camp-bot"] })).toBe(
      "Saving pauses Figma for the 1 person in Camp-bot until they approve it again on their computer.",
    );
    expect(pauseNote({ tool: "Jira", people: 9, projects: ["Booking", "Peer Hub"] })).toContain(
      "in Booking and Peer Hub",
    );
  });

  it("says nothing when nobody has it", () => {
    expect(pauseNote({ tool: "Sentry", people: 0, projects: [] })).toBeNull();
  });
});
