#!/usr/bin/env node
/**
 * Builds the `peer-core` npm package behind `npx peer-core` / `npm i -g peer-core`: Peer's server
 * CLI (`peer core serve|login|share|connect|hooks …`, and `peer <command>` forwarded to the broker)
 * for a computer without the Peer app. Unlike upstream's `t3` launcher it ships the bundle itself:
 * `apps/server/dist` (no source maps) with the packages the bundle leaves outside it as ordinary
 * npm dependencies, so npm installs their native builds for the platform. Node 24+ runs it.
 *
 *   node scripts/build-npm-peer.ts [--no-build] [--version x.y.z] [--name peer-core]
 *
 * Output: `release/npm/<name>/` (the package tree) and `release/npm/<name>-<version>.tgz`.
 * Publishing is a separate, deliberate step: `npm publish release/npm/<name>-<version>.tgz`.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { selectCliRuntimeExternalDependencies } from "./lib/cli-external-packages.ts";

const repoRoot = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");
const serverDir = NodePath.join(repoRoot, "apps/server");
const distDir = NodePath.join(serverDir, "dist");

const args = process.argv.slice(2);
const flag = (name: string) => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};
const build = !args.includes("--no-build");
const name = flag("--name") ?? "peer-core";

const run = (command: string, argv: ReadonlyArray<string>, cwd: string) => {
  const result = NodeChildProcess.spawnSync(command, [...argv], { cwd, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} ${argv.join(" ")} exited ${result.status}`);
};
const read = (command: string, argv: ReadonlyArray<string>, cwd: string) =>
  NodeChildProcess.execFileSync(command, [...argv], { cwd, encoding: "utf8" }).trim();

/** Peer's own version, as scripts/build-peer.sh of the hub counts it: 0.1.<commits on top of upstream>. */
function peerVersion(): string {
  const explicit = flag("--version");
  if (explicit !== undefined) return explicit;
  let base = "";
  for (const ref of ["upstream/main", "origin/main"]) {
    try {
      base = read("git", ["rev-parse", "--verify", "-q", ref], repoRoot);
      break;
    } catch {
      // try the next ref
    }
  }
  if (base === "") throw new Error("No upstream/main or origin/main to count Peer's commits from.");
  return `0.1.${read("git", ["rev-list", "--count", `${base}..HEAD`], repoRoot)}`;
}

