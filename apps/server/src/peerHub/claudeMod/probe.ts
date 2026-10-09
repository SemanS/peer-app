// @effect-diagnostics nodeBuiltinImport:off - bounded native CLI version probe before Mod activation.
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";

import { searchPath } from "../core/local.ts";

export function readClaudeModVersion(cli: string): Promise<string> {
  return new Promise((resolve, reject) => {
    NodeChildProcess.execFile(
      cli,
      ["--version"],
      {
        timeout: 10_000,
        maxBuffer: 64 * 1024,
        env: { ...process.env, PATH: searchPath().join(NodePath.delimiter) },
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail =
            error.killed && error.signal === "SIGTERM"
              ? `Claude Code's version probe timed out after 10 seconds at ${cli}. Check this CLI and retry.`
              : `Could not read Claude Code's version at ${cli}: ${(stderr || error.message).trim().split("\n").slice(-3).join(" ")}`;
          reject(new Error(detail, { cause: error }));
        } else resolve(stdout.trim());
      },
    );
  });
}
