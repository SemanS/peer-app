// @effect-diagnostics nodeBuiltinImport:off globalTimers:off - invokes the standalone kontext engine.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
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
  /** Older codes kontext lists for the same condition (`error.aliases`, kontext 0.10.0). */
  readonly aliases: ReadonlyArray<string>;
  /** kontext's machine fields next to `code` and `message` (`untrusted_verify` names the command). */
  readonly details: Readonly<Record<string, unknown>>;
  constructor(
    code: string,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
    aliases: ReadonlyArray<string> = [],
  ) {
    super(message);
    this.name = "KontextApiError";
    this.code = code;
    this.details = details;
    this.aliases = aliases;
  }
  /** Whether kontext raised `code`, now or under an older name. */
  is(code: string): boolean {
    return this.code === code || this.aliases.includes(code);
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
      (["drafts.extract", "drafts.formalize", "drafts.revise", "guidance.propose"].includes(
        operation,
      )
        ? 600_000
        : ["setup", "drafts.stage", "drafts.retire"].includes(operation)
          ? 60_000
          : 15_000),
  );
  let envelope: {
    schema_version?: unknown;
    ok?: unknown;
    result?: A;
    error?: { code?: unknown; message?: unknown; aliases?: unknown } & Record<string, unknown>;
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
  if (!envelope.ok) {
    const { code, message, aliases, ...details } = envelope.error ?? {};
    throw new KontextApiError(
      typeof code === "string" ? code : "failed",
      typeof message === "string" ? message : "kontext operation failed",
      details,
      Array.isArray(aliases) ? aliases.filter((a): a is string => typeof a === "string") : [],
    );
  }
  if (run.code !== 0)
    throw new KontextApiError("failed", run.stderr.trim() || `kontext exited ${run.code}`);
  if (!("result" in envelope))
    throw new KontextApiError("incompatible", "kontext machine API response has no result");
  return envelope.result as A;
}

export interface KontextEntry extends Omit<
  KnowledgeEntry,
  "status" | "date" | "checked" | "verification" | "since" | "verify" | "premises"
> {
  readonly status?: string | null;
  readonly date?: string | null;
  readonly checked?: string | null;
  /** kontext's verification ledger (`verification`, `since`, `verify`, `premises`), as it sent them. */
  readonly verification?: unknown;
  /** The newest verifying look (kontext 0.10.0 `last_verified`); absent from older engines. */
  readonly last_verified?: unknown;
  readonly since?: unknown;
  readonly verify?: unknown;
  readonly premises?: unknown;
  readonly markdown: string;
  readonly extra?: Readonly<Record<string, unknown>>;
}

/** IDs appear in unquoted agent commands, so omit records whose identity cannot be represented safely. */
export const isKnowledgeIdentity = (id: string): boolean =>
  typeof id === "string" && /^[\p{L}\p{N}_.:-]{1,160}$/u.test(id);

// `cache` (kontext 0.10.0): a `checked:` date in the file with no ledger line behind it, never a verification.
const VERIFICATION_KINDS = ["read", "agent", "bulk", "verify", "cache"] as const;
const record = (value: unknown): Readonly<Record<string, unknown>> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
/** A commit id as Git prints it; anything else is no commit. */
export const commitId = (value: unknown): string | null =>
  typeof value === "string" && /^[0-9a-f]{7,64}$/i.test(value) ? value.toLowerCase() : null;
const line = (value: unknown, max: number): string | null => {
  const text = typeof value === "string" ? plain(value, max) : "";
  return text === "" ? null : text;
};
/** A repository-relative path, never one that leaves the repository. */
const repoPath = (value: unknown): string | null => {
  const path = line(value, 300);
  return path === null ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").includes("..")
    ? null
    : path;
};

/** kontext's `verification` of an entry, sanitised; undefined for one without a known kind and time. */
export function verificationOf(raw: unknown): KnowledgeEntry["verification"] {
  const value = record(raw);
  const kind = VERIFICATION_KINDS.find((known) => known === value?.kind);
  const at = line(value?.at, 40);
  if (value === null || kind === undefined || at === null) return undefined;
  return {
    at,
    kind,
    commit: commitId(value.commit),
    by: line(value.by, 120),
    because: line(value.because, 300),
    passed: typeof value.passed === "boolean" ? value.passed : null,
    // Only a kontext that says where the line landed has the key; null is "staged, not committed".
    ...("landed" in value ? { landed: commitId(value.landed) } : {}),
  };
}

/** kontext's `last_verified` of an entry (0.10.0): a person's read or a passed check; undefined otherwise. */
export function lastVerifiedOf(raw: unknown): KnowledgeEntry["lastVerified"] {
  const value = record(raw);
  const kind = value?.kind === "read" || value?.kind === "verify" ? value.kind : undefined;
  const at = line(value?.at, 40);
  if (value === null || kind === undefined || at === null) return undefined;
  return {
    kind,
    at,
    commit: commitId(value.commit),
    ...("landed" in value ? { landed: commitId(value.landed) } : {}),
  };
}

/** kontext's `since` of an entry: a count of commits, the head, at most 20 changed paths. */
export function sinceOf(raw: unknown): KnowledgeEntry["since"] {
  const value = record(raw);
  const commits = value?.commits;
  if (typeof commits !== "number" || !Number.isInteger(commits) || commits < 0) return undefined;
  return {
    commits,
    head: commitId(value?.head) ?? "",
    paths: (Array.isArray(value?.paths) ? value.paths : [])
      .flatMap((path: unknown) => repoPath(path) ?? [])
      .slice(0, 20),
  };
}

/** kontext's `premises`: entries it builds on that no longer stand, by a safe id. */
export function premisesOf(raw: unknown): KnowledgeEntry["premises"] {
  if (!Array.isArray(raw)) return undefined;
  return raw
    .flatMap((item: unknown) => {
      const value = record(item);
      const status = line(value?.status, 40);
      return typeof value?.id === "string" && isKnowledgeIdentity(value.id) && status !== null
        ? [{ id: value.id, status }]
        : [];
    })
    .slice(0, 20);
}

const presented = (
  entry: Omit<KontextEntry, "verification" | "last_verified" | "since" | "verify" | "premises">,
): KnowledgeEntry => ({
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
  checked: /^\d{4}-\d{2}-\d{2}/.exec(entry.checked ?? "")?.[0],
  ...(typeof entry.markdown === "string" ? { revision: entryRevision(entry.markdown) } : {}),
});

export const asKnowledge = (entry: KontextEntry): KnowledgeEntry => {
  const { verification, last_verified, since, verify, premises, ...rest } = entry;
  const verified = verificationOf(verification);
  const lastVerified = lastVerifiedOf(last_verified);
  const after = sinceOf(since);
  const command = line(verify, 500);
  const builds = premisesOf(premises);
  return {
    ...presented(rest),
    ...(verified === undefined ? {} : { verification: verified }),
    ...(lastVerified === undefined ? {} : { lastVerified }),
    ...(after === undefined ? {} : { since: after }),
    ...(command === null ? {} : { verify: command }),
    ...(builds === undefined || builds.length === 0 ? {} : { premises: builds }),
  };
};

/** An entry's revision: a digest of its file's text as kontext read it. */
export const entryRevision = (markdown: string) =>
  `md:${NodeCrypto.createHash("sha256").update(markdown).digest("hex").slice(0, 16)}`;

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
