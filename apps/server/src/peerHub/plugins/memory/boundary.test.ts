// @effect-diagnostics nodeBuiltinImport:off - Static architecture test scans source files.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { assert, it } from "@effect/vitest";

/** `apps/server/src`. */
const sourceRoot = NodePath.resolve(import.meta.dirname, "../../..");
const plugin = "peerHub/plugins/memory/";

/**
 * The plugin's non-test lines may not grow past this: its size when it was extracted, which is
 * memory's own files plus the wiring it took from the PeerHub facade. Lower it as memory shrinks.
 */
const CEILING = 3_430;

/** Names of memory that core and the broker must not hold (`SessionMemory`, what a session was told, is not memory). */
const memoryNames = /memoryMode|memoryNotice|BrokerMemory|MemorySession|PeerMemory/;

function typeScriptFiles(directory: string): ReadonlyArray<string> {
  return NodeFS.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = NodePath.join(directory, entry.name);
    if (entry.isDirectory()) return typeScriptFiles(path);
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  });
}

const sources = typeScriptFiles(sourceRoot).map((path) => ({
  path: NodePath.relative(sourceRoot, path).split(NodePath.sep).join("/"),
  source: NodeFS.readFileSync(path, "utf8"),
}));

/** Where a file's relative imports, static or dynamic, point, relative to `sourceRoot`. */
const importsOf = ({ path, source }: { readonly path: string; readonly source: string }) =>
  [...source.matchAll(/(?:from\s+|import\(\s*)["'](\.[^"']*)["']/g)].map((match) =>
    NodePath.posix.normalize(NodePath.posix.join(NodePath.posix.dirname(path), match[1]!)),
  );

it("is imported only by core's registry", () => {
  const importers = sources
    .filter(({ path }) => !path.startsWith(plugin))
    .filter((file) => importsOf(file).some((target) => target.startsWith(plugin)))
    .map(({ path }) => path);
  assert.deepEqual(importers, ["peerHub/core/registry.ts"]);
});

it("leaves no memory names in core or the broker", () => {
  const holders = sources
    .filter(({ path }) => path.startsWith("peerHub/core/") || path === "peerHub/coordination.ts")
    .filter(({ source }) => memoryNames.test(source))
    .map(({ path }) => path);
  assert.deepEqual(holders, []);
});

it("imports no other plugin", () => {
  const crossings = sources
    .filter(({ path }) => path.startsWith(plugin))
    .flatMap((file) =>
      importsOf(file)
        .filter((target) => target.startsWith("peerHub/plugins/") && !target.startsWith(plugin))
        .map((target) => `${file.path} → ${target}`),
    );
  assert.deepEqual(crossings, []);
});

it("stays within its line ceiling", () => {
  const lines = sources
    .filter(({ path }) => path.startsWith(plugin) && !path.endsWith(".test.ts"))
    .reduce((total, { source }) => total + source.split("\n").length - 1, 0);
  assert.isAtMost(lines, CEILING);
});
