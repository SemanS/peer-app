import * as Effect from "effect/Effect";
import { sharedRef } from "./git.ts";
import type { createGit, MergeResult, Repository } from "./git.ts";
import type { WorkingCopy } from "./client/jj.ts";
import type { Subject } from "./subjects.ts";

/**
 * The working copy of the agent behind a local thread. Peer names a task's jj workspace like its
 * bookmark (`feature/<name>`); otherwise the workspace whose change, or whose parent, carries the
 * bookmark. The default workspace counts only when a session's bookmark is there.
 */
export function workingCopyFor(branch: string, copies: ReadonlyArray<WorkingCopy>) {
  const name = branch.slice(branch.lastIndexOf("/") + 1);
  return (
    copies.find((copy) => copy.workspaces.includes(name)) ??
    copies.find((copy) => copy.bookmarks.includes(branch)) ??
    copies.find((copy) => copy.parentBookmarks.includes(branch))
  );
}

/**
 * Where each side is read in a Jujutsu checkout. This computer's agents are read from their working
 * copies (`live`), a teammate from the shared work in progress when there is some, else from the
 * pushed bookmark. The refs to read are `shared` ones; `tips` gains the working copies' commits.
 */
export function sidesOf(input: {
  subjects: ReadonlyArray<Subject>;
  tips: Map<string, string>;
  copies: ReadonlyArray<WorkingCopy>;
  now: number;
  fetchedAt: number;
}) {
  return input.subjects.map((subject): Subject => {
    if (subject.where === "here") {
      const copy = workingCopyFor(subject.branch, input.copies);
      if (copy !== undefined) input.tips.set(subject.ref, copy.commit);
      return { ...subject, source: "live", readAt: input.now };
    }
    const shared = sharedRef(subject.branch);
    return input.tips.has(shared)
      ? { ...subject, ref: shared, source: "shared", readAt: input.fetchedAt }
      : { ...subject, source: "pushed", readAt: input.fetchedAt };
  });
}

/** The side whose change was started later; equal times fall to the commit id so both computers agree. */
export function laterOf(a: { subject: Subject; commit: string }, b: typeof a) {
  const left = a.subject.started ?? 0,
    right = b.subject.started ?? 0;
  return left !== right ? (left > right ? "a" : "b") : a.commit > b.commit ? "a" : "b";
}

type Side = { subject: Subject; commit: string };
type Entry = {
  left: Subject;
  right: Subject;
  a: string;
  b: string;
  repository: string;
  git: Repository;
  result?: MergeResult | undefined;
};
export type Inherited = { side: "a" | "b"; branch: string; task?: string };

/**
 * A conflict a side only inherits: it builds on a change in flight (an ancestor among the other
 * sides), that change conflicts with the same other side in the same files, and the stacked side
 * wrote nothing of its own in them. It is then shown once, on the pair of the change it comes from.
 * The ancestry and file questions never change for a commit pair, so they are remembered.
 */
export function inheritance(git: ReturnType<typeof createGit>) {
  const memo = new Map<string, unknown>();
  const once = <A>(key: string, make: Effect.Effect<A>) =>
    Effect.gen(function* () {
      if (memo.has(key)) return memo.get(key) as A;
      const value = yield* make;
      if (memo.size > 1024) memo.clear();
      memo.set(key, value);
      return value;
    });
  return (records: ReadonlyArray<Entry>) =>
    Effect.gen(function* () {
      const found = new Map<Entry, Inherited>();
      const conflict = (record: Entry) =>
        record.result?.state === "conflict" ? record.result : undefined;
      const between = (x: Subject, y: Subject) =>
        records.find(
          (r) =>
            (r.left.branch === x.branch && r.right.branch === y.branch) ||
            (r.left.branch === y.branch && r.right.branch === x.branch),
        );
      for (const pair of records) {
        const own = conflict(pair);
        if (own === undefined || own.more > 0) continue;
        const sides: Array<readonly ["a" | "b", Side, Subject]> = [
          ["a", { subject: pair.left, commit: pair.a }, pair.right],
          ["b", { subject: pair.right, commit: pair.b }, pair.left],
        ];
        for (const [name, stacked, other] of sides) {
          const candidates = records
            .filter((r) => r.repository === pair.repository)
            .flatMap((r) => [
              { subject: r.left, commit: r.a },
              { subject: r.right, commit: r.b },
            ])
            .filter(
              (c, i, all) =>
                c.subject.branch !== stacked.subject.branch &&
                c.subject.branch !== other.branch &&
                all.findIndex((d) => d.subject.branch === c.subject.branch) === i,
            );
          for (const base of candidates) {
            const meeting = between(base.subject, other);
            const theirs = meeting === undefined ? undefined : conflict(meeting);
            if (theirs === undefined || !own.files.every((file) => theirs.files.includes(file)))
              continue;
            const stackedOn = yield* once(
              `anc:${base.commit}:${stacked.commit}`,
              git.isAncestor(pair.git, base.commit, stacked.commit),
            );
            if (!stackedOn) continue;
            const wrote = yield* once(
              `diff:${base.commit}:${stacked.commit}`,
              git.changedFiles(pair.git, base.commit, stacked.commit),
            );
            if (wrote === null || own.files.some((file) => wrote.has(file))) continue;
            found.set(pair, {
              side: name,
              branch: base.subject.branch,
              ...(base.subject.task === undefined ? {} : { task: base.subject.task }),
            });
            break;
          }
          if (found.has(pair)) break;
        }
      }
      return found;
    });
}
