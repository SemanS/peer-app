// @effect-diagnostics nodeBuiltinImport:off globalTimers:off - opening a terminal window runs a program on this computer and writes the script macOS opens; a window that stays open is told apart from one that failed by a short wall-clock wait.
/**
 * Opening a terminal window attached to Peer's herdr, and the command that does the same by hand.
 *
 * @module peerHub/plugins/herdr/client/terminal
 */
import * as NodeChild from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import type { PeerHerdrPaths } from "./binary.ts";

/** `value` as one word of a POSIX shell command, whatever it holds. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * The command that attaches a terminal to Peer's herdr: its configuration file, so herdr's
 * client agrees with the server on settings, and its session. Run in any shell.
 */
export function herdrAttachCommand(bin: string, paths: PeerHerdrPaths): string {
  return `HERDR_CONFIG_PATH=${shellQuote(paths.configPath)} ${shellQuote(bin)} --session ${shellQuote(paths.session)}`;
}

/** The computer, as far as opening a window depends on it; tests give a stand-in. */
export interface TerminalHost {
  readonly platform: NodeJS.Platform;
  readonly env: NodeJS.ProcessEnv;
  /** The full path of a program, when the computer has it. */
  readonly find: (program: string) => string | undefined;
  /** Starts a program that outlives Peer; true when it started and did not fail at once. */
  readonly launch: (file: string, args: ReadonlyArray<string>) => Promise<boolean>;
}

export type OpenTerminalResult =
  | { readonly opened: true; readonly via: string }
  | { readonly opened: false; readonly reason: string };

/** Terminal emulators in the order Peer tries them, each with what precedes the command to run. */
const LINUX_TERMINALS: ReadonlyArray<readonly [program: string, ...flags: string[]]> = [
  ["x-terminal-emulator", "-e"],
  ["gnome-terminal", "--"],
  ["konsole", "-e"],
  ["xfce4-terminal", "-x"],
  ["kitty"],
  ["alacritty", "-e"],
  ["wezterm", "start", "--"],
  ["xterm", "-e"],
];

const NO_TERMINAL: OpenTerminalResult = {
  opened: false,
  reason: "Peer found no terminal application it can open on this computer.",
};

/**
 * Opens a terminal attached to Peer's herdr. On macOS a `0700` script that runs the attach
 * command is opened with `open`, so the person's own default handler (Terminal or iTerm) shows
 * it. On Linux the first terminal emulator the computer has runs the command: `$TERMINAL`, then
 * the usual ones. Anywhere else, or with none found, it says so.
 */
export async function openHerdrTerminal(input: {
  readonly bin: string;
  readonly paths: PeerHerdrPaths;
  readonly host?: TerminalHost;
}): Promise<OpenTerminalResult> {
  const host = input.host ?? realTerminalHost();
  const attach = herdrAttachCommand(input.bin, input.paths);

  if (host.platform === "darwin") {
    const open = host.find("open");
    if (open === undefined) return NO_TERMINAL;
    NodeFS.mkdirSync(NodePath.dirname(input.paths.commandPath), { recursive: true, mode: 0o700 });
    NodeFS.writeFileSync(
      input.paths.commandPath,
      `#!/bin/sh\n# Written by Peer: opens a terminal attached to Peer's herdr.\n${attach}\n`,
    );
    NodeFS.chmodSync(input.paths.commandPath, 0o700);
    return (await host.launch(open, [input.paths.commandPath]))
      ? { opened: true, via: "open" }
      : NO_TERMINAL;
  }

  if (host.platform === "linux") {
    const own = host.env.TERMINAL?.trim();
    const candidates: ReadonlyArray<readonly [string, ...string[]]> = own
      ? [[own, "-e"], ...LINUX_TERMINALS]
      : LINUX_TERMINALS;
    for (const [program, ...flags] of candidates) {
      const file = host.find(program);
      if (file === undefined) continue;
      if (await host.launch(file, [...flags, "sh", "-c", attach]))
        return { opened: true, via: NodePath.basename(program) };
    }
  }
  return NO_TERMINAL;
}

/** How long a program may run before Peer takes its window for open; `open` ends sooner. */
const SETTLE_MS = 1500;

function realTerminalHost(): TerminalHost {
  const env = process.env;
  const isExecutableFile = (file: string): boolean => {
    try {
      NodeFS.accessSync(file, NodeFS.constants.X_OK);
      return NodeFS.statSync(file).isFile();
    } catch {
      return false;
    }
  };
  const find = (program: string): string | undefined =>
    (program.includes("/")
      ? [program]
      : (env.PATH ?? "")
          .split(NodePath.delimiter)
          .filter((dir) => dir !== "")
          .map((dir) => NodePath.join(dir, program))
    ).find(isExecutableFile);
  const launch = (file: string, args: ReadonlyArray<string>) =>
    new Promise<boolean>((resolve) => {
      const child = NodeChild.spawn(file, [...args], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      const settle = setTimeout(() => resolve(true), SETTLE_MS);
      child.on("error", () => {
        clearTimeout(settle);
        resolve(false);
      });
      child.on("exit", (code) => {
        clearTimeout(settle);
        resolve(code === 0);
      });
      child.unref();
    });
  return { platform: process.platform, env, find, launch };
}
