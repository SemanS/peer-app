// @effect-diagnostics nodeBuiltinImport:off - the person's CLIs run as child processes.
/**
 * Running an ended conversation once more, headless, so its agent can settle an overlap.
 *
 * @module peerHub/core/coordination/resumeNative
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import type { NativeResumeOutcome } from "../broker/host.ts";
import { searchPath } from "../local.ts";

/** How much of a failed resumption's stderr the outcome keeps: its end, where the CLI says why. */
const RESUME_STDERR_MAX = 2000;

/**
 * Runs an ended conversation once more, headless: `claude -p --resume <id> <text>`, or
 * `codex exec resume <id> <text>`. It runs as `run` runs commands (no terminal, no pane, no
 * sandbox, the person's environment with Peer's PATH, killed at the timeout), but tells a timeout
 * and an exit status apart, which the settle plugin reports.
 */
export function resumeNative(
  agent: "claude" | "codex",
  nativeId: string,
  cwd: string,
  text: string,
  options: { readonly timeoutMs: number },
): Promise<NativeResumeOutcome> {
  // The coordination lab's made-up sessions are no conversations of this person's CLIs.
  if (process.env.PEER_SETTLE_RESUME === "off")
    return Promise.resolve({ status: "failed", exit: null, reason: "off" });
  if (!NodeFS.existsSync(cwd))
    return Promise.resolve({ status: "failed", exit: null, reason: `no folder ${cwd}` });
  // The Codex form is to be confirmed against Codex's CLI by the settle plugin's group (task 3.5):
  // it may need the rollout path instead of the thread id.
  const [command, args] =
    agent === "claude"
      ? (["claude", ["-p", "--resume", nativeId, text]] as const)
      : (["codex", ["exec", "resume", nativeId, text]] as const);
  return new Promise((resolve) => {
    const child = NodeChildProcess.execFile(
      command,
      [...args],
      {
        cwd,
        timeout: options.timeoutMs,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, PATH: searchPath().join(NodePath.delimiter) },
      },
      (error, _stdout, stderr) => {
        const tail = stderr.trim().slice(-RESUME_STDERR_MAX);
        const printed = tail === "" ? {} : { stderr: tail };
        if (error === null) return resolve({ status: "ended", exit: 0, ...printed });
        const code = error.code;
        // Killed with no code of its own is the timeout; an output overflow carries a code.
        if (error.killed === true && (code === null || code === undefined))
          return resolve({ status: "timeout", exit: null, reason: "timed out", ...printed });
        resolve(
          typeof code === "number"
            ? { status: "failed", exit: code, reason: `exited with ${code}`, ...printed }
            : {
                status: "failed",
                exit: null,
                reason: code === "ENOENT" ? `${command} not found` : error.message,
                ...printed,
              },
        );
      },
    );
    // Both CLIs read a piped stdin as more prompt; an open one would keep them waiting.
    child.stdin?.end();
  });
}
