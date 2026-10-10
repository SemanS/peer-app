// @effect-diagnostics nodeBuiltinImport:off - Peer's bundled herdr is a file on this computer; its paths, configuration and environment are plain filesystem and process values.
/**
 * Peer's own herdr, before it runs: the bundled binary, the private session it will live in, the
 * configuration file Peer manages for it and the environment it starts with.
 *
 * @module peerHub/plugins/herdr/client/binary
 */
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { herdrSocketPath } from "./herdr.ts";

/** The variable through which the desktop app (or whoever starts the server) names the binary. */
export const PEER_HERDR_BIN_ENV = "PEER_HERDR_BIN";

/** The platforms herdr releases a binary for and Peer's client can speak to (Unix sockets). */
const SUPPORTED_PLATFORMS: ReadonlySet<NodeJS.Platform> = new Set(["darwin", "linux"]);

export type HerdrBinary =
  | { readonly available: true; readonly path: string }
  | { readonly available: false; readonly reason: string };

/**
 * The bundled herdr, or why this computer has none. Peer counts it as available only when
 * `PEER_HERDR_BIN` names an executable file on macOS or Linux. The reason is words for a person
 * and names no path.
 */
export function resolveHerdrBinary(
  options: {
    readonly env?: NodeJS.ProcessEnv;
    readonly platform?: NodeJS.Platform;
  } = {},
): HerdrBinary {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  if (!SUPPORTED_PLATFORMS.has(platform))
    return { available: false, reason: "herdr is not available for this operating system." };
  const path = env[PEER_HERDR_BIN_ENV]?.trim();
  if (!path) return { available: false, reason: "This build of Peer does not include herdr." };
  try {
    if (!NodeFS.statSync(path).isFile()) throw new Error("not a file");
    NodeFS.accessSync(path, NodeFS.constants.X_OK);
  } catch {
    return {
      available: false,
      reason: "Peer's bundled herdr is missing or cannot be run on this computer.",
    };
  }
  return { available: true, path };
}

/** Where Peer's herdr keeps everything, for one Peer home. */
export interface PeerHerdrPaths {
  /** The herdr session's name: `peer-` and the first 8 hex digits of the SHA-256 of the state dir. */
  readonly session: string;
  /** Where herdr puts the session: its sockets, `session.json` and the server log. */
  readonly sessionDir: string;
  readonly socketPath: string;
  readonly logPath: string;
  /** The configuration file Peer writes and hands herdr as `HERDR_CONFIG_PATH`. */
  readonly configPath: string;
  /** The script that opens a terminal attached to the session on macOS. */
  readonly commandPath: string;
}

/**
 * The session is named after the Peer home so that a development server in a worktree never
 * adopts, restarts or upgrades the herdr of the Peer a person actually uses.
 */
export function peerHerdrSession(stateDir: string): string {
  return `peer-${NodeCrypto.createHash("sha256").update(stateDir).digest("hex").slice(0, 8)}`;
}

/** The paths of the herdr of the Peer whose state lives in `stateDir`. */
export function peerHerdrPaths(
  stateDir: string,
  env: NodeJS.ProcessEnv = process.env,
): PeerHerdrPaths {
  const session = peerHerdrSession(stateDir);
  // Resolved the way herdr resolves a named session; the person's own socket variables stay out.
  const socketPath = herdrSocketPath({
    ...(env.XDG_CONFIG_HOME === undefined ? {} : { XDG_CONFIG_HOME: env.XDG_CONFIG_HOME }),
    HERDR_SESSION: session,
  });
  const sessionDir = NodePath.dirname(socketPath);
  const herdrDir = NodePath.join(stateDir, "herdr");
  return {
    session,
    sessionDir,
    socketPath,
    logPath: NodePath.join(sessionDir, "herdr-server.log"),
    configPath: NodePath.join(herdrDir, "config.toml"),
    commandPath: NodePath.join(herdrDir, "open-herdr.command"),
  };
}

/**
 * What Peer's herdr is configured with. The update check would only notify (herdr never replaces
 * itself unasked), but Peer moves herdr with its own releases, so the notice is noise. The agent
 * detection manifests stay on: they are data that keeps idle and blocked detection current.
 */
export const HERDR_MANAGED_CONFIG = [
  "# Managed by Peer. Peer rewrites this file every time it starts herdr.",
  "# Change herdr's settings in your own herdr; they do not apply here.",
  "[update]",
  "version_check = false",
  "",
].join("\n");

/** Writes the managed configuration, replacing whatever the file held. */
export function writeHerdrConfig(paths: PeerHerdrPaths): void {
  NodeFS.mkdirSync(NodePath.dirname(paths.configPath), { recursive: true, mode: 0o700 });
  NodeFS.writeFileSync(paths.configPath, HERDR_MANAGED_CONFIG);
  NodeFS.chmodSync(paths.configPath, 0o600);
}

/** Variables that describe Peer's own process, not the person's shell. */
const PEER_PREFIXES = ["ELECTRON_", "T3CODE_", "VITE_", "PEER_"] as const;
/** Variables that would point herdr, or the panes it starts, at some other herdr. */
const HERDR_POINTERS: ReadonlySet<string> = new Set([
  "HERDR_SOCKET_PATH",
  "HERDR_SESSION",
  "HERDR_CLIENT_SOCKET_PATH",
  "HERDR_ENV",
  "HERDR_PANE_ID",
]);

/**
 * The environment herdr starts with, and so do the agents in its panes: the person's, minus what
 * belongs to Peer's process (Electron's run-as-node switch among it), plus the configuration
 * file. On macOS herdr's own launcher marks the server as started in the user's context; so does
 * this.
 */
export function herdrServerEnv(
  env: NodeJS.ProcessEnv,
  options: { readonly configPath: string; readonly platform?: NodeJS.Platform },
): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (key === "NODE_OPTIONS" || HERDR_POINTERS.has(key)) continue;
    if (PEER_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
    clean[key] = value;
  }
  clean.HERDR_CONFIG_PATH = options.configPath;
  if ((options.platform ?? process.platform) === "darwin")
    clean.HERDR_MACOS_SERVER_CONTEXT = "user";
  return clean;
}

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/;

/**
 * Orders two herdr versions: negative when `a` is older, 0 when equal, positive when newer. A
 * prerelease is older than its release. Null when either is not a version, which callers treat as
 * "do not touch" rather than guess.
 */
export function compareHerdrVersions(a: string, b: string): number | null {
  const left = VERSION.exec(a.trim());
  const right = VERSION.exec(b.trim());
  if (left === null || right === null) return null;
  for (const index of [1, 2, 3] as const) {
    const difference = Number(left[index]) - Number(right[index]);
    if (difference !== 0) return difference;
  }
  const [pre, other] = [left[4], right[4]];
  if (pre === other) return 0;
  if (pre === undefined) return 1;
  if (other === undefined) return -1;
  return pre < other ? -1 : 1;
}
