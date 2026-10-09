// @effect-diagnostics nodeBuiltinImport:off globalTimers:off - simulate native execFile completion and its deadline with fake timers.
import type * as NodeChildProcess from "node:child_process";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const subprocess = vi.hoisted(() => ({
  execFile:
    vi.fn<
      (
        command: string,
        args: string[],
        options: { timeout: number },
        callback: (
          error: NodeChildProcess.ExecFileException | null,
          stdout: string,
          stderr: string,
        ) => void,
      ) => void
    >(),
}));
vi.mock("node:child_process", () => ({ execFile: subprocess.execFile }));

import { supportsClaudeMod } from "./install.ts";
import { readClaudeModVersion } from "./probe.ts";

const cli = "/test/native Claude/claude";

beforeEach(() => {
  vi.useFakeTimers();
  subprocess.execFile.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("Mod activation version probe", () => {
  it("accepts a supported CLI responding after the old three-second deadline", async () => {
    subprocess.execFile.mockImplementation((_command, _args, options, callback) => {
      setTimeout(
        () => {
          if (options.timeout < 4_000)
            callback(
              Object.assign(new Error("killed"), { killed: true, signal: "SIGTERM" as const }),
              "",
              "",
            );
          else callback(null, "2.1.296 (Claude Code)\n", "");
        },
        Math.min(options.timeout, 4_000),
      );
    });
    const version = readClaudeModVersion(cli);
    await Promise.all([
      expect(version).resolves.toBe("2.1.296 (Claude Code)"),
      vi.advanceTimersByTimeAsync(4_000),
    ]);
    expect(supportsClaudeMod(await version)).toBe(true);
  });

  it("bounds a hanging CLI and identifies the path and timeout", async () => {
    subprocess.execFile.mockImplementation((_command, _args, options, callback) => {
      setTimeout(
        () =>
          callback(
            Object.assign(new Error("killed"), { killed: true, signal: "SIGTERM" as const }),
            "",
            "",
          ),
        options.timeout,
      );
    });
    const version = readClaudeModVersion(cli);
    await Promise.all([
      expect(version).rejects.toThrow(`timed out after 10 seconds at ${cli}`),
      vi.advanceTimersByTimeAsync(10_000),
    ]);
  });

  it("distinguishes spawn failure from timeout without discarding the execution error", async () => {
    subprocess.execFile.mockImplementation((_command, _args, _options, callback) =>
      callback(Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }), "", ""),
    );
    await expect(readClaudeModVersion(cli)).rejects.toThrow(`version at ${cli}: spawn ENOENT`);
  });
});
