import { writePreservingLink } from "./core/adapters/files.ts";
// @effect-diagnostics nodeBuiltinImport:off - hook settings belong to the person's selected Codex home.
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import { parse as parseToml } from "smol-toml";
import {
  CODEX_PEER_PLUGIN_ID,
  codexPeerPluginEnabled,
  codexPeerPluginFiles,
  codexPeerPluginPaths,
  codexPluginContentHash,
  readOptionalText as readText,
  withCodexPeerPlugin,
  writeCodexPeerPlugin,
} from "./codexPlugin.ts";
import {
  codexHookHash,
  codexHookTrust,
  codexRules,
  hasPeerHooks,
  settingsDiffer,
  withPeerHooks,
  type Settings,
} from "./core/adapters/scripts.ts";

export interface CodexPeerScripts {
  readonly hook: string;
  readonly wait: string;
}

export interface CodexPeerHook {
  readonly event: string;
  readonly key: string;
  readonly command: string;
  readonly hash: string;
  readonly matcher?: string;
  readonly timeout: number;
  readonly enabled: boolean;
  readonly trusted: boolean;
}

export interface CodexPeerHookReview {
  readonly home: string;
  readonly hooksPath: string;
  readonly present: boolean;
  readonly installed: boolean;
  readonly trusted: boolean;
  /**
   * The fingerprint of the installed plugin's files; Codex runs a plugin's hook only while the
   * approval names this very fingerprint. Null while the plugin is not installed.
   */
  readonly contentHash: string | null;
  /** Identity of the commands, positions, normalized hashes and installed script contents being reviewed. */
  readonly reviewId: string;
  readonly hooks: ReadonlyArray<CodexPeerHook>;
}

const labels: Readonly<Record<string, string>> = {
  SessionStart: "session_start",
  UserPromptSubmit: "user_prompt_submit",
  PreToolUse: "pre_tool_use",
  PostToolUse: "post_tool_use",
  PermissionRequest: "permission_request",
  PreCompact: "pre_compact",
  Stop: "stop",
  SessionEnd: "session_end",
  Interrupt: "interrupt",
};

function decodeHooks(text: string): Settings {
  const value: unknown = JSON.parse(text || "{}");
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Codex hooks must be a JSON object.");
  const hooks = (value as Settings).hooks;
  if (hooks !== undefined) {
    if (typeof hooks !== "object" || hooks === null || Array.isArray(hooks))
      throw new Error("Codex hooks must contain an event map.");
    for (const groups of Object.values(hooks)) {
      if (
        !Array.isArray(groups) ||
        groups.some(
          (group) =>
            typeof group !== "object" ||
            group === null ||
            !Array.isArray(group.hooks) ||
            group.hooks.some((hook: unknown) => typeof hook !== "object" || hook === null),
        )
      )
        throw new Error("Codex hook groups are invalid.");
    }
  }
  return value as Settings;
}

function digest(text: string): string {
  return `sha256:${NodeCrypto.createHash("sha256").update(text).digest("hex")}`;
}

