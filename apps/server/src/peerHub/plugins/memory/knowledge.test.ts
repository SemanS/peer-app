// @effect-diagnostics nodeBuiltinImport:off - isolated committed Git objects and pending drafts.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "@effect/vitest";
import type { PeerMemoryRecord } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { KontextClient } from "../../kontext.ts";
import * as Knowledge from "./knowledge.ts";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => NodeFSP.rm(directory, { recursive: true, force: true })),
  );
});
const git = (root: string, ...args: string[]) =>
  new Promise<string>((resolve, reject) =>
    NodeChildProcess.execFile(
      "git",
      ["-C", root, ...args],
      { env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" } },
      (error, output) => (error === null ? resolve(output.trim()) : reject(error)),
    ),
  );
const jj = (root: string, ...args: string[]) =>
  new Promise<string>((resolve, reject) =>
    NodeChildProcess.execFile(
      "jj",
      ["--no-pager", "--color=never", "--quiet", ...args],
      { cwd: root, env: { ...process.env, JJ_USER: "Memory test", JJ_EMAIL: "test@acme.test" } },
      (error, output) => (error === null ? resolve(output.trim()) : reject(error)),
    ),
  );
const at = (root: string) => jj(root, "log", "-r", "@", "--no-graph", "-T", "commit_id");
const fixture = async (fields = false) => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "peer-memory-git-"));
  directories.push(root);
  await git(root, "init", "-b", "main");
  await git(root, "config", "user.name", "Memory test");
  await git(root, "config", "user.email", "test@acme.test");
  const path = fields ? "docs/adr/dates.md" : ".ai/decisions/dates.md";
  await NodeFSP.mkdir(NodePath.dirname(NodePath.join(root, path)), { recursive: true });
  const source = fields
    ? "# Hotel-local dates\n\n**Status:** accepted\n\nUse the approved hotel timezone.\n"
    : "---\nid: dates\nkind: decision\ntitle: Hotel-local dates\nstatus: accepted\n---\nUse the approved hotel timezone.\n";
  await NodeFSP.writeFile(
    NodePath.join(root, ".kontext.toml"),
    "[init]\nllm='unavailable-test-model'\n" +
      (fields
        ? "[store.kinds.decision]\npath='docs/adr'\nstyle='fields'\nnumbering='sequential'\n"
        : ""),
  );
  await NodeFSP.writeFile(NodePath.join(root, path), source);
  await git(root, "add", "--", path, ".kontext.toml");
  await git(root, "commit", "-m", "Approved decision fixture");
  const commit = await git(root, "rev-parse", "HEAD");
  await git(root, "update-ref", "refs/remotes/origin/main", commit);
  return {
    root,
    path,
    source,
    commit,
    input: { workspace: "acme", project: "app", repositoryId: "repo", commit, reviewRef: "main" },
  };
};

const memoryRecord = (): PeerMemoryRecord => ({
  id: "assertion-dates",
  version: 2,
  schemaVersion: 1,
  workspaceId: "acme",
  projectId: "app",
  kind: "assertion",
  title: "Dates finding",
  text: "Date handling needs a timezone.",
  aliases: [],
  createdBy: { email: "ana@acme.test" },
  createdAt: "2026-10-06T09:00:00Z",
  knownAt: "2026-10-06T09:00:00Z",
  recordedAt: "2026-10-06T09:00:00Z",
  applicability: {},
  sourceRefs: [],
  derivedFrom: [],
  operationId: "test-op",
  contentHash: "test-hash",
  lifecycle: "active",
  grounding: "proposed",
  independence: "unknown",
  evidenceIds: [],
  evidenceMissing: true,
});

