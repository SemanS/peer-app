// @effect-diagnostics nodeBuiltinImport:off - probes this computer's PATH and checkouts.
/**
 * What this computer has: commands on PATH, looked up the way a Dock-launched app must, and git
 * checkouts.
 *
 * @module peerHub/core/local
 */
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

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
