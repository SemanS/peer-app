// @effect-diagnostics nodeBuiltinImport:off - the companion package lives in the person's configured Codex home.
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import { parse as parseToml, type TomlTable } from "smol-toml";
import { writePreservingLink } from "./core/adapters/files.ts";
import { codexHookGroups } from "./core/adapters/scripts.ts";

export const CODEX_PEER_PLUGIN_ID = "peer@peer";
const VERSION = "1.0.0";

/**
 * The fingerprint Codex approves a plugin's hooks with (`trusted_content_hash`), computed as its
 * `plugin_content_hash` does: a domain prefix, then every entry under the plugin's root in
 * lexicographic order, each as its relative path (length-prefixed) and a kind marker, a file with
 * its length-prefixed bytes. Python build leftovers are skipped as Codex skips them; a symlink or
 * a special file is refused as Codex refuses it. The hooks stop running the moment this changes,
 * so the person approves the plugin's files again after a Peer update rewrites them.
 */
export async function codexPluginContentHash(root: string): Promise<string> {
  const skipped = (name: string) =>
    name === "__pycache__" ||
    name === ".venv" ||
    name.endsWith(".pyc") ||
    name.endsWith(".egg-info");
  const length = (n: number) => {
    const bytes = Buffer.alloc(8);
    bytes.writeBigUInt64LE(BigInt(n));
    return bytes;
  };
  const hash = NodeCrypto.createHash("sha256").update("codex-plugin-bundle-v1");
  if (!(await NodeFSP.lstat(root)).isDirectory())
    throw new Error("A Codex plugin root must be a directory, not a link.");
  const pending = [""];
  while (pending.length > 0) {
    const relative = pending.pop()!;
    const absolute = relative === "" ? root : NodePath.join(root, relative);
    const stat = await NodeFSP.lstat(absolute);
    // The root is an entry too: an empty path, then its kind.
    hash.update(length(Buffer.byteLength(relative))).update(relative);
    if (stat.isDirectory()) {
      hash.update("directory");
      const names = (await NodeFSP.readdir(absolute))
        .filter((name) => !skipped(name))
        .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
      for (const name of names.toReversed())
        pending.push(relative === "" ? name : NodePath.join(relative, name));
    } else if (stat.isFile()) {
      const bytes = await NodeFSP.readFile(absolute);
      hash.update("file").update(length(bytes.length)).update(bytes);
    } else {
      throw new Error(
        `Codex refuses plugin entries that are not files or directories: ${relative}`,
      );
    }
  }
  return `sha256:${hash.digest("hex")}`;
}
const pluginHeader =
  /^\[\s*(?:plugins|"plugins"|'plugins')\s*\.\s*(?:"peer@peer"|'peer@peer')\s*\]\s*(?:#.*)?$/;
const marketplaceHeader =
  /^\[\s*(?:marketplaces|"marketplaces"|'marketplaces')\s*\.\s*(?:peer|"peer"|'peer')\s*\]\s*(?:#.*)?$/;

export function codexPeerPluginPaths(home: string) {
  const marketplace = NodePath.join(home, "plugins", "peer-marketplace");
  return {
    marketplace,
    source: NodePath.join(marketplace, "peer"),
    installed: NodePath.join(home, "plugins", "cache", "peer", "peer", VERSION),
  };
}

export async function readOptionalText(path: string): Promise<string> {
  try {
    return await NodeFSP.readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

function sections(config: string) {
  if (/'''|"""/.test(config))
    throw new Error(
      "This Codex config uses multiline TOML; install the Peer plugin through Codex.",
    );
  return config.split(/(?=^[\t ]*\[)/m);
}

function table(config: string, header: RegExp): string | undefined {
  const matches = sections(config).filter((section) => header.test(section.split("\n")[0]!.trim()));
  if (matches.length > 1) throw new Error("Codex config contains duplicate Peer plugin tables.");
  return matches[0];
}

export function codexPeerPluginEnabled(config: string): boolean | undefined {
  const plugins = parseToml(config).plugins as TomlTable | undefined;
  const plugin = plugins?.[CODEX_PEER_PLUGIN_ID] as TomlTable | undefined;
  return plugin === undefined ? undefined : plugin.enabled !== false;
}

/** Only Peer-owned tables change; all other Codex settings, including hook trust, stay verbatim. */
export function withCodexPeerPlugin(config: string, marketplace: string, enabled: boolean): string {
  const parsed = parseToml(config);
  let next = config;
  for (const [matcher, group, name, header, values] of [
    [
      marketplaceHeader,
      "marketplaces",
      "peer",
      "[marketplaces.peer]",
      { source_type: '"local"', source: JSON.stringify(marketplace) },
    ],
    [
      pluginHeader,
      "plugins",
      CODEX_PEER_PLUGIN_ID,
      '[plugins."peer@peer"]',
      { enabled: String(enabled) },
    ],
  ] as const) {
    const previous = table(next, matcher);
    if (previous === undefined && (parsed[group] as TomlTable | undefined)?.[name] !== undefined)
      throw new Error(
        "This Codex plugin configuration needs review in Codex before installing Peer.",
      );
    let replacement = previous ?? `${header}\n`;
    for (const [key, value] of Object.entries(values)) {
      const field = new RegExp(
        `^([\\t ]*)(?:${key}|"${key}"|'${key}')[\\t ]*=[\\t ]*(?:"(?:[^"\\\\]|\\\\.)*"|'[^']*'|true|false)([\\t ]*(?:#.*)?)$`,
        "m",
      );
      if (field.test(replacement))
        replacement = replacement.replace(
          field,
          (_line, prefix: string, comment: string) => `${prefix}${key} = ${value}${comment}`,
        );
      else if (new RegExp(`^[\\t ]*(?:${key}|"${key}"|'${key}')[\\t ]*=`, "m").test(replacement))
        throw new Error(`Codex's Peer plugin ${key} needs review in Codex.`);
      else replacement = `${replacement.trimEnd()}\n${key} = ${value}\n\n`;
    }
    next =
      previous === undefined
        ? `${next}${next.length > 0 && !next.endsWith("\n") ? "\n" : ""}${replacement}`
        : next.replace(previous, () => replacement);
  }
  // Validate before touching disk, including escaped keys and inline tables the editor leaves alone.
  parseToml(next);
  return next;
}

export function codexPeerPluginFiles(hook: string) {
  if (!NodePath.isAbsolute(hook) || /[\r\n\0]/.test(hook))
    throw new Error("Peer's hook must be an absolute path without line breaks.");
  const quoted = `'${hook.replaceAll("'", "'\\''")}'`;
  const groups = codexHookGroups({ hook, wait: "" });
  const hooks = Object.fromEntries(
    Object.entries(groups).map(([event, groups]) => [
      event,
      groups.map((group) => ({
        ...group,
        hooks: group.hooks?.map((entry) => ({
          ...entry,
          command: 'sh "${PLUGIN_ROOT}/scripts/hook.sh"',
        })),
      })),
    ]),
  );
  return {
    ".codex-plugin/plugin.json": `${JSON.stringify(
      {
        name: "peer",
        version: VERSION,
        description: "Coordinate coding agents through the Peer app on this environment.",
        author: { name: "Peer" },
        hooks: "./hooks/hooks.json",
        interface: {
          displayName: "Peer",
          shortDescription: "Shared context and edit coordination for coding agents",
          longDescription:
            "Connect Codex sessions to Peer workspace projects, share working context, coordinate overlapping edits, and report agent activity.",
          developerName: "Peer",
          category: "Productivity",
        },
      },
      null,
      2,
    )}\n`,
    "hooks/hooks.json": `${JSON.stringify({ hooks }, null, 2)}\n`,
    "scripts/hook.sh": `#!/bin/sh\n# The app owns the broker transport and keeps it current across Peer updates.\n[ -x ${quoted} ] || exit 0\nexec ${quoted} codex\n`,
  };
}

/** Materialize the same local catalog and cache layout as `codex plugin add peer@peer`. */
export async function writeCodexPeerPlugin(home: string, hook: string): Promise<void> {
  const paths = codexPeerPluginPaths(home);
  const catalog = `${JSON.stringify(
    {
      name: "peer",
      interface: { displayName: "Peer" },
      plugins: [
        {
          name: "peer",
          source: { source: "local", path: "./peer" },
          policy: { installation: "INSTALLED_BY_DEFAULT", authentication: "ON_INSTALL" },
          category: "Productivity",
        },
      ],
    },
    null,
    2,
  )}\n`;
  const files = codexPeerPluginFiles(hook);
  for (const root of [paths.source, paths.installed]) {
    for (const [relative, text] of Object.entries(files)) {
      const file = NodePath.join(root, relative);
      if ((await readOptionalText(file)) !== text) await writePreservingLink(file, text);
    }
  }
  const catalogPath = NodePath.join(paths.marketplace, ".agents", "plugins", "marketplace.json");
  if ((await readOptionalText(catalogPath)) !== catalog)
    await writePreservingLink(catalogPath, catalog);
}