/** Plugin hook identities are stable across Codex homes and cache versions. */
export async function readCodexPeerHookReview(
  home: string,
  scripts: CodexPeerScripts,
): Promise<CodexPeerHookReview> {
  home = NodePath.resolve(home);
  const { installed: pluginPath } = codexPeerPluginPaths(home);
  const hooksPath = NodePath.join(pluginPath, "hooks", "hooks.json");
  const [hooksText, config, scriptText, legacyText] = await Promise.all([
    readText(hooksPath),
    readText(NodePath.join(home, "config.toml")),
    readText(scripts.hook),
    readText(NodePath.join(home, "hooks.json")),
  ]);
  const settings = decodeHooks(hooksText);
  const trust = codexHookTrust(config);
  const hooks: CodexPeerHook[] = [];
  const expectedFiles = codexPeerPluginFiles(scripts.hook);
  const packageMatches = (
    await Promise.all(
      Object.entries(expectedFiles).map(
        async ([file, text]) => (await readText(NodePath.join(pluginPath, file))) === text,
      ),
    )
  ).every(Boolean);
  let installed = packageMatches && codexPeerPluginEnabled(config) === true;
  const contentHash = installed ? await codexPluginContentHash(pluginPath).catch(() => null) : null;
  if (contentHash === null) installed = false;
  const expectedGroups = decodeHooks(expectedFiles["hooks/hooks.json"]).hooks ?? {};
  for (const [event, expected] of Object.entries(expectedGroups)) {
    const handler = expected[0]?.hooks?.[0];
    if (handler === undefined) continue;
    const expectedHash = codexHookHash(event, expected[0]?.matcher, handler);
    let found = 0;
    for (const [g, group] of (settings.hooks?.[event] ?? []).entries()) {
      for (const [h, actual] of (group.hooks ?? []).entries()) {
        if (actual.command !== handler.command) continue;
        const hash = codexHookHash(event, group.matcher, actual);
        const exact =
          Object.keys(actual).length === Object.keys(handler).length &&
          Object.entries(handler).every(([key, value]) => actual[key] === value) &&
          group.matcher === expected[0]?.matcher;
        if (!exact || hash !== expectedHash || hash === null) {
          installed = false;
          continue;
        }
        found += 1;
        const key = `${CODEX_PEER_PLUGIN_ID}:hooks/hooks.json:${labels[event]}:${g}:${h}`;
        const state = trust.get(key);
        hooks.push({
          event,
          key,
          command: String(handler.command),
          hash,
          ...(typeof group.matcher === "string" ? { matcher: group.matcher } : {}),
          timeout: Number(handler.timeout),
          enabled: state?.enabled !== false,
          trusted:
            state?.enabled !== false && state?.hash === hash && state?.contentHash === contentHash,
        });
      }
    }
    if (found !== 1) installed = false;
  }
  const reviewId = digest(
    JSON.stringify({
      home,
      hooksPath,
      installed,
      scriptHash: digest(scriptText + expectedFiles["scripts/hook.sh"]),
      contentHash,
      hooks: hooks.map(({ enabled: _enabled, trusted: _trusted, ...hook }) => hook),
    }),
  );
  return {
    home,
    hooksPath,
    present:
      hooksText.length > 0 || hasPeerHooks(decodeHooks(legacyText), NodePath.dirname(scripts.hook)),
    installed,
    trusted: installed && hooks.every((hook) => hook.trusted),
    contentHash,
    reviewId,
    hooks,
  };
}

/** Installation never grants trust. Move legacy hooks without changing other integrations' trust. */
export async function installCodexPeerHooks(
  home: string,
  scripts: CodexPeerScripts,
  install: boolean,
): Promise<void> {
  home = NodePath.resolve(home);
  const hooksPath = NodePath.join(home, "hooks.json");
  const previous = decodeHooks(await readText(hooksPath));
  const next = withPeerHooks(previous, {}, NodePath.dirname(scripts.hook), false);
  const configPath = NodePath.join(home, "config.toml");
  const config = await readText(configPath);
  const trustPath = NodePath.join(await NodeFSP.realpath(home).catch(() => home), "hooks.json");
  const trustPaths = new Set([trustPath]);
  if (settingsDiffer(previous, next)) {
    const physicalHooks = await NodeFSP.realpath(hooksPath);
    // Auth overlays share hooks.json but Codex keys native hook trust by each home's path.
    for (const key of codexHookTrust(config).keys()) {
      const candidate = /^(.*):[a-z_]+:\d+:\d+$/.exec(key)?.[1];
      if (candidate && (await NodeFSP.realpath(candidate).catch(() => undefined)) === physicalHooks)
        trustPaths.add(candidate);
    }
  }
  const migrated = relocateLegacyTrust(config, previous, next, trustPaths);
  const paths = codexPeerPluginPaths(home);
  const sharedPlugins = await NodeFSP.realpath(NodePath.dirname(paths.marketplace)).catch(
    (error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return NodePath.join(NodePath.dirname(trustPath), "plugins");
    },
  );
  const nextConfig = withCodexPeerPlugin(
    migrated,
    NodePath.join(sharedPlugins, "peer-marketplace"),
    install,
  );
  if (install) await writeCodexPeerPlugin(home, scripts.hook);
  // Config first: a concurrent Codex reload may temporarily skip legacy hooks, but cannot
  // apply an old trusted position to a different command after groups have been removed.
  if (nextConfig !== config) await writePreservingLink(configPath, nextConfig);
  if (settingsDiffer(previous, next)) {
    await NodeFSP.copyFile(
      hooksPath,
      `${hooksPath}.peer-before-plugin`,
      NodeFSP.constants.COPYFILE_EXCL,
    ).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    });
    await writePreservingLink(hooksPath, `${JSON.stringify(next, null, 2)}\n`);
  }
  if (!install) {
    await NodeFSP.rm(paths.installed, { recursive: true, force: true });
  }
  const rulesPath = NodePath.join(home, "rules", "peer.rules");
  if (install)
    await writePreservingLink(
      rulesPath,
      codexRules(NodePath.join(NodePath.dirname(scripts.hook), "bin", "peer")),
    );
  else await NodeFSP.rm(rulesPath, { force: true });
}

