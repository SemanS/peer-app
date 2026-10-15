// @effect-diagnostics nodeBuiltinImport:off - a static architecture test reads the source files.
/**
 * The shape of Peer's server code (docs/internals/peer-plugins.md, "Tests and budgets"): each plugin
 * keeps to its folder, under its own id, with its tests beside it; it reaches core only through core's
 * API and a few shared helpers, and never another plugin; every command has one owner; and the code
 * stays within its line budgets.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import { PEER_PLUGIN_IDS } from "@t3tools/contracts";

import { peerPlugins, validatePlugins } from "./registry.ts";

/** `apps/server/src`, which import targets are relative to. */
const sourceRoot = NodePath.resolve(import.meta.dirname, "../..");

/** Every non-test file of core, and every file of a plugin's `client/`. */
const FILE_BUDGET = 800;
/** A plugin folder's non-test lines, its `client/` aside. */
const PLUGIN_BUDGET = 1_000;
/** `PeerHub.ts`, Peer's entry. */
const ENTRY_BUDGET = 150;
/**
 * Plugins over the budget until a named change lands, each held to its size then, all its non-test
 * lines counted. A ceiling only falls. Memory's is its size when it was extracted, which its own
 * `boundary.test.ts` holds too. Slack's is its size when `add-slack-agent-threads` landed: a two-way
 * bridge (its waits, text cleaning, publisher, delivery and settings) that no toggle could split.
 */
const CEILINGS: Readonly<Record<string, number>> = { memory: 3_430, slack: 1_367 };

/**
 * What a plugin's own code may import beside core's API: helpers that keep no state of their own.
 * Its tests may also drive core (its test kits, `PeerHub.ts`).
 */
const SHARED_HELPERS: ReadonlySet<string> = new Set([
  // Teammates' text fenced as data, and text cut to its bound.
  "peerHub/peerText.ts",
  // The git transports and refs Peer lets through.
  "peerHub/gitSafety.ts",
  // Stateless kontext machine protocol shared by the independent knowledge and memory clients.
  "peerHub/kontext.ts",
  // The presentation type of a knowledge entry.
  "peerHub/knowledgeEntry.ts",
  // A work's delivery and its pull requests.
  "peerHub/workLifecycle.ts",
  // What a failed clone means.
  "peerHub/cloneFailure.ts",
  // An agent's transcript.
  "peerHub/agentTranscript.ts",
  // The runtime capacity policy, at the path T3's adapters import it from.
  "peerHub/hubPolicy.ts",
  // This computer's commands: what is on PATH, and running it.
  "peerHub/core/local.ts",
]);

/** Core's API: the plugin definition and core's services. */
const isCoreApi = (path: string) =>
  path === "peerHub/core/plugin.ts" || /^peerHub\/core\/[^/]+\/Peer[A-Za-z]*\.ts$/.test(path);

interface Source {
  /** Relative to `apps/server/src`, with `/`. */
  readonly path: string;
  readonly text: string;
}

function sourcesUnder(directory: string): ReadonlyArray<Source> {
  return NodeFS.readdirSync(NodePath.join(sourceRoot, directory), { withFileTypes: true }).flatMap(
    (entry) => {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) return sourcesUnder(path);
      if (!entry.isFile() || !entry.name.endsWith(".ts")) return [];
      return [{ path, text: NodeFS.readFileSync(NodePath.join(sourceRoot, path), "utf8") }];
    },
  );
}

const isTest = ({ path }: Source) => path.endsWith(".test.ts");
const lineCount = ({ text }: Source) => text.split("\n").length - 1;
const linesOf = (sources: ReadonlyArray<Source>) =>
  sources.reduce((total, source) => total + lineCount(source), 0);

