// @effect-diagnostics nodeBuiltinImport:off globalTimers:off - bounded native process adapter.
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import { searchPath } from "../../../core/local.ts";
export type Runner = (
  binary: string,
  args: ReadonlyArray<string>,
  root: string,
  options?: { timeoutMs?: number; cap?: number; signal?: AbortSignal | undefined },
) => Promise<string>;
/** Own the spawned PID; both deadline and interruption terminate it, including ignored SIGTERM. */
export const runProcess: Runner = (binary, args, root, options = {}) =>
  new Promise((resolve, reject) => {
    const child = NodeChildProcess.spawn(binary, [...args], {
      cwd: root,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        PATH: searchPath().join(NodePath.delimiter),
        HOME: process.env.HOME,
        LANG: "C.UTF-8",
        GIT_TERMINAL_PROMPT: "0",
        GIT_NO_LAZY_FETCH: "1",
        GIT_OPTIONAL_LOCKS: "0",
        GIT_CONFIG_COUNT: "0",
      },
    });
    const output: Buffer[] = [],
      errors: Buffer[] = [];
    let bytes = 0,
      failure: Error | undefined,
      kill: ReturnType<typeof setTimeout> | undefined;
    const stop = (reason: string) => {
      failure ??= new Error(reason);
      child.kill("SIGTERM");
      kill ??= setTimeout(() => child.kill("SIGKILL"), 100);
    };
    const timer = setTimeout(() => stop("process deadline"), options.timeoutMs ?? 2_000),
      abort = () => stop("process interrupted");
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    const collect = (buffer: Buffer, list: Buffer[]) => {
      bytes += buffer.length;
      if (bytes > (options.cap ?? 1024 * 1024)) stop("process output limit");
      else list.push(buffer);
    };
    child.stdout.on("data", (v: Buffer) => collect(v, output));
    child.stderr.on("data", (v: Buffer) => collect(v, errors));
    child.on("error", (error) => {
      failure = error;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (kill) clearTimeout(kill);
      options.signal?.removeEventListener("abort", abort);
      if (failure || code !== 0) reject(failure ?? new Error(`process exited ${code}`));
      else {
        try {
          resolve(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(output)));
        } catch {
          reject(new Error("invalid process encoding"));
        }
      }
    });
  });
