// @effect-diagnostics nodeBuiltinImport:off - canonicalizes VCS-owned checkout paths before accepting a selection.
import * as NodeFSP from "node:fs/promises";
import type { PeerRoomDiff, PeerRoomWorktree } from "@t3tools/contracts";

import { run } from "../../../core/local.ts";
import { checkoutKind, jjWorkspaces } from "../../../core/vcs.ts";
import { runDiff } from "./diff.ts";
import { changeDiff } from "./steps.ts";

async function existingWorktrees(
  rows: ReadonlyArray<PeerRoomWorktree>,
): Promise<ReadonlyArray<PeerRoomWorktree>> {
  return (
    await Promise.all(
      rows.map(async (row) => {
        try {
          return { ...row, path: await NodeFSP.realpath(row.path) };
        } catch {
          return null;
        }
      }),
    )
  ).filter((row) => row !== null);
}

export async function roomWorktrees(root: string): Promise<ReadonlyArray<PeerRoomWorktree>> {
  const kind = await checkoutKind(root);
  if (kind?.kind === "jj-unsupported") throw new Error(kind.reason);
  if (kind?.kind === "jj") {
    return existingWorktrees(
      (await jjWorkspaces(root)).map((entry) => ({ path: entry.root, name: entry.name })),
    );
  }
  const listing = await run("git", ["-C", root, "worktree", "list", "--porcelain", "-z"], {
    timeoutMs: 4000,
  });
  const rows = listing.split("\0\0").flatMap((record) => {
    const fields = record.split("\0");
    const path = fields.find((field) => field.startsWith("worktree "))?.slice(9);
    if (
      path === undefined ||
      fields.includes("bare") ||
      fields.some((field) => field.startsWith("prunable"))
    )
      return [];
    const branch = fields.find((field) => field.startsWith("branch refs/heads/"))?.slice(18);
    const head = fields.find((field) => field.startsWith("HEAD "))?.slice(5, 13);
    return [{ path, name: branch ?? `Detached · ${head ?? "unknown"}` }];
  });
  return existingWorktrees(rows);
}

export async function roomWorktreeDiff(root: string, base: string): Promise<PeerRoomDiff> {
  const kind = await checkoutKind(root);
  if (kind?.kind === "jj-unsupported") throw new Error(kind.reason);
  const diff = kind?.kind === "jj" ? await changeDiff(root) : await runDiff(root, base);
  return diff?.state === "here"
    ? { ...diff, folder: root, source: "worktree" }
    : {
        state: "notHere",
        folder: root,
        reason: `This worktree cannot be compared with ${base}. Its files are still available.`,
        files: [],
      };
}