/** Refresh owned installs; a person's explicit removal/disable survives app restarts. */
export async function refreshCodexPeerHooks(
  home: string,
  scripts: CodexPeerScripts,
  autoInstall: boolean,
): Promise<void> {
  const config = await readText(NodePath.join(home, "config.toml"));
  const enabled = codexPeerPluginEnabled(config);
  if (enabled === false) return;
  const { installed, source } = codexPeerPluginPaths(home);
  const wrapper = await readText(NodePath.join(installed, "scripts", "hook.sh"));
  const sourceWrapper = await readText(NodePath.join(source, "scripts", "hook.sh"));
  // Another Peer environment (including a dev worktree) must not take over this Codex home.
  const expected = codexPeerPluginFiles(scripts.hook)["scripts/hook.sh"];
  if ((wrapper && wrapper !== expected) || (sourceWrapper && sourceWrapper !== expected)) return;
  // Native `codex plugin remove` deletes the enablement table and cache, leaving the catalog.
  if (enabled === undefined && sourceWrapper) return;
  const legacy = decodeHooks(await readText(NodePath.join(home, "hooks.json")));
  if (autoInstall || wrapper || hasPeerHooks(legacy, NodePath.dirname(scripts.hook))) {
    await installCodexPeerHooks(home, scripts, true);
  }
}

const hookStateHeader = /^\s*\[\s*hooks\.state\."((?:[^"\\]|\\.)*)"\s*\]\s*(?:#[^\n]*)?(?:\r?\n|$)/;

