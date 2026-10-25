// @effect-diagnostics nodeBuiltinImport:off - Probe shipped dependencies with native Node resolution outside the Vite runner.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeURL from "node:url";
import { expect, it } from "vite-plus/test";

const repoRoot = NodeURL.fileURLToPath(new URL("..", import.meta.url));

const dependencySetup = `
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const workspaceRequire = relative => createRequire(join(repoRoot, relative, "package.json"));
const mobileRequire = workspaceRequire("apps/mobile");
const expoRequire = createRequire(mobileRequire.resolve("expo/package.json"));
const cursorRequire = createRequire(workspaceRequire("packages/provider-cursor").resolve("@cursor/sdk"));
const consumers = {
  Expo: createRequire(expoRequire.resolve("@expo/cli/package.json")),
  Vercel: createRequire(workspaceRequire("apps/marketing").resolve("@vercel/config/v1")),
  Cursor: cursorRequire,
};

async function loadZod(consumerName, specifier, format) {
  const consumer = consumers[consumerName];
  const subpaths = new Map([
    ["zod", "."],
    ["zod/v3", "./v3"],
    ["zod/v4", "./v4"],
    ["zod/v4/mini", "./v4/mini"],
    ["zod/v4-mini", "./v4-mini"],
  ]);
  const subpath = subpaths.get(specifier);
  assert.ok(subpath, "Unexpected Zod export: " + specifier);
  if (format === "CommonJS") return consumer(specifier);
  assert.equal(format, "ES modules");
  const manifestPath = consumer.resolve("zod/package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  return import(pathToFileURL(join(dirname(manifestPath), manifest.exports[subpath].import)).href);
}
`;

function runDependencyProbe(source: string) {
  // A fresh home protects real provider state, and a child contains prototype-related probes.
  const scratch = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "peer-security-schema-"));
  try {
    const result = NodeChildProcess.spawnSync(
      NodeProcess.execPath,
      [
        "--no-global-search-paths",
        "--input-type=module",
        "-e",
        `const repoRoot = ${JSON.stringify(repoRoot)};
const scratch = ${JSON.stringify(scratch)};
${dependencySetup}
${source}`,
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
        timeout: 15_000,
        maxBuffer: 1024 * 1024,
        env: {
          HOME: scratch,
          USERPROFILE: scratch,
          PATH: "",
          SystemRoot: NodeProcess.env.SystemRoot ?? "",
        },
      },
    );
    expect(result.error, result.stderr).toBeUndefined();
    expect(result.status, result.stderr + result.stdout).toBe(0);
  } finally {
    NodeFS.rmSync(scratch, { recursive: true, force: true });
  }
}

it.each([
  ["Expo", "zod", "CommonJS"],
  ["Expo", "zod", "ES modules"],
  ["Vercel", "zod", "CommonJS"],
  ["Vercel", "zod", "ES modules"],
  ["Cursor", "zod", "CommonJS"],
  ["Cursor", "zod", "ES modules"],
  ["Cursor", "zod/v3", "CommonJS"],
  ["Cursor", "zod/v3", "ES modules"],
])(
  "%s's %s (%s) rejects oversized collections before validating their contents",
  (consumer, specifier, format) => {
    runDependencyProbe(`
    const z = await loadZod(${JSON.stringify(consumer)}, ${JSON.stringify(specifier)}, ${JSON.stringify(format)});
    let visited = 0;
    const invalidElement = z.string().refine(() => { visited++; return false; });
    const values = Array.from({ length: 2_000 }, (_, index) => String(index));
    const cases = [
      [z.array(invalidElement).max(1, "collection limit"), values],
      [z.array(invalidElement).length(1, "collection limit"), values],
      [z.set(invalidElement).max(1, "collection limit"), new Set(values)],
      [z.set(invalidElement).size(1, "collection limit"), new Set(values)],
    ];
    for (const [schema, input] of cases) {
      visited = 0;
      const result = schema.safeParse(input);
      assert.equal(result.success, false);
      assert.equal(visited, 0, "Rejected collection contents must not be visited");
      assert.equal(result.error.issues.length, 1);
      assert.equal(result.error.issues[0].code, "too_big");
      assert.equal(result.error.issues[0].message, "collection limit");
    }
    const invalidAsyncElement = z.string().refine(async () => { visited++; return false; });
    for (const [schema, input] of [
      [z.array(invalidAsyncElement).max(1), values],
      [z.array(invalidAsyncElement).length(1), values],
      [z.set(invalidAsyncElement).max(1), new Set(values)],
      [z.set(invalidAsyncElement).size(1), new Set(values)],
    ]) {
      visited = 0;
      const result = await schema.safeParseAsync(input);
      assert.equal(result.success, false);
      assert.equal(visited, 0, "Async rejected collection contents must not be visited");
      assert.equal(result.error.issues.length, 1);
    }
    const nested = z.object({ items: z.array(z.string()).max(1) }).safeParse({ items: ["a", "b"] });
    assert.deepEqual(nested.error.issues[0].path, ["items"]);
    assert.deepEqual(z.array(z.string().transform(value => value.toUpperCase())).max(2).parse(["a", "b"]), ["A", "B"]);
    assert.deepEqual([...z.set(z.string().transform(value => value.toUpperCase())).max(2).parse(new Set(["a", "b"]))], ["A", "B"]);
    assert.deepEqual([...z.map(z.string(), z.number()).parse(new Map([["a", 1]]))], [["a", 1]]);
    assert.equal(z.map(z.string(), z.number()).safeParse(new Map([["a", "invalid"]])).success, false);
    assert.deepEqual(z.record(z.string(), z.number()).parse({ a: 1 }), { a: 1 });
    assert.equal(z.record(z.string(), z.number()).safeParse({ a: "invalid" }).success, false);
  `);
  },
);

