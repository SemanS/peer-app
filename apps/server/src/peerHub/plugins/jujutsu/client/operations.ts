/**
 * The operation log (design D7): the newest operations with the changes each changed, read in one
 * `jj op log --op-diff` call, the undo that reverts one of them, and the read-only view at one.
 * jj's "Changed commits" lines are human output, so they are parsed against 0.46.0's format and a
 * block that does not parse leaves its operation's changes unread instead of guessing.
 *
 * @module peerHub/plugins/jujutsu/client/operations
 */
import type { AtOpRow, JujutsuOperation, UndoPreview } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { union } from "../config.ts";
import { bookmarkRevset, filesOf } from "./follow.ts";
import { lines, type Jj } from "./jj.ts";

/** Most operations a page lists. */
export const OPERATIONS_MAX = 50;
const READ_MS = 8_000;
const RUN_MS = 20_000;
/** The project's changes in flight: not in trunk, with the empty working copies left out. */
const IN_FLIGHT = '(mutable() ~ ::trunk()) ~ (empty() & description(exact:""))';
const SEP = "\\x1f";

const HEADER =
  '"@@OP " ++ id.short(12) ++ "\\t" ++ time.end().format("%Y-%m-%dT%H:%M:%S%:z") ++ "\\t" ++ user ++ "\\t" ++ workspace_name ++ "\\t" ++ description.first_line().escape_json() ++ "\\t" ++ attributes.escape_json() ++ "\\n"';
const CHANGED_LINE = /^[+-] ([k-z]+)(?:\/\d+)? [0-9a-f]+(?: |$)/;

