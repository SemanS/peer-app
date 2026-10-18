// @effect-diagnostics nodeBuiltinImport:off - trusted provenance is verified in isolated directories.
import * as NodeChildProcess from "node:child_process";
import { it, expect } from "vite-plus/test";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { indexCreated, type Created } from "./client/worktree.ts";
const created = async (root: string): Promise<Created> => {
  const stat = await NodeFSP.stat(root);
  return {
    kind: "task-worktree-created",
    workspace: "acme",
    project: "app",
    repository: "api",
    task: "a",
    thread: "t",
    root,
    identity: `${stat.dev}:${stat.ino}`,
  };
};
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
it("keeps the index of a colocated jj workspace out of jj's snapshots, listing it once", async () => {
  const parent = await NodeFSP.realpath(
      await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "peer-impact-jj-")),
    ),
    main = NodePath.join(parent, "main"),
    root = NodePath.join(parent, "task");
  // No user config: a global Git ignore listing `.codegraph/` would hide what is tested.
  const env = {
    ...process.env,
    HOME: parent,
    XDG_CONFIG_HOME: parent,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    JJ_CONFIG: "/dev/null",
    JJ_USER: "Peer Test",
    JJ_EMAIL: "test@example.com",
  };
  const sh = (cwd: string, command: string, ...args: string[]) =>
    NodeChildProcess.execFileSync(command, args, { cwd, env, encoding: "utf8" });
  try {
    await NodeFSP.mkdir(main);
    sh(main, "git", "init", "-q", "-b", "main");
    sh(
      main,
      "git",
      "-c",
      "user.name=P",
      "-c",
      "user.email=p@test",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "i",
    );
    sh(main, "jj", "git", "init", "--colocate", "--quiet");
    sh(main, "jj", "workspace", "add", "--quiet", root);
    // The indexer writes `.codegraph/` into the workspace it initializes.
    const run = async (_bin: string, args: ReadonlyArray<string>) => {
      await NodeFSP.mkdir(NodePath.join(args[1]!, ".codegraph"), { recursive: true });
      await NodeFSP.writeFile(NodePath.join(args[1]!, ".codegraph", "x"), "index");
      return "done";
    };
    expect(await indexCreated(await created(root), parent, () => true, run, "/fake")).toBe(true);
    expect(sh(root, "jj", "--no-pager", "status")).not.toContain(".codegraph");
    await NodeFSP.rm(NodePath.join(root, ".codegraph"), { recursive: true });
    expect(await indexCreated(await created(root), parent, () => true, run, "/fake")).toBe(true);
    const exclude = await NodeFSP.readFile(NodePath.join(main, ".git", "info", "exclude"), "utf8");
    expect(exclude.split("\n").filter((line) => line === ".codegraph/")).toHaveLength(1);
  } finally {
    await NodeFSP.rm(parent, { recursive: true, force: true });
  }
});