it.each([
  ["zod/v4", "CommonJS"],
  ["zod/v4", "ES modules"],
  ["zod/v4/mini", "CommonJS"],
  ["zod/v4/mini", "ES modules"],
  ["zod/v4-mini", "CommonJS"],
  ["zod/v4-mini", "ES modules"],
])(
  "Expo's bundled %s (%s) bounds arrays, sets and maps before parsing their contents",
  (specifier, format) => {
    runDependencyProbe(`
    const z = await loadZod("Expo", ${JSON.stringify(specifier)}, ${JSON.stringify(format)});
    let visited = 0;
    let refined = 0;
    const invalidElement = z.string().check(z.refine(() => { visited++; return false; }));
    const values = Array.from({ length: 2_000 }, (_, index) => String(index));
    const cases = [
      [z.array(invalidElement).check(z.maxLength(1)), values],
      [z.array(invalidElement).check(z.length(1)), values],
      [z.set(invalidElement).check(z.maxSize(1)), new Set(values)],
      [z.set(invalidElement).check(z.size(1)), new Set(values)],
      [z.map(invalidElement, invalidElement).check(z.maxSize(1)), new Map(values.map(value => [value, "invalid"]))],
      [z.map(invalidElement, invalidElement).check(z.size(1)), new Map(values.map(value => [value, "invalid"]))],
    ];
    for (const [schema, input] of cases) {
      visited = 0;
      refined = 0;
      const result = schema.check(z.refine(() => { refined++; return true; })).safeParse(input);
      assert.equal(result.success, false);
      assert.equal(visited, 0, "Rejected collection contents must not be visited");
      assert.equal(refined, 0, "Later refinements must not receive rejected raw input");
      assert.equal(result.error.issues.length, 1);
      assert.equal(result.error.issues[0].code, "too_big");
    }
    const invalidAsyncElement = z.string().check(z.refine(async () => { visited++; return false; }));
    for (const [schema, input] of [
      [z.array(invalidAsyncElement).check(z.maxLength(1)), values],
      [z.set(invalidAsyncElement).check(z.maxSize(1)), new Set(values)],
      [z.map(invalidAsyncElement, invalidAsyncElement).check(z.maxSize(1)), new Map(values.map(value => [value, "invalid"]))],
    ]) {
      visited = 0;
      const result = await schema.safeParseAsync(input);
      assert.equal(result.success, false);
      assert.equal(visited, 0, "Async rejected collection contents must not be visited");
      assert.equal(result.error.issues.length, 1);
    }
    const nested = z.object({ items: z.array(z.string()).check(z.maxLength(1, { error: "collection limit" })) }).safeParse({ items: ["a", "b"] });
    assert.deepEqual(nested.error.issues[0].path, ["items"]);
    assert.equal(nested.error.issues[0].message, "collection limit");
    const uppercase = z.string().check(z.overwrite(value => value.toUpperCase()));
    assert.deepEqual(z.array(uppercase).check(z.maxLength(2)).parse(["a", "b"]), ["A", "B"]);
    assert.deepEqual([...z.set(uppercase).check(z.maxSize(2)).parse(new Set(["a", "b"]))], ["A", "B"]);
    assert.deepEqual([...z.map(z.string(), uppercase).check(z.maxSize(1)).parse(new Map([["a", "b"]]))], [["a", "B"]]);
    assert.deepEqual(z.array(z.number()).check(z.overwrite(values => values.slice(0, 1)), z.maxLength(1)).parse([1, 2]), [1]);
    assert.deepEqual([...z.set(z.number()).check(z.overwrite(values => new Set([...values].slice(0, 1))), z.maxSize(1)).parse(new Set([1, 2]))], [1]);
    assert.deepEqual([...z.map(z.string(), z.number()).check(z.overwrite(values => new Map([...values].slice(0, 1))), z.maxSize(1)).parse(new Map([["a", 1], ["b", 2]]))], [["a", 1]]);
    assert.equal(z.array(z.string()).check(z.maxLength(1)).safeParse("invalid").error.issues[0].code, "invalid_type");
    assert.equal(z.set(z.string()).check(z.maxSize(1)).safeParse([]).error.issues[0].code, "invalid_type");
    assert.equal(z.map(z.string(), z.number()).check(z.maxSize(1)).safeParse(new Set()).error.issues[0].code, "invalid_type");
    assert.deepEqual(z.record(z.string(), z.number()).parse({ count: 1 }), { count: 1 });
    assert.equal(z.record(z.string(), z.number()).safeParse({ count: "invalid" }).success, false);
  `);
  },
);

