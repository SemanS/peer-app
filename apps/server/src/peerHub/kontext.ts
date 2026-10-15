// @effect-diagnostics nodeBuiltinImport:off globalTimers:off - invokes the standalone kontext engine.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeSea from "node:sea";

import * as Context from "effect/Context";

import { modelEnv } from "./core/local.ts";
import { block, plain } from "./peerText.ts";
import type { KnowledgeEntry } from "./knowledgeEntry.ts";

export interface KontextRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface KontextClientShape {
  readonly run: (
    args: ReadonlyArray<string>,
    cwd: string,
    stdin?: string,
    timeoutMs?: number,
  ) => Promise<KontextRun>;
}

/** CLI archives, including the Linux runtime installed into WSL, keep the engine beside the SEA executable. */
export function resolveKontextBinary(input: {
  readonly override: string | undefined;
  readonly executablePath: string;
  readonly isExecutable: boolean;
  readonly exists: (path: string) => boolean;
}): string {
  if (input.override !== undefined && input.override !== "") return input.override;
  if (input.isExecutable) {
    const candidate = NodePath.join(
      NodePath.dirname(input.executablePath),
      "kontext",
      input.executablePath.endsWith(".exe") ? "kontext.exe" : "kontext",
    );
    if (input.exists(candidate)) return candidate;
  }
  return "kontext";
}

/** A configured compatible engine, or kontext on PATH; GUI and headless servers use the same protocol. */
export function runKontext(
  args: ReadonlyArray<string>,
  cwd: string,
  stdin?: string,
  timeoutMs = 600_000,
): Promise<KontextRun> {
  return new Promise((resolve) => {
    const child = NodeChildProcess.spawn(
      resolveKontextBinary({
        override: process.env.KONTEXT_BIN,
        executablePath: process.execPath,
        isExecutable: NodeSea.isSea(),
        exists: NodeFS.existsSync,
      }),
      [...args],
      {
        cwd,
        env: modelEnv(),
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    let bytes = 0;
    let failure: string | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const finish = (code: number, detail = failure ?? stderr) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer !== undefined) clearTimeout(killTimer);
      resolve({ code, stdout, stderr: detail });
    };
    const fail = (message: string) => {
      if (failure !== undefined) return;
      failure = message;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        child.kill("SIGKILL");
        finish(-1);
      }, 1000);
    };
    const timer = setTimeout(() => fail("kontext timed out"), timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (failure !== undefined) return;
      bytes += Buffer.byteLength(chunk);
      if (bytes > 256 * 1024 * 1024) fail("kontext response exceeds 256 MiB");
      else stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      if (failure === undefined) stderr = (stderr + chunk).slice(-64 * 1024);
    });
    child.on("error", (error) => finish(-1, error.message));
    child.on("close", (code) => finish(failure === undefined ? (code ?? -1) : -1));
    child.stdin.on("error", () => undefined);
    child.stdin.end(stdin ?? "");
  });
}

export class KontextClient extends Context.Reference<KontextClientShape>(
  "t3/peerHub/KontextClient",
  { defaultValue: () => ({ run: runKontext }) },
) {}

export class KontextApiError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "KontextApiError";
    this.code = code;
  }
}

/** Only the versioned JSON envelope is a contract; stderr and legacy CLI prose never imply success. */
export async function kontextApi<A = unknown>(
  client: KontextClientShape,
  root: string,
  operation: string,
  input: unknown = {},
  timeoutMs?: number,
): Promise<A> {
  const run = await client.run(
    ["-C", root, "api", operation, "-"],
    root,
    JSON.stringify(input),
    timeoutMs ??
      (["drafts.extract", "drafts.formalize", "guidance.propose"].includes(operation)
        ? 600_000
        : ["setup", "drafts.stage"].includes(operation)
          ? 60_000
          : 15_000),
  );
  let envelope: {
    schema_version?: unknown;
    ok?: unknown;
    result?: A;
    error?: { code?: unknown; message?: unknown };
  };
  try {
    envelope = JSON.parse(run.stdout);
  } catch {
    throw new KontextApiError(
      "incompatible",
      `kontext machine API v1 is required. Install a compatible kontext or set KONTEXT_BIN. ${run.stderr.trim()}`.trim(),
    );
  }
  if (envelope?.schema_version !== 1 || typeof envelope.ok !== "boolean")
    throw new KontextApiError(
      "incompatible",
      "kontext machine API v1 is required. Install a compatible kontext or set KONTEXT_BIN.",
    );
  if (!envelope.ok)
    throw new KontextApiError(
      typeof envelope.error?.code === "string" ? envelope.error.code : "failed",
      typeof envelope.error?.message === "string"
        ? envelope.error.message
        : "kontext operation failed",
    );
  if (run.code !== 0)
    throw new KontextApiError("failed", run.stderr.trim() || `kontext exited ${run.code}`);
  if (!("result" in envelope))
    throw new KontextApiError("incompatible", "kontext machine API response has no result");
  return envelope.result as A;
}

export interface KontextEntry extends Omit<KnowledgeEntry, "status" | "date"> {
  readonly status?: string | null;
  readonly date?: string | null;
  readonly markdown: string;
  readonly extra?: Readonly<Record<string, unknown>>;
}

/** IDs appear in unquoted agent commands, so omit records whose identity cannot be represented safely. */
export const isKnowledgeIdentity = (id: string): boolean =>
  typeof id === "string" && /^[\p{L}\p{N}_.:-]{1,160}$/u.test(id);

export const asKnowledge = (entry: KontextEntry): KnowledgeEntry => ({
  ...entry,
  kind: plain(entry.kind, 40),
  ...(entry.publication === undefined
    ? {}
    : { publication: { state: plain(entry.publication.state, 40) } }),
  title: plain(entry.title, 200),
  file: plain(entry.file, 512),
  summary: plain(entry.summary, 400),
  body: block(entry.body, 6000),
  tags: entry.tags.slice(0, 12).map((tag) => plain(tag, 40)),
  status: entry.status == null ? undefined : plain(entry.status, 40),
  date: /^\d{4}-\d{2}-\d{2}/.exec(entry.date ?? "")?.[0],
});

export interface KontextStatus {
  readonly api_version: number;
  readonly version: string;
  readonly store: { readonly configured: boolean; readonly dir: string };
  readonly capabilities: ReadonlyArray<string>;
  readonly llm: { readonly available: boolean };
}

export const engineStatus = async (
  client: KontextClientShape,
  root: string,
): Promise<KontextStatus> => {
  const status = await kontextApi<KontextStatus>(client, root, "status", {}, 15_000);
  if (status.api_version !== 1 || !Array.isArray(status.capabilities))
    throw new KontextApiError("incompatible", "kontext machine API v1 is required");
  return status;
};