/** Bare package specifiers the emitted bundle still imports (the packages it left external). */
function bundleImports(): Set<string> {
  const names = new Set<string>();
  // Statements only: an `import`/`export … from` at the start of a line, or a dynamic import or
  // require call that is not a JSDoc type reference (`import("hast").Root`) or a template string.
  const statement = /^(?:import|export)\b[^;'"]*?\bfrom\s*["']([^"'`$./][^"'`$\n]*)["']/gm;
  const call = /\b(?:import|require)\(\s*["']([^"'`$./][^"'`$\n]*)["']\s*\)(?!\.)/g;
  for (const file of NodeFS.readdirSync(distDir)) {
    if (!file.endsWith(".mjs")) continue;
    const source = NodeFS.readFileSync(NodePath.join(distDir, file), "utf8");
    for (const pattern of [statement, call]) {
      for (const match of source.matchAll(pattern)) {
        const spec = match[1]!;
        if (spec.startsWith("node:")) continue;
        const parts = spec.split("/");
        const pkg = spec.startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0]!;
        names.add(pkg);
      }
    }
  }
  return names;
}

const NODE_BUILTINS = new Set(NodeModule.builtinModules.map((m) => m.replace(/^node:/, "")));

/** The installed version of a package, from the server's own resolution. */
function installedVersion(pkg: string): string | null {
  const require = NodeModule.createRequire(NodePath.join(serverDir, "package.json"));
  try {
    const manifest = require(`${pkg}/package.json`) as { version: string };
    return manifest.version;
  } catch {
    // `exports` may hide package.json: find it on disk.
    for (const root of [
      NodePath.join(serverDir, "node_modules"),
      NodePath.join(repoRoot, "node_modules"),
    ]) {
      const file = NodePath.join(root, pkg, "package.json");
      if (NodeFS.existsSync(file)) {
        return (JSON.parse(NodeFS.readFileSync(file, "utf8")) as { version: string }).version;
      }
    }
    const pnpm = NodePath.join(repoRoot, "node_modules/.pnpm");
    const prefix = `${pkg.replace("/", "+")}@`;
    const hit = NodeFS.existsSync(pnpm)
      ? NodeFS.readdirSync(pnpm).find((dir) => dir.startsWith(prefix))
      : undefined;
    return hit === undefined ? null : hit.slice(prefix.length).split("_")[0]!;
  }
}

function dependencies(): Record<string, string> {
  const serverPkg = JSON.parse(
    NodeFS.readFileSync(NodePath.join(serverDir, "package.json"), "utf8"),
  ) as {
    dependencies: Record<string, string>;
  };
  const wanted = new Set<string>([
    ...Object.keys(selectCliRuntimeExternalDependencies(serverPkg.dependencies)),
    ...bundleImports(),
  ]);
  const result: Record<string, string> = {};
  const missing: Array<string> = [];
  for (const pkg of [...wanted].sort()) {
    if (NODE_BUILTINS.has(pkg)) continue;
    const version = installedVersion(pkg);
    if (version === null) missing.push(pkg);
    else result[pkg] = version;
  }
  // A package the bundle names but this checkout does not install is loaded only when present
  // (a provider's own SDK, say): the package leaves it to the computer, as the server does.
  if (missing.length > 0) console.warn(`not installed here, left optional: ${missing.join(", ")}`);
  return result;
}

const readme = (version: string) => `# ${name}

Peer's coordination for coding agents on a computer without the Peer app: the \`peer\` command.

\`\`\`sh
npm i -g ${name}        # or: npx ${name} core status
peer core login you@company.com   # a code is mailed by your Peer Hub
peer core share ~/code/project    # the folder needs a git remote
peer core connect cursor          # Cursor, VS Code, Windsurf, Gemini CLI, OpenCode, Zed, Copilot CLI, Kiro
peer core hooks install           # Claude Code (and Codex with --codex)
peer core serve --detach          # or let the editor start it on demand
\`\`\`

\`peer core status\` says who runs Peer here; \`peer core stop\` stops Peer Core. The Peer desktop app,
when it starts, takes coordination over. Any other \`peer <command>\` goes to the running Peer.

Version ${version} of Peer Local (https://github.com/SemanS/peer-app, branch \`peer\`), based on T3 Code.
`;

const version = peerVersion();
if (build) run("node", ["--run", "build:bundle"], serverDir);
if (!NodeFS.existsSync(NodePath.join(distDir, "bin.mjs")))
  throw new Error(`${distDir}/bin.mjs is missing.`);

const outDir = NodePath.join(repoRoot, "release/npm");
const stageDir = NodePath.join(outDir, name);
NodeFS.rmSync(stageDir, { recursive: true, force: true });
NodeFS.mkdirSync(NodePath.join(stageDir, "dist"), { recursive: true });
for (const file of NodeFS.readdirSync(distDir)) {
  if (file.endsWith(".map")) continue;
  const from = NodePath.join(distDir, file);
  if (!NodeFS.statSync(from).isFile()) continue;
  NodeFS.copyFileSync(from, NodePath.join(stageDir, "dist", file));
}
const manifest = {
  name,
  version,
  description:
    "Peer's coordination for coding agents without the Peer app: the `peer` command (Peer Core).",
  license: "MIT",
  repository: { type: "git", url: "https://github.com/SemanS/peer-app", directory: "apps/server" },
  bin: { peer: "./dist/bin.mjs" },
  type: "module",
  files: ["dist", "README.md", "LICENSE"],
  engines: { node: ">=24" },
  dependencies: dependencies(),
};
NodeFS.writeFileSync(
  NodePath.join(stageDir, "package.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
NodeFS.writeFileSync(NodePath.join(stageDir, "README.md"), readme(version));
NodeFS.copyFileSync(NodePath.join(repoRoot, "LICENSE"), NodePath.join(stageDir, "LICENSE"));
const tarball = read("npm", ["pack", "--pack-destination", outDir, stageDir], repoRoot)
  .split("\n")
  .pop()!;
console.log(`${name}@${version}: ${NodePath.join(outDir, tarball)}`);
console.log(`dependencies: ${Object.keys(manifest.dependencies).join(", ")}`);