it("Cursor's bounded maps reject oversized input before validating keys or values", () => {
  runDependencyProbe(`
    const z = cursorRequire("zod");
    let visited = 0;
    const invalidElement = z.string().refine(() => { visited++; return false; });
    const input = new Map(Array.from({ length: 2_000 }, (_, index) => [String(index), "invalid"]));
    for (const schema of [z.map(invalidElement, invalidElement).max(1), z.map(invalidElement, invalidElement).size(1)]) {
      visited = 0;
      const result = schema.safeParse(input);
      assert.equal(result.success, false);
      assert.equal(visited, 0);
      assert.equal(result.error.issues.length, 1);
      assert.equal(result.error.issues[0].code, "too_big");
    }
    assert.deepEqual([...z.map(z.string(), z.number().transform(value => value + 1)).max(1).parse(new Map([["a", 1]]))], [["a", 2]]);
  `);
});

it("preserves the legacy schema behavior used by Expo plugins and Vercel configuration", () => {
  runDependencyProbe(`
    for (const consumer of [consumers.Expo, consumers.Vercel]) {
      const z = consumer("zod");
      assert.deepEqual(z.object({ nested: z.object({ name: z.string() }) }).deepPartial().parse({ nested: {} }), { nested: {} });
      assert.deepEqual(z.object({ name: z.string().default("default").optional() }).parse({}), {});
      assert.equal(z.string().transform(value => value.length).default("default").parse(undefined), 7);
    }
    const cliRequire = consumers.Expo;
    const { PluginSchema, DevToolsPluginOutputSchema } = cliRequire("./build/src/start/server/DevToolsPlugin.schema.js");
    const plugin = {
      packageName: "security-probe", packageRoot: scratch,
      cliExtensions: { description: "Probe", entryPoint: "index.js", commands: [
        { name: "probe", title: "Probe", environments: ["cli", "mcp"], parameters: [
          { name: "enabled", type: "confirm" }, { name: "count", type: "number" }, { name: "text", type: "text" },
        ] },
      ] },
    };
    assert.deepEqual(PluginSchema.parse(plugin), plugin);
    assert.equal(PluginSchema.safeParse({ ...plugin, packageName: "" }).success, false);
    const output = [{ type: "text", text: "ok", level: "info" }];
    assert.deepEqual(DevToolsPluginOutputSchema.parse(output), output);
    assert.equal(DevToolsPluginOutputSchema.safeParse([{ type: "audio", url: "invalid" }]).success, false);
    const { createMCPDevToolsExtensionSchema } = cliRequire("./build/src/start/server/createMCPDevToolsExtensionSchema.js");
    const tool = createMCPDevToolsExtensionSchema(plugin);
    const command = { command: "probe", enabled: true, count: 2, text: "ok" };
    assert.deepEqual(tool.parse(command), command);
    assert.equal(tool.safeParse({ command: "missing" }).success, false);
    assert.equal(tool.safeParse({ command: "probe", unexpected: true }).success, false);
    const vercelEntry = workspaceRequire("apps/marketing").resolve("@vercel/config/v1");
    const { parseCronExpression, createCronExpression } = consumers.Vercel(join(dirname(vercelEntry), "../utils/validation.js"));
    const cron = { minute: "*", hour: "0", dayOfMonth: "*", month: "*", dayOfWeek: "*" };
    assert.deepEqual(parseCronExpression("* 0 * * *"), cron);
    assert.equal(createCronExpression(cron), "* 0 * * *");
    assert.throws(() => parseCronExpression("* 99 * * *"));
  `);
});