describe.skipIf(!process.env.KONTEXT_BIN)("Peer memory configured Git review", () => {
  it.effect("imports the exact reviewed full blob and ignores uncommitted changes", () =>
    Effect.gen(function* () {
      const test = yield* Effect.promise(() => fixture());
      yield* Effect.promise(() =>
        NodeFSP.writeFile(
          NodePath.join(test.root, test.path),
          `${test.source}\nUnreviewed local change.\n`,
        ),
      );
      const first = yield* Knowledge.importCommands(
        { root: test.root, branch: "main" },
        test.input,
      );
      const second = yield* Knowledge.importCommands(
        { root: test.root, branch: "main" },
        test.input,
      );
      expect(first).toEqual(second);
      expect(first).toHaveLength(1);
      const command = first[0];
      expect(command?.type).toBe("knowledge.import");
      if (command?.type !== "knowledge.import") return;
      expect(command.text).toBe(test.source);
      expect(command.source.revision).toBe(test.commit);
      expect(command.source.blobHash).toBe(
        yield* Effect.promise(() => git(test.root, "rev-parse", `${test.commit}:${test.path}`)),
      );
      expect(command.text).not.toContain("Unreviewed local change");
    }),
  );

  it.effect("rejects stale branch tips and never imports committed proposed decisions", () =>
    Effect.gen(function* () {
      const test = yield* Effect.promise(() => fixture());
      yield* Effect.promise(() =>
        NodeFSP.writeFile(
          NodePath.join(test.root, test.path),
          test.source.replace("status: accepted", "status: proposed"),
        ),
      );
      yield* Effect.promise(() => git(test.root, "add", "--", test.path));
      yield* Effect.promise(() => git(test.root, "commit", "-m", "Draft fixture"));
      const current = yield* Effect.promise(() => git(test.root, "rev-parse", "HEAD"));
      yield* Effect.promise(() =>
        git(test.root, "update-ref", "refs/remotes/origin/main", current),
      );
      const stale = yield* Knowledge.importCommands(
        { root: test.root, branch: "main" },
        test.input,
      ).pipe(Effect.result);
      expect(stale._tag).toBe("Failure");
      const drafted = yield* Knowledge.importCommands(
        { root: test.root, branch: "main" },
        { ...test.input, commit: current },
      );
      expect(drafted).toEqual([]);
    }),
  );

  it.effect(
    "stages Keep as a proposed draft without committing or granting approved authority",
    () =>
      Effect.gen(function* () {
        const test = yield* Effect.promise(() => fixture());
        const record = memoryRecord();
        const draft = yield* Knowledge.keep(test.root, record);
        expect(yield* Effect.promise(() => git(test.root, "rev-parse", "HEAD"))).toBe(test.commit);
        const staged = yield* Effect.promise(() => git(test.root, "show", `:${draft.path}`));
        expect(staged).toContain("status: proposed");
        expect(staged).toContain("kind: learning");
        expect(staged).toContain("pending Git review");
        const imports = yield* Knowledge.importCommands(
          { root: test.root, branch: "main" },
          test.input,
        );
        expect(imports).toHaveLength(1);
        const outside = NodePath.join(test.root, "outside.md");
        yield* Effect.promise(() => NodeFSP.writeFile(outside, "Outside content"));
        yield* Effect.promise(() =>
          NodeFSP.symlink(outside, NodePath.join(test.root, ".ai", "learnings", "linked.md")),
        );
        const linked = yield* Knowledge.keep(
          test.root,
          { ...record, id: "assertion-linked" },
          ".ai/learnings/linked.md",
        ).pipe(Effect.result);
        expect(linked._tag).toBe("Failure");
        expect(yield* Effect.promise(() => NodeFSP.readFile(outside, "utf8"))).toBe(
          "Outside content",
        );
      }),
  );

  it.effect("supports configured ADR paths for Keep and reviewed imports", () =>
    Effect.gen(function* () {
      const test = yield* Effect.promise(() => fixture(true));
      const kept = yield* Knowledge.keep(test.root, memoryRecord(), "docs/adr/kept-finding.md");
      expect(kept.path).toBe("docs/adr/kept-finding.md");
      const markdown = yield* Effect.promise(() =>
        NodeFSP.readFile(NodePath.join(test.root, kept.path), "utf8"),
      );
      expect(markdown).toContain("**Status:** proposed");
      expect(markdown).toContain("peer-memory-assertion-dates");
      const imports = yield* Knowledge.importCommands(
        { root: test.root, branch: "main" },
        test.input,
      );
      expect(imports).toHaveLength(1);
      expect(imports[0]?.type === "knowledge.import" ? imports[0].text : undefined).toBe(
        test.source,
      );
    }),
  );
});