/** Where a file's relative imports and re-exports, static or dynamic, point. */
const importsOf = ({ path, text }: Source) =>
  [...text.matchAll(/(?:from\s+|import\(\s*)["'](\.[^"']*)["']/g)].map((match) =>
    NodePath.posix.normalize(NodePath.posix.join(NodePath.posix.dirname(path), match[1]!)),
  );

const pluginFolders = NodeFS.readdirSync(NodePath.join(sourceRoot, "peerHub/plugins"), {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .toSorted();
const plugins = pluginFolders.map((id) => ({ id, sources: sourcesUnder(`peerHub/plugins/${id}`) }));

/** The `peer` commands a plugin's code defines; each is written `name: "<name>",` then `usage:`. */
const commandsOf = (sources: ReadonlyArray<Source>) =>
  sources
    .filter((source) => !isTest(source))
    .flatMap(({ text }) => [...text.matchAll(/\bname:\s*"([^"]*)",\s*usage:/g)].map((m) => m[1]!));

describe("Peer's plugins", () => {
  it("are each listed once, in the contracts' order, under their folder's name", () => {
    const listed = peerPlugins().map((entry) => entry.id);
    assert.deepStrictEqual(validatePlugins(peerPlugins()), []);
    assert.deepStrictEqual(listed, [...PEER_PLUGIN_IDS]);
    assert.deepStrictEqual(listed.toSorted(), pluginFolders);
    for (const { id, sources } of plugins) {
      const index = sources.find((source) => source.path === `peerHub/plugins/${id}/index.ts`);
      assert.isDefined(index, `plugins/${id} has no index.ts`);
      assert.match(index?.text ?? "", new RegExp(`\\bid: "${id}",`), `plugins/${id}/index.ts`);
    }
  });

  it("give every command one owner, apart from core's", () => {
    const commands = plugins.map(({ id, sources }) => ({
      id,
      commands: commandsOf(sources).map((name) => ({ name })),
    }));
    // Core's commands count as taken.
    assert.deepStrictEqual(validatePlugins(commands), []);
    assert.isAbove(commands.flatMap((plugin) => plugin.commands).length, 0);
    // A plugin a build may exclude names its commands, so that build refuses them: all of them.
    for (const entry of peerPlugins()) {
      if (entry.commandNames === undefined) continue;
      const own = plugins.find((plugin) => plugin.id === entry.id)?.sources ?? [];
      assert.deepStrictEqual([...entry.commandNames].toSorted(), commandsOf(own).toSorted());
    }
  });

  it("have their tests beside them", () => {
    const untested = plugins
      .filter(({ id, sources }) =>
        sources.every(
          (source) =>
            !isTest(source) || NodePath.posix.dirname(source.path) !== `peerHub/plugins/${id}`,
        ),
      )
      .map(({ id }) => id);
    assert.deepStrictEqual(untested, []);
  });

  it("reach core only through its API and the shared helpers, and never another plugin", () => {
    const crossings = plugins.flatMap(({ id, sources }) =>
      sources.flatMap((source) =>
        importsOf(source)
          .filter((target) => {
            if (target.startsWith("peerHub/plugins/")) {
              return !target.startsWith(`peerHub/plugins/${id}/`);
            }
            // Tests drive core; T3's own modules are no part of this rule.
            if (isTest(source) || !target.startsWith("peerHub/")) return false;
            return !isCoreApi(target) && !SHARED_HELPERS.has(target);
          })
          .map((target) => `${source.path} → ${target}`),
      ),
    );
    assert.deepStrictEqual(crossings, []);
  });
});

describe("Peer's line budgets", () => {
  it(`hold every non-test file of core to ${FILE_BUDGET} lines`, () => {
    const over = sourcesUnder("peerHub/core")
      .filter((source) => !isTest(source) && lineCount(source) > FILE_BUDGET)
      .map((source) => `${source.path}: ${lineCount(source)}`);
    assert.deepStrictEqual(over, []);
  });

  it(`hold each plugin folder to ${PLUGIN_BUDGET} non-test lines, and each client file to ${FILE_BUDGET}`, () => {
    const over = plugins.flatMap(({ id, sources }) => {
      const code = sources.filter((source) => !isTest(source));
      const client = code.filter((source) =>
        source.path.startsWith(`peerHub/plugins/${id}/client/`),
      );
      const own = code.filter((source) => !client.includes(source));
      const ceiling = CEILINGS[id];
      return [
        ...(ceiling === undefined && linesOf(own) > PLUGIN_BUDGET
          ? [`${id}: ${linesOf(own)}`]
          : []),
        ...client
          .filter((source) => lineCount(source) > FILE_BUDGET)
          .map((source) => `${source.path}: ${lineCount(source)}`),
      ];
    });
    assert.deepStrictEqual(over, []);
  });

  it("hold memory, over the plugin budget, to its ceiling", () => {
    for (const [id, ceiling] of Object.entries(CEILINGS)) {
      const own = plugins.find((plugin) => plugin.id === id)?.sources ?? [];
      assert.isAbove(own.length, 0, `plugins/${id}`);
      assert.isAtMost(linesOf(own.filter((source) => !isTest(source))), ceiling, `plugins/${id}`);
    }
  });

  it(`hold PeerHub.ts, Peer's entry, to ${ENTRY_BUDGET} lines`, () => {
    const path = "peerHub/PeerHub.ts";
    const entry = { path, text: NodeFS.readFileSync(NodePath.join(sourceRoot, path), "utf8") };
    assert.isAtMost(lineCount(entry), ENTRY_BUDGET);
  });
});