it.each(["Mermaid", "mobile markdown"])(
  "%s's KaTeX rejects inherited trust while preserving math rendering",
  (consumer) => {
    runDependencyProbe(`
    const consumer = ${JSON.stringify(consumer)} === "Mermaid"
      ? createRequire(workspaceRequire("apps/web").resolve("mermaid"))
      : createRequire(mobileRequire.resolve("react-native-enriched-markdown"));
    const katex = consumer("katex");
    const untrusted = katex.renderToString("\\\\href{javascript:alert(1)}{click}", Object.create({ trust: true }));
    assert.doesNotMatch(untrusted, /<a\\b|<img\\b|<image\\b/i);
    const trusted = katex.renderToString("\\\\href{https://example.test}{link}", { trust: true });
    assert.equal(trusted.includes('href="https://example.test"'), true);
    for (const displayMode of [false, true]) {
      for (const output of ["mathml", "htmlAndMathml"]) {
        const markup = katex.renderToString("x^2+\\\\frac{1}{2}", { displayMode, output, throwOnError: true, trust: false });
        assert.match(markup, /<math\\b/);
        assert.match(markup, /<mfrac>/);
        assert.match(markup, /class="katex/);
      }
    }
  `);
  },
);

it("xcode generates project identifiers with its CommonJS UUID dependency and rejects short UUID output buffers", () => {
  runDependencyProbe(`
    const configPluginsRequire = createRequire(expoRequire.resolve("@expo/config-plugins/package.json"));
    const xcodeRequire = createRequire(configPluginsRequire.resolve("xcode"));
    const xcode = configPluginsRequire("xcode");
    const uuid = xcodeRequire("uuid");
    const projectFile = join(scratch, "project.pbxproj");
    writeFileSync(projectFile, "// !$*UTF8*$!\\n{ archiveVersion = 1; classes = {}; objectVersion = 56; objects = {}; rootObject = ABCDEF0123456789ABCDEF01; }\\n");
    const project = xcode.project(projectFile);
    project.parseSync();
    const identifiers = new Set();
    for (let index = 0; index < 100; index++) {
      const identifier = project.generateUuid();
      assert.match(identifier, /^[A-F0-9]{24}$/);
      identifiers.add(identifier);
    }
    assert.equal(identifiers.size, 100);
    const namespace = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
    for (const generate of [uuid.v3, uuid.v5]) {
      assert.throws(() => generate("peer", namespace, new Uint8Array(8), 4), RangeError);
      assert.throws(() => generate("peer", namespace, new Uint8Array(16), -1), RangeError);
      const buffer = new Uint8Array(16);
      generate("peer", namespace, buffer);
      assert.equal(uuid.validate(uuid.stringify(buffer)), true);
    }
    assert.throws(() => uuid.v6({}, new Uint8Array(8), 4), RangeError);
    assert.throws(() => uuid.v6({}, new Uint8Array(16), -1), RangeError);
  `);
});

it("loads Cursor's CommonJS API and SQLite adapter and validates conversation messages without credentials", () => {
  runDependencyProbe(`
    const providerRequire = workspaceRequire("packages/provider-cursor");
    const sdk = providerRequire("@cursor/sdk");
    const sqlite = providerRequire("@cursor/sdk/sqlite");
    for (const name of ["Agent", "AuthenticationError", "createAgentPlatform", "Cursor", "CursorSdkError", "InMemoryCredentialStore"]) {
      assert.equal(typeof sdk[name], "function", name);
    }
    assert.equal(typeof sqlite.SqliteLocalAgentStore, "function");
    const delta = { type: "text-delta", text: "hello" };
    assert.deepEqual(sdk.TextDeltaUpdateSchema.parse(delta), delta);
    assert.equal(sdk.TextDeltaUpdateSchema.safeParse({ ...delta, text: 42 }).success, false);
    for (const [schema, type] of [[sdk.AssistantMessageSchema, "assistant_message"], [sdk.UserMessageSchema, "user_message"]]) {
      const message = { type, session_id: "test-session", text: "hello" };
      assert.deepEqual(schema.parse(message), message);
      assert.equal(schema.safeParse({ ...message, session_id: 42 }).success, false);
    }
    for (const request of [() => sdk.Cursor.models.list({ apiKey: "" }), () => sdk.Cursor.me({ apiKey: "" })]) {
      await assert.rejects(request, error => {
        assert.equal(error.name, "ConfigurationError");
        assert.match(error.message, /empty apiKey explicitly/);
        return true;
      });
    }
  `);
});