function relocateLegacyTrust(
  config: string,
  before: Settings,
  after: Settings,
  paths: ReadonlySet<string>,
): string {
  if (!settingsDiffer(before, after)) return config;
  assertSupportedHookState(config);
  const entries = (settings: Settings, path: string) =>
    Object.entries(settings.hooks ?? {}).flatMap(([event, groups]) =>
      groups.flatMap((group, g) =>
        (group.hooks ?? []).map(
          (hook, h) =>
            [
              hook,
              `${path}:${labels[event] ?? event.replace(/[A-Z]/g, (c, i: number) => `${i ? "_" : ""}${c.toLowerCase()}`)}:${g}:${h}`,
              event,
            ] as const,
        ),
      ),
    );
  const moves = new Map<string, string | undefined>();
  const disabled = new Set<string>();
  const trust = codexHookTrust(config);
  for (const path of paths) {
    const remaining = new Map(entries(after, path).map(([hook, key]) => [hook, key]));
    for (const [hook, key, event] of entries(before, path)) {
      const next = remaining.get(hook);
      moves.set(key, next);
      if (next === undefined && labels[event] && trust.get(key)?.enabled === false) {
        const pluginKey = `${CODEX_PEER_PLUGIN_ID}:hooks/hooks.json:${labels[event]}:0:0`;
        if (!trust.has(pluginKey)) disabled.add(pluginKey);
      }
    }
  }
  let migrated = config
    .split(/(?=^[\t ]*\[)/m)
    .map((section) => {
      const header = hookStateHeader.exec(section);
      if (header === null) return section;
      const key = JSON.parse(`"${header[1]}"`) as string;
      if (!moves.has(key)) return section;
      const next = moves.get(key);
      return next === undefined
        ? ""
        : `[hooks.state.${JSON.stringify(next)}]\n${section.slice(header[0].length)}`;
    })
    .join("");
  for (const key of disabled)
    migrated += `\n[hooks.state.${JSON.stringify(key)}]\nenabled = false\n`;
  parseToml(migrated);
  return migrated;
}

/**
 * Only the native quoted state-table representation is safe for the narrow edit below. A key named
 * `hooks` or `state` only matters where it could define Codex's hook state: `hooks` at the top of
 * the file, `state` in the `[hooks]` table. herdr's Codex integration itself writes `hooks = true`
 * under `[features]`, which is unrelated and must not stop Peer's hooks from being trusted.
 */
function assertSupportedHookState(config: string): void {
  parseToml(config);
  let scope: "parent" | "entry" | undefined;
  let table: "root" | "hooks" | "other" = "root";
  for (const sourceLine of config.split("\n")) {
    const line = sourceLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    if (line.startsWith("[")) {
      const entry = hookStateHeader.test(line);
      const parent = /^\[\s*hooks\.state\s*\]\s*(?:#.*)?$/.test(line);
      if (
        !entry &&
        !parent &&
        /^\[\[?\s*(?:hooks\s*\.\s*(?:state\b|["'])|["']hooks["'])/.test(line)
      ) {
        throw new Error("This Codex hook state format needs review in Codex's /hooks screen.");
      }
      scope = entry ? "entry" : parent ? "parent" : undefined;
      table = /^\[\s*hooks\s*\]\s*(?:#.*)?$/.test(line) ? "hooks" : "other";
      continue;
    }
    const alternate =
      (table === "root" && /^(?:hooks|["']hooks["'])(?:\s*\.\s*[^=]+)?\s*=/.test(line)) ||
      (table === "hooks" && /^(?:state|["']state["'])(?:\s*\.\s*[^=]+)?\s*=/.test(line)) ||
      /^"(?:[^"\\]|\\.)*\\[uU]/.test(line);
    const nativeField =
      /^(?:enabled\s*=\s*(?:true|false)|trusted(?:_content)?_hash\s*=\s*"[^"\n]*")\s*(?:#.*)?$/.test(
        line,
      );
    if (alternate || scope === "parent" || (scope === "entry" && !nativeField)) {
      throw new Error("This Codex hook state format needs review in Codex's /hooks screen.");
    }
  }
}

/**
 * A deliberately narrow edit: unfamiliar TOML trust representations require review in Codex.
 * Each hook's state names the hook (`trusted_hash`) and the plugin's files (`trusted_content_hash`):
 * Codex runs a plugin's hook only while both match, and reports it as failed otherwise.
 */
function withReviewedTrust(
  config: string,
  hooks: ReadonlyArray<CodexPeerHook>,
  contentHash: string,
): string {
  if (/'''|"""/.test(config))
    throw new Error("This Codex config uses multiline TOML; review the Peer hooks in Codex.");
  assertSupportedHookState(config);
  const pending = new Map(hooks.map((hook) => [hook.key, hook]));
  const sections = config.split(/(?=^\s*\[)/m);
  const seen = new Set<string>();
  const next = sections
    .map((section) => {
      const header = hookStateHeader.exec(section);
      if (header === null) {
        return section;
      }
      const key = JSON.parse(`"${header[1]}"`) as string;
      if (seen.has(key)) throw new Error("Codex config contains duplicate hook trust tables.");
      seen.add(key);
      const hook = pending.get(key);
      if (hook === undefined) return section;
      pending.delete(key);
      let body = section.slice(header[0].length);
      const prefix = header[0].endsWith("\n") ? header[0] : `${header[0]}\n`;
      // Keep enabled=false and every unrelated field/comment exactly as the person wrote it.
      for (const [field, value] of [
        ["trusted_hash", hook.hash],
        ["trusted_content_hash", contentHash],
      ] as const) {
        const line = new RegExp(`^([\\t ]*)${field}\\s*=\\s*"[^"\\n]*"([^\\n]*)`, "m");
        if (line.test(body)) {
          body = body.replace(line, `$1${field} = ${JSON.stringify(value)}$2`);
          continue;
        }
        if (new RegExp(`^\\s*${field}\\s*=`, "m").test(body))
          throw new Error("This Codex trusted hash format needs review in Codex.");
        body = `${field} = ${JSON.stringify(value)}\n${body}`;
      }
      return prefix + body;
    })
    .join("");
  let result = next;
  for (const hook of pending.values()) {
    result += `${result.endsWith("\n") || result.length === 0 ? "" : "\n"}\n[hooks.state.${JSON.stringify(hook.key)}]\ntrusted_hash = ${JSON.stringify(hook.hash)}\ntrusted_content_hash = ${JSON.stringify(contentHash)}\nenabled = true\n`;
  }
  parseToml(result);
  return result;
}

/** Call only for a person's explicit approval of this displayed review, never as part of installation. */
export async function trustCodexPeerHooks(
  home: string,
  scripts: CodexPeerScripts,
  reviewId: string,
): Promise<CodexPeerHookReview> {
  const review = await readCodexPeerHookReview(home, scripts);
  if (!review.installed || review.reviewId !== reviewId)
    throw new Error(
      "Peer hooks changed or are not completely installed. Review the current commands before trusting them.",
    );
  const configPath = NodePath.join(review.home, "config.toml");
  const config = await readText(configPath);
  if (review.contentHash === null)
    throw new Error(
      "Peer's Codex plugin is not completely installed. Install it before trusting it.",
    );
  const next = withReviewedTrust(config, review.hooks, review.contentHash);
  const current = await readCodexPeerHookReview(home, scripts);
  if (current.reviewId !== reviewId || (await readText(configPath)) !== config)
    throw new Error("Codex settings changed during hook review. Review them again.");
  if (next !== config) await writePreservingLink(configPath, next);
  return readCodexPeerHookReview(home, scripts);
}

/** Server actions accept only homes selected by the current provider configuration. */
export async function trustConfiguredCodexPeerHooks(
  homes: ReadonlyArray<string>,
  approval: { readonly home: string; readonly reviewId: string },
  scripts: CodexPeerScripts,
): Promise<CodexPeerHookReview> {
  if (!homes.includes(approval.home))
    throw new Error(
      "This Codex home is no longer configured on this environment. Refresh its hook review.",
    );
  return trustCodexPeerHooks(approval.home, scripts, approval.reviewId);
}