const unquote = (text: string | undefined) => {
  try {
    const value: unknown = JSON.parse(text ?? '""');
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
};

export interface ParsedOperations {
  readonly operations: ReadonlyArray<JujutsuOperation>;
  /** A block of jj's output did not read as 0.46.0 prints it: its operation lists no changes. */
  readonly unread: boolean;
}

/**
 * The operations of `jj op log --no-graph --op-diff -T HEADER`: each header line, then the diff jj
 * prints under it. The changes of an operation are the change ids of its "Changed commits" lines.
 */
export function parseOperations(text: string): ParsedOperations {
  const operations: Array<JujutsuOperation> = [];
  let unread = false;
  for (const block of text.split(/^@@OP /m).slice(1)) {
    const [header = "", ...body] = block.split("\n");
    const [id, time, user, workspace, description, attributes] = header.split("\t");
    if (id === undefined || time === undefined || user === undefined) {
      unread = true;
      continue;
    }
    const at = body.indexOf("Changed commits:");
    const changed = new Set<string>();
    let readable = true;
    if (at !== -1)
      for (const line of body.slice(at + 1)) {
        if (line.trim() === "") break;
        const match = CHANGED_LINE.exec(line);
        if (match?.[1] === undefined) readable = false;
        else changed.add(match[1]);
      }
    if (!readable) unread = true;
    operations.push({
      id,
      time,
      user: user.replace(/@[^@]*$/, ""),
      ...(workspace ? { workspace } : {}),
      description: unquote(description),
      args: /^args: (.*)$/m.exec(unquote(attributes))?.[1] ?? "",
      changed: readable ? [...changed] : [],
    });
  }
  return { operations, unread };
}

/**
 * `change_id(a) | change_id(b)`: a bare id names nothing while its change has two versions, which
 * is just when converge runs, so the dialog shows this form too.
 */
const idsRevset = union;

/**
 * What undoing one operation touches: the later operations (newest first in `operations`) whose
 * changed ids intersect its own, oldest first, and the commands Peer will run. Null when the
 * operation is not among those listed.
 */
export function previewOf(parsed: ParsedOperations, operation: string): UndoPreview | null {
  const at = parsed.operations.findIndex(
    (one) => one.id.startsWith(operation) || operation.startsWith(one.id),
  );
  const step = parsed.operations[at];
  if (step === undefined) return null;
  const later = parsed.operations
    .slice(0, at)
    .filter((one) => one.changed.some((id) => step.changed.includes(id)))
    .toReversed();
  const shared = step.changed.filter((id) => later.some((one) => one.changed.includes(id)));
  return {
    operation: step,
    later,
    shared,
    commands: [
      `jj op revert ${step.id}`,
      ...(shared.length === 0 ? [] : [`jj converge --no-interactive -r ${idsRevset(shared)}`]),
    ],
    ...(parsed.unread ? { changedUnread: true } : {}),
  };
}

export const makeOperations = (jj: Jj) => {
  const divergentAmong = (repo: string, cwd: string, ids: ReadonlyArray<string>) =>
    jj
      .run(
        repo,
        cwd,
        [
          "log",
          "--no-graph",
          "-r",
          `divergent() & (${idsRevset(ids)})`,
          "-T",
          'change_id ++ "\\n"',
        ],
        { ...jj.read, timeoutMs: READ_MS },
      )
      .pipe(
        Effect.map((done) => {
          const found = done.ok ? lines(done.out) : [];
          return ids.filter((id) => found.some((one) => one.startsWith(id) || id.startsWith(one)));
        }),
      );

  /** The commit each of these changes is at (their ids as listed, which are prefixes). */
  const commitsOf = (repo: string, cwd: string, ids: ReadonlyArray<string>) =>
    ids.length === 0
      ? Effect.succeed(new Map<string, string>())
      : jj
          .run(
            repo,
            cwd,
            ["log", "--no-graph", "-r", union(ids), "-T", 'change_id ++ "\t" ++ commit_id ++ "\n"'],
            { ...jj.read, timeoutMs: READ_MS },
          )
          .pipe(
            Effect.map((done) => {
              const found = new Map<string, string>();
              for (const line of lines(done.ok ? done.out : "")) {
                const [change = "", commit = ""] = line.split("\t");
                const id = ids.find((one) => change.startsWith(one));
                if (id !== undefined && commit !== "") found.set(id, commit);
              }
              return found;
            }),
          );

  return {
    /** The newest operations, newest first, with what each changed. Null when jj did not answer. */
    list: (repo: string, cwd: string) =>
      jj
        .run(
          repo,
          cwd,
          ["op", "log", "--no-graph", "--op-diff", "--limit", String(OPERATIONS_MAX), "-T", HEADER],
          { ...jj.read, timeoutMs: READ_MS },
        )
        .pipe(Effect.map((done) => (done.ok ? parseOperations(done.out) : null))),

    /**
     * Reverts one operation, then merges the changes it shared with later steps that the revert left
     * with two versions. Answers what ran, what merged, what still has two versions, and the files
     * that changed in the `watch` changes (the ones the step touched).
     */
    undo: (
      repo: string,
      cwd: string,
      operation: string,
      shared: ReadonlyArray<string>,
      watch: ReadonlyArray<string>,
    ) =>
      Effect.gen(function* () {
        const before = yield* commitsOf(repo, cwd, watch);
        const reverted = yield* jj.run(repo, cwd, ["op", "revert", operation], {
          timeoutMs: RUN_MS,
        });
        if (!reverted.ok)
          return { ok: false as const, error: lines(reverted.err)[0] ?? "jj did not revert it" };
        const ran = [`jj op revert ${operation}`];
        const split = shared.length === 0 ? [] : yield* divergentAmong(repo, cwd, shared);
        if (split.length > 0) {
          yield* jj.run(repo, cwd, ["converge", "--no-interactive", "-r", idsRevset(split)], {
            timeoutMs: RUN_MS,
          });
          ran.push(`jj converge --no-interactive -r ${idsRevset(split)}`);
        }
        const still = split.length === 0 ? [] : yield* divergentAmong(repo, cwd, split);
        const files = new Set<string>();
        const after = yield* commitsOf(repo, cwd, watch);
        for (const [id, commit] of after) {
          const was = before.get(id);
          if (was === undefined || was === commit) continue;
          const diff = yield* jj.run(
            repo,
            cwd,
            ["interdiff", "--from", was, "--to", commit, "--git"],
            { ...jj.read, timeoutMs: READ_MS },
          );
          for (const file of filesOf(diff.out)) files.add(file.path);
        }
        return {
          ok: true as const,
          ran,
          converged: split.filter((id) => !still.includes(id)),
          needsPerson: still,
          files: [...files],
        };
      }),

    /**
     * A new change with both sides as parents, not edited and rewriting neither, and the bookmark
     * `peer/integrate/<K1>-<K2>` on it. A side is a change id or a bookmark. Answers the new change
     * id and the bookmark, or jj's first line when it refused.
     */
    integrate: (
      repo: string,
      cwd: string,
      input: { revs: readonly [string, string]; keys: ReadonlyArray<string> },
    ) =>
      Effect.gen(function* () {
        const [k1, k2] = input.keys.map((key) => key.replace(/[^A-Za-z0-9._-]+/g, "-"));
        const bookmark = `peer/integrate/${k1}-${k2}`;
        const revset = (rev: string) =>
          /^[k-z]{4,}$/.test(rev) ? `change_id(${rev})` : bookmarkRevset(rev);
        // jj says which change it made only without `--quiet`.
        const made = yield* jj.run(
          repo,
          cwd,
          ["new", "--no-edit", ...input.revs.map(revset), "-m", `Integrate ${k1} + ${k2}`],
          { timeoutMs: RUN_MS, loud: true },
        );
        const change = /Created new commit (\S+)/.exec(made.err)?.[1];
        if (!made.ok || change === undefined)
          return { ok: false as const, error: lines(made.err)[0] ?? "jj did not make the change" };
        const named = yield* jj.run(
          repo,
          cwd,
          ["bookmark", "set", bookmark, "-r", union([change]), "--allow-backwards"],
          { timeoutMs: RUN_MS },
        );
        return named.ok
          ? { ok: true as const, change, bookmark }
          : { ok: false as const, error: lines(named.err)[0] ?? "jj did not set the bookmark" };
      }),

    /** The root of a named jj workspace, `null` when it is gone. */
    rootOf: (repo: string, cwd: string, name: string) =>
      jj
        .run(repo, cwd, ["workspace", "root", "--name", name], { ...jj.read, timeoutMs: READ_MS })
        .pipe(Effect.map((done) => (done.ok ? (lines(done.out)[0] ?? null) : null))),

    /** The project's changes in flight as they were right after one operation, read-only. */
    at: (repo: string, cwd: string, operation: string) =>
      jj
        .run(
          repo,
          cwd,
          [
            "log",
            "--at-op",
            operation,
            "--no-graph",
            "-r",
            IN_FLIGHT,
            "-T",
            `change_id.short(8) ++ if(divergent, "/" ++ change_offset, "") ++ "\\t" ++ commit_id ++ "\\t" ++ parents.map(|p| p.change_id().short(8)).join("${SEP}") ++ "\\t" ++ description.first_line().escape_json() ++ "\\t" ++ diff.files().map(|f| f.path().display()).join("${SEP}") ++ "\\t" ++ bookmarks.join("${SEP}") ++ "\\t" ++ if(conflict, "1", "0") ++ if(empty, "1", "0") ++ if(divergent, "1", "0") ++ "\\n"`,
          ],
          { ...jj.read, timeoutMs: READ_MS },
        )
        .pipe(
          Effect.map((done): ReadonlyArray<AtOpRow> | null =>
            done.ok
              ? lines(done.out).flatMap((line) => {
                  const [changeId, commitId, parents, subject, paths, bookmarks, flags] =
                    line.split("\t");
                  if (changeId === undefined || commitId === undefined || flags === undefined)
                    return [];
                  const list = (text: string | undefined) =>
                    text === undefined || text === "" ? [] : text.split("\x1f");
                  return [
                    {
                      changeId,
                      commitId,
                      parents: list(parents),
                      subject: unquote(subject),
                      paths: list(paths),
                      bookmarks: list(bookmarks),
                      conflict: flags[0] === "1",
                      empty: flags[1] === "1",
                      divergent: flags[2] === "1",
                    },
                  ];
                })
              : null,
          ),
        ),

    /** Merges one change's versions without asking; true when one version remains. */
    converge: (repo: string, cwd: string, change: string) =>
      Effect.gen(function* () {
        yield* jj.run(repo, cwd, ["converge", "--no-interactive", "-r", union([change])], {
          timeoutMs: RUN_MS,
        });
        return (yield* divergentAmong(repo, cwd, [change])).length === 0;
      }),
  };
};
