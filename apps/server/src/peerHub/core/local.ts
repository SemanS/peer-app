// @effect-diagnostics nodeBuiltinImport:off - probes this computer's PATH and checkouts, and runs its commands.
/**
 * What this computer has: commands on PATH, looked up the way a Dock-launched app must, and git
 * checkouts; and running those commands.
 *
 * @module peerHub/core/local
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { GIT_ALLOWED_PROTOCOLS } from "../gitSafety.ts";

/** Directories on PATH plus the usual install locations a Dock-launched app may miss. */
export function searchPath(): string[] {
  const extra = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    NodePath.join(NodeOS.homedir(), ".local", "bin"),
    NodePath.join(NodeOS.homedir(), ".cargo", "bin"),
  ];
  return [...(process.env.PATH ?? "").split(NodePath.delimiter), ...extra].filter(Boolean);
}

/** Where `command` is installed, looked up on `searchPath`. */
export function commandPath(command: string): string | null {
  for (const dir of searchPath()) {
    const candidate = NodePath.join(dir, command);
    if (NodeFS.existsSync(candidate)) return candidate;
  }
  return null;
}

export function commandAvailable(command: string): boolean {
  if (command.includes("/")) return NodeFS.existsSync(command);
  return commandPath(command) !== null;
}

export function hasGitCheckout(path: string): boolean {
  return NodeFS.existsSync(NodePath.join(path, ".git"));
}

/**
 * What a command prints, run without a terminal on `searchPath`. git asks for nothing and runs no
 * transport helpers, whatever an address says. A failure's message is its last lines; its cause
 * keeps all it printed (`runOutput`).
 */
export function run(
  command: string,
  args: ReadonlyArray<string>,
  options: {
    readonly cwd?: string;
    readonly timeoutMs?: number;
    /** Its output as printed, not trimmed: `git status --porcelain` starts lines with a space. */
    readonly raw?: boolean;
  } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    NodeChildProcess.execFile(
      command,
      [...args],
      {
        cwd: options.cwd,
        timeout: options.timeoutMs ?? 30_000,
        maxBuffer: 4 * 1024 * 1024,
        env: {
          ...process.env,
          PATH: searchPath().join(NodePath.delimiter),
          GIT_TERMINAL_PROMPT: "0",
          // No transport helpers (`ext::`), whatever an address says.
          GIT_ALLOW_PROTOCOL: GIT_ALLOWED_PROTOCOLS,
        },
      },
      (error, stdout, stderr) => {
        if (error) {
          // The message is the last lines; the cause keeps all of it for explaining the failure.
          const output = (stderr || error.message).trim();
          reject(new Error(output.split("\n").slice(-3).join(" "), { cause: output }));
        } else {
          resolve(options.raw === true ? stdout : stdout.trim());
        }
      },
    );
  });
}

/** Everything a rejected `run` printed. */
export function runOutput(failure: unknown): string {
  if (!(failure instanceof Error)) return String(failure);
  return typeof failure.cause === "string" ? failure.cause : failure.message;
}

/**
 * The environment of a model run on the person's own Claude Code (kontext's, and the one an agent
 * asks with `peer find`): Peer's own. The coordination lab keeps its Peers' Claude Code settings
 * apart (CLAUDE_CONFIG_DIR) and names, in `PEER_KONTEXT_CLAUDE_CONFIG_DIR`, the person's own Claude
 * Code that kontext's llm adapter runs on; empty for Claude Code's default. Naming ~/.claude is not
 * the same: Claude Code then looks for another sign-in.
 */
export function modelEnv(): NodeJS.ProcessEnv {
  // The agent such a model runs as is Peer's own tool, no agent at work on the project: Peer's
  // hooks let it be.
  const env: NodeJS.ProcessEnv = { ...process.env, PEER_COORDINATION: "off" };
  const own = process.env.PEER_KONTEXT_CLAUDE_CONFIG_DIR;
  if (own === undefined) return env;
  delete env.CLAUDE_CONFIG_DIR;
  if (own !== "") env.CLAUDE_CONFIG_DIR = own;
  return env;
}