describe("Memory code evidence without a knowledge engine", () => {
  it.effect(
    "binds clean evidence to a Git blob and labels dirty observations as weak with a diff hash",
    () =>
      Effect.gen(function* () {
        const test = yield* Effect.promise(() => fixture());
        const session = { root: test.root, repositoryId: "repo" };
        const clean = yield* Knowledge.gitEvidence(session, `${test.path}:6`);
        expect(clean.weak).toBe(false);
        expect(clean.revision).toBe(test.commit);
        yield* Effect.promise(() =>
          NodeFSP.writeFile(
            NodePath.join(test.root, test.path),
            `${test.source}\nObserved dirty change\n`,
          ),
        );
        const dirty = yield* Knowledge.gitEvidence(session, `${test.path}:7`);
        expect(dirty.weak).toBe(true);
        expect(dirty.baseRevision).toBe(test.commit);
        expect(dirty.diffHash).toMatch(/^[a-f0-9]{64}$/);
        const applicability = yield* Knowledge.gitApplicability(session);
        expect(applicability.baseRevision).toBe(test.commit);
        expect(applicability.environment).toBe("dirty checkout");
      }),
  );
  it.effect(
    "names the commit of jj's working-copy change, whose edits are not dirt, and calls a conflict dirty",
    () =>
      Effect.gen(function* () {
        const test = yield* Effect.promise(() => fixture());
        const session = { root: test.root, repositoryId: "repo" };
        const file = NodePath.join(test.root, test.path);
        yield* Effect.promise(async () => {
          await jj(test.root, "git", "init", "--colocate");
          await NodeFSP.writeFile(file, `${test.source}\nWork in the working copy\n`);
        });
        const edited = yield* Knowledge.gitEvidence(session, `${test.path}:7`);
        const commit = yield* Effect.promise(() => at(test.root));
        expect(commit).not.toBe(test.commit);
        expect(edited).toMatchObject({ revision: commit, weak: false });
        expect(edited.environment).toBeUndefined();
        expect(yield* Knowledge.gitApplicability(session)).toEqual({
          repositoryId: "repo",
          revision: commit,
        });
        // Two siblings change the same line; a working copy on both is conflicted.
        const sides = yield* Effect.promise(async () => {
          const ids: string[] = [];
          for (const side of ["A", "B"]) {
            await jj(test.root, "new", test.commit);
            await NodeFSP.writeFile(file, test.source.replace("approved", side));
            ids.push(await at(test.root));
          }
          return ids;
        });
        yield* Effect.promise(() => jj(test.root, "new", ...sides));
        const conflicted = yield* Knowledge.gitEvidence(session, `${test.path}:6`);
        expect(conflicted).toMatchObject({
          revision: yield* Effect.promise(() => at(test.root)),
          environment: "dirty checkout",
          weak: true,
        });
        expect((yield* Knowledge.gitApplicability(session)).environment).toBe("dirty checkout");
      }),
  );
  it.effect("surfaces an engine privacy rejection without claiming a kept draft", () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "peer-memory-rejected-")),
      );
      directories.push(root);
      const result = yield* Knowledge.keep(root, memoryRecord()).pipe(
        Effect.provideService(KontextClient, {
          run: async () => ({
            code: 1,
            stdout: JSON.stringify({
              schema_version: 1,
              ok: false,
              error: { code: "private_entry", message: "Private knowledge cannot be staged" },
            }),
            stderr: "",
          }),
        }),
        Effect.result,
      );
      expect(result._tag).toBe("Failure");
      expect(yield* Effect.promise(() => NodeFSP.readdir(root))).toEqual([]);
    }),
  );
});
