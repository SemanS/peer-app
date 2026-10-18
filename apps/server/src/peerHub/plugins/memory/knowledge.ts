// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off - reads exact Git objects and stages human-kept proposals; the JSON text is only the input of a content hash.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodePath from "node:path";

import type {
  PeerHubMemoryImportKnowledgeInput,
  PeerMemoryCommand,
  PeerMemoryRecord,
  PeerMemoryApplicability,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { checkoutKind, runJj } from "../../core/vcs.ts";
import { isSafeGitRef } from "../../gitSafety.ts";
import { KontextClient, kontextApi, type KontextEntry } from "../../kontext.ts";
import { MemoryError } from "./MemoryTransport.ts";

/** A kontext failure: its own message, or `fallback` when it has none. */
const failed = (code: "invalid" | "local", fallback: string) => (cause: unknown) =>
  new MemoryError({ code, detail: cause instanceof Error ? cause.message : fallback, cause });
const hash = (text: string) => NodeCrypto.createHash("sha256").update(text).digest("hex");
const git = (root: string, args: ReadonlyArray<string>) =>
  Effect.tryPromise({
    try: () =>
      new Promise<string>((resolve, reject) => {
        NodeChildProcess.execFile(
          "git",
          ["-C", root, ...args],
          {
            timeout: 15_000,
            maxBuffer: 2 * 1024 * 1024,
            env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
          },
          (error, stdout) => (error === null ? resolve(stdout) : reject(error)),
        );
      }),
    catch: (cause) =>
      new MemoryError({
        code: "invalid",
        detail: "The configured Git review source could not be verified.",
        cause,
      }),
  });
export const approvedRevision = (root: string, branch: string) =>
  isSafeGitRef(branch)
    ? git(root, ["rev-parse", "--verify", `refs/remotes/origin/${branch}^{commit}`]).pipe(
        Effect.map((value) => value.trim()),
      )
    : Effect.fail(
        new MemoryError({
          code: "invalid",
          detail: "The repository's configured review branch is invalid.",
        }),
      );

export const importCommands = Effect.fn("MemoryKnowledge.importCommands")(function* (
  repository: { readonly root: string; readonly branch: string },
  input: PeerHubMemoryImportKnowledgeInput,
) {
  if (
    !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(input.commit) ||
    !isSafeGitRef(repository.branch) ||
    input.reviewRef !== repository.branch
  )
    return yield* new MemoryError({
      code: "invalid",
      detail:
        "Import needs a full committed revision and the repository's configured reviewed branch.",
    });
  const client = yield* KontextClient;
  const exported = yield* Effect.tryPromise({
    try: () =>
      kontextApi<{
        entries: Array<{
          entry: KontextEntry;
          revision: string;
          blob_hash: string;
          markdown: string;
        }>;
      }>(client, repository.root, "entries.export", {
        revision: input.commit,
        review_ref: `refs/remotes/origin/${repository.branch}`,
        ...(input.paths === undefined ? {} : { paths: input.paths }),
      }),
    catch: failed("invalid", "The reviewed knowledge could not be verified by kontext."),
  });
  const commands: PeerMemoryCommand[] = exported.entries.map(
    ({ entry, revision, blob_hash, markdown }) => ({
      schemaVersion: 1,
      operationId: `knowledge:${hash(`${input.workspace}/${input.project}/${input.repositoryId}/${revision}/${entry.file}/${blob_hash}`)}`,
      type: "knowledge.import",
      title: entry.title,
      text: markdown,
      knowledgeId: entry.id,
      reviewRef: input.reviewRef,
      source: {
        kind: "knowledge",
        repositoryId: input.repositoryId,
        revision,
        path: entry.file,
        blobHash: blob_hash,
        weak: false,
      },
    }),
  );
  return commands;
});

export const keep = Effect.fn("MemoryKnowledge.keep")(function* (
  root: string,
  record: PeerMemoryRecord,
  requestedPath?: string,
) {
  const client = yield* KontextClient;
  const staged = yield* Effect.tryPromise({
    try: () =>
      kontextApi<{ path: string }>(client, root, "drafts.stage", {
        operation_id: `peer:memory:${hash(`${record.workspaceId}/${record.projectId}/${record.id}@${record.version}`)}`,
        fingerprint: hash(
          JSON.stringify({
            id: record.id,
            version: record.version,
            title: record.title,
            text: record.text,
            contentHash: record.contentHash,
            requestedPath,
          }),
        ),
        entry: {
          id: `peer-memory-${record.id}`,
          ...(requestedPath === undefined ? { kind: "learning" } : {}),
          title: record.title,
          body: `${record.text}\n\nKept in Peer pending Git review. This draft is not approved project knowledge.`,
          status: "proposed",
          extra: {
            memory: `${record.id}@${record.version}`,
            memory_content_hash: record.contentHash,
          },
        },
        source: `peer://memory/${encodeURIComponent(record.workspaceId)}/${encodeURIComponent(record.projectId)}/${encodeURIComponent(record.id)}@${record.version}`,
        ...(requestedPath === undefined ? {} : { requested_path: requestedPath }),
      }),
    catch: failed("local", "The knowledge draft could not be staged by kontext."),
  });
  return { path: staged.path };
});

/** Git's `HEAD`, diff and status; under jj `@`, edits snapshotted in, dirty only on a conflict (D8). */
const JJ_AT = ["log", "-r", "@", "--no-graph", "-T", 'commit_id ++ " " ++ conflict'];
const head = Effect.fn("MemoryKnowledge.head")(function* (dir: string) {
  const found = yield* Effect.promise(() => checkoutKind(dir));
  const read = (args: ReadonlyArray<string>) => git(dir, args).pipe(Effect.option);
  if (found?.kind !== "jj")
    return { root: dir, revision: yield* read(["rev-parse", "--verify", "HEAD"]), dirt: read };
  const at = yield* Effect.promise(() => runJj(dir, JJ_AT).catch(() => ""));
  const [id = "", conflict] = at.trim().split(" ");
  const dirt = Effect.succeed(Option.some(conflict === "true" ? "conflict" : ""));
  const revision = Option.filter(Option.some(id), Boolean);
  return { root: found.mainRoot, revision, dirt: () => dirt };
});

export const gitEvidence = Effect.fn("MemoryKnowledge.gitEvidence")(function* (
  session: { readonly root: string; readonly repositoryId?: string },
  location: string,
) {
  const match = /^(.*?)(?::(\d+)(?:-(\d+))?)?$/.exec(location);
  const path = match?.[1] ?? location;
  if (NodePath.isAbsolute(path) || path.split(/[\\/]/).includes("..") || /[\0\r\n]/.test(path))
    return yield* new MemoryError({
      code: "invalid",
      detail: "Evidence must identify a file inside this repository.",
    });
  const { root, revision, dirt } = yield* head(session.root);
  const blob = Option.isSome(revision)
    ? yield* git(root, ["rev-parse", `${revision.value.trim()}:${path}`]).pipe(Effect.option)
    : Option.none<string>();
  const diff = yield* dirt(["diff", "HEAD", "--", path]);
  const dirty = Option.isSome(diff) && diff.value !== "";
  return {
    kind: "code" as const,
    path,
    ...(session.repositoryId === undefined ? {} : { repositoryId: session.repositoryId }),
    ...(Option.isSome(revision) ? { revision: revision.value.trim() } : {}),
    ...(Option.isSome(blob) ? { blobHash: blob.value.trim() } : {}),
    ...(match?.[2] === undefined ? {} : { startLine: Number(match[2]) }),
    ...(match?.[3] === undefined ? {} : { endLine: Number(match[3]) }),
    ...(dirty && Option.isSome(revision)
      ? {
          baseRevision: revision.value.trim(),
          diffHash: hash(diff.value),
          environment: "dirty checkout",
        }
      : {}),
    weak:
      Option.isNone(revision) || Option.isNone(blob) || session.repositoryId === undefined || dirty,
  };
});

/** Applicability identifies the exact clean commit or the observed dirty checkout. */
export const gitApplicability = Effect.fn("MemoryKnowledge.gitApplicability")(function* (session: {
  readonly root: string;
  readonly repositoryId?: string;
}) {
  const { revision, dirt } = yield* head(session.root);
  const diff = yield* dirt(["diff", "HEAD"]);
  const status = yield* dirt(["status", "--porcelain=v1"]);
  const dirty = Option.isSome(status) && status.value !== "";
  const applicability: PeerMemoryApplicability = {
    ...(session.repositoryId === undefined ? {} : { repositoryId: session.repositoryId }),
    ...(Option.isNone(revision)
      ? {}
      : dirty
        ? {
            baseRevision: revision.value.trim(),
            diffHash: hash(`${Option.isSome(diff) ? diff.value : ""}\n${status.value}`),
            environment: "dirty checkout",
          }
        : { revision: revision.value.trim() }),
  };
  return applicability;
});
