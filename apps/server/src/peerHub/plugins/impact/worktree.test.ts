// @effect-diagnostics nodeBuiltinImport:off - trusted provenance is verified in isolated directories.
import { it, expect } from "vite-plus/test";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { indexCreated, type Created } from "./client/worktree.ts";
it("initializes only an unchanged newly-created worktree, never existing indexes or replaced/unauthorized roots", async () => {
  const parent = await NodeFSP.realpath(
      await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "peer-impact-created-")),
    ),
    root = NodePath.join(parent, "new");
  try {
    await NodeFSP.mkdir(root);
    await NodeFSP.writeFile(NodePath.join(root, ".git"), "gitdir: private");
    const stat = await NodeFSP.stat(root),
      event: Created = {
        kind: "task-worktree-created",
        workspace: "acme",
        project: "app",
        repository: "api",
        task: "a",
        thread: "t",
        root,
        identity: `${stat.dev}:${stat.ino}`,
      },
      calls: string[][] = [];
    const run = async (_bin: string, args: ReadonlyArray<string>) => {
      calls.push([...args]);
      return "done";
    };
    expect(await indexCreated(event, parent, () => true, run, "/fake")).toBe(true);
    expect(calls).toEqual([["init", root]]);
    await NodeFSP.mkdir(NodePath.join(root, ".codegraph"));
    expect(await indexCreated(event, parent, () => true, run, "/fake")).toBe(false);
    await NodeFSP.rm(NodePath.join(root, ".codegraph"), { recursive: true });
    expect(await indexCreated(event, parent, () => false, run, "/fake")).toBe(false);
    await NodeFSP.rename(root, NodePath.join(parent, "old"));
    await NodeFSP.mkdir(root);
    await NodeFSP.writeFile(NodePath.join(root, ".git"), "gitdir: replaced");
    expect(await indexCreated(event, parent, () => true, run, "/fake")).toBe(false);
    expect(calls).toHaveLength(1);
  } finally {
    await NodeFSP.rm(parent, { recursive: true, force: true });
  }
});
