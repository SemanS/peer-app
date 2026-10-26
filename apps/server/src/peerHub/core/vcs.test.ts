// @effect-diagnostics nodeBuiltinImport:off - temporary repositories and a scripted jj only.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { chosenBookmarkConfigKey } from "../../jj/JjStatus.ts";
import { workspaceNameForRef } from "../../jj/JjWorkspaces.ts";
import { checkoutKind, checkoutState, currentRef, resetVcsCaches } from "./vcs.ts";

const sh = (cwd: string, command: string, args: ReadonlyArray<string>) =>
  NodeChildProcess.execFileSync(command, [...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      JJ_USER: "Peer Test",
      JJ_EMAIL: "test@example.com",
      GIT_AUTHOR_NAME: "Peer Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Peer Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

let dir = "";
let originalPath: string | undefined;

beforeEach(() => {
  dir = NodeFS.realpathSync(NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "peer-vcs-")));
  originalPath = process.env.PATH;
  resetVcsCaches();
});

afterEach(() => {
  process.env.PATH = originalPath;
  NodeFS.rmSync(dir, { recursive: true, force: true });
  resetVcsCaches();
});

function gitRepo(name: string): string {
  const root = NodePath.join(dir, name);
  NodeFS.mkdirSync(root);
  sh(root, "git", ["init", "-q", "-b", "main"]);
  sh(root, "git", ["commit", "-q", "--allow-empty", "-m", "init"]);
  return root;
}

function jjRepo(name: string): string {
  const root = gitRepo(name);
  sh(root, "jj", ["git", "init", "--colocate", "--quiet"]);
  return root;
}

/** Logs every run of `commands` from here on; returns the runs, `jj --version` probes aside. */
function logRuns(commands: ReadonlyArray<string>): () => ReadonlyArray<string> {
  const bin = NodePath.join(dir, "spy");
  NodeFS.mkdirSync(bin, { recursive: true });
  const log = NodePath.join(dir, "spy.log");
  for (const command of commands) {
    const real = sh(dir, "sh", ["-c", `command -v ${command}`]).trim();
    NodeFS.writeFileSync(
      NodePath.join(bin, command),
      // `printf '%s'`, not `echo`: sh's echo turns a template's `\n` into a line break.
      `#!/bin/sh\nprintf '%s\\n' "${command} $*" >> '${log}'\nexec '${real}' "$@"\n`,
      { mode: 0o755 },
    );
  }
  process.env.PATH = `${bin}${NodePath.delimiter}${originalPath ?? ""}`;
  return () =>
    NodeFS.existsSync(log)
      ? NodeFS.readFileSync(log, "utf8")
          .split("\n")
          .filter((line) => line !== "" && !line.endsWith("--version"))
      : [];
}

describe("checkoutKind", () => {
  it("reads a Git repository as Git", async () => {
    const root = gitRepo("git");
    expect(await checkoutKind(root)).toEqual({ kind: "git", root });
    expect(await checkoutState(root)).toEqual({ state: "ready", kind: "git" });
  });

  it("reads a colocated jj repository and its secondary workspace as jj", async () => {
    const root = jjRepo("app");
    expect(await checkoutKind(root)).toMatchObject({ kind: "jj", root, mainRoot: root });
    const second = NodePath.join(dir, "second");
    sh(root, "jj", ["workspace", "add", "--no-colocate", "--quiet", second]);
    expect(NodeFS.existsSync(NodePath.join(second, ".git"))).toBe(false);
    expect(await checkoutKind(second)).toMatchObject({
      kind: "jj",
      root: second,
      mainRoot: root,
      gitDir: NodePath.join(root, ".git"),
    });
    expect(await checkoutState(root)).toEqual({ state: "ready", kind: "jj" });
    // jj colocates a new workspace by default: its `.git` is a file and `.jj` still wins.
    const colocated = NodePath.join(dir, "third");
    sh(root, "jj", ["workspace", "add", "--quiet", colocated]);
    expect(NodeFS.statSync(NodePath.join(colocated, ".git")).isFile()).toBe(true);
    expect(await checkoutKind(colocated)).toMatchObject({ kind: "jj", root: colocated });
  });

  it("names a jj repository without Git as unsupported, never missing", async () => {
    const root = NodePath.join(dir, "plain");
    NodeFS.mkdirSync(root);
    sh(root, "jj", ["git", "init", "--no-colocate", "--quiet"]);
    const kind = await checkoutKind(root);
    expect(kind?.kind).toBe("jj-unsupported");
    expect(kind?.kind === "jj-unsupported" ? kind.reason : "").toContain("colocate");
    expect((await checkoutState(root)).state).toBe("unsupported");
  });

  it("reads a jj repository pinned to Git by .t3code/vcs.json as Git", async () => {
    const root = jjRepo("pinned");
    NodeFS.mkdirSync(NodePath.join(root, ".t3code"));
    NodeFS.writeFileSync(NodePath.join(root, ".t3code", "vcs.json"), '{"vcs":{"kind":"git"}}');
    expect(await checkoutKind(root)).toEqual({ kind: "git", root });
  });

  it("names an old jj with its version and the floor, and a folder with neither as missing", async () => {
    const root = jjRepo("old");
    const bin = NodePath.join(dir, "bin");
    NodeFS.mkdirSync(bin);
    NodeFS.writeFileSync(NodePath.join(bin, "jj"), "#!/bin/sh\necho 'jj 0.45.0'\n", {
      mode: 0o755,
    });
    process.env.PATH = `${bin}${NodePath.delimiter}${originalPath ?? ""}`;
    const state = await checkoutState(root);
    expect(state.state).toBe("unsupported");
    expect(state.state === "unsupported" ? state.reason : "").toMatch(/0\.45\.0.*0\.46\.0/);
    expect(await checkoutState(NodePath.join(dir, "bin"))).toEqual({ state: "missing" });
  });

  it("is null outside any repository", async () => {
    const outside = NodePath.join(dir, "outside");
    NodeFS.mkdirSync(outside);
    // tmpdir itself may sit in no repository; a missing folder never walks up.
    expect(await checkoutKind(NodePath.join(outside, "gone"))).toBeNull();
  });
});

describe("currentRef", () => {
  it("is a bookmark on @", async () => {
    const root = jjRepo("on-at");
    sh(root, "jj", ["bookmark", "create", "--quiet", "feature/KRK-1-ab12", "-r", "@"]);
    expect(await currentRef(root)).toBe("feature/KRK-1-ab12");
  });

  it("is the bookmark on @- under an empty @, the first name when there are two", async () => {
    const root = jjRepo("below");
    NodeFS.writeFileSync(NodePath.join(root, "a.txt"), "a\n");
    sh(root, "jj", ["commit", "--quiet", "-m", "one"]);
    sh(root, "jj", ["bookmark", "create", "--quiet", "zeta", "-r", "@-"]);
    sh(root, "jj", ["bookmark", "create", "--quiet", "feature/KRK-1-ab12", "-r", "@-"]);
    expect(await currentRef(root)).toBe("feature/KRK-1-ab12");
  });

  it("settles bookmarks on one commit by the one the person last chose in the app", async () => {
    const root = jjRepo("chosen");
    sh(root, "jj", ["bookmark", "create", "--quiet", "aardvark", "-r", "main"]);
    expect(await currentRef(root)).toBe("aardvark");

    sh(root, "git", ["config", chosenBookmarkConfigKey("default"), "main"]);

    expect(await currentRef(root)).toBe("main");
  });

  it("is a thread workspace's own bookmark, and never another thread's", async () => {
    const root = jjRepo("threads");
    for (const name of ["aaa-child", "zz-child"]) {
      sh(root, "jj", ["bookmark", "create", "--quiet", name, "-r", "main"]);
      sh(root, "jj", [
        "workspace",
        "add",
        "--quiet",
        "--name",
        workspaceNameForRef(name),
        "-r",
        name,
        NodePath.join(dir, name),
      ]);
    }

    expect(await currentRef(root)).toBe("main");
    expect(await currentRef(NodePath.join(dir, "aaa-child"))).toBe("aaa-child");
    expect(await currentRef(NodePath.join(dir, "zz-child"))).toBe("zz-child");
  });

  it("does not assign a managed workspace to main after its own bookmark is deleted", async () => {
    const root = jjRepo("deleted-thread-bookmark");
    const refName = "feature/task";
    const workspace = NodePath.join(dir, "managed-thread");
    sh(root, "jj", ["bookmark", "create", "--quiet", refName, "-r", "main"]);
    sh(root, "jj", [
      "workspace",
      "add",
      "--quiet",
      "--name",
      workspaceNameForRef(refName),
      "-r",
      refName,
      workspace,
    ]);
    sh(root, "jj", ["bookmark", "delete", refName]);
    expect(await currentRef(workspace)).toBeUndefined();
  });

  it("does not assign the main workspace to a lone bookmark owned by another thread", async () => {
    const root = jjRepo("lone-child-bookmark");
    const refName = "feature/task";
    sh(root, "jj", ["bookmark", "create", "--quiet", refName, "-r", "main"]);
    sh(root, "jj", [
      "workspace",
      "add",
      "--quiet",
      "--name",
      workspaceNameForRef(refName),
      "-r",
      refName,
      NodePath.join(dir, "child-only"),
    ]);
    sh(root, "jj", ["bookmark", "delete", "main"]);
    expect(await currentRef(root)).toBeUndefined();
  });

  it("checks workspace ownership for a lone bookmark without reading chosen-bookmark config", async () => {
    const root = jjRepo("lone");
    const runs = logRuns(["jj", "git"]);

    expect(await currentRef(root)).toBe("main");

    expect(runs()).toHaveLength(2);
    expect(runs()[0]).toContain(" log ");
    expect(runs()[1]).toContain(" workspace list ");
  });

  it("is none without a bookmark, never HEAD", async () => {
    const root = jjRepo("bare");
    NodeFS.writeFileSync(NodePath.join(root, "a.txt"), "a\n");
    sh(root, "jj", ["commit", "--quiet", "-m", "one"]);
    // The colocation imported Git's `main`; without it nothing above root is bookmarked.
    sh(root, "jj", ["bookmark", "forget", "--quiet", "main"]);
    expect(await currentRef(root)).toBeUndefined();
  });

  it("is a Git branch, and none on a detached HEAD", async () => {
    const root = gitRepo("git-ref");
    expect(await currentRef(root)).toBe("main");
    sh(root, "git", ["checkout", "-q", "--detach"]);
    resetVcsCaches();
    expect(await currentRef(root)).toBeUndefined();
  });

  it("reads jj without snapshotting the working copy", async () => {
    const root = jjRepo("no-snapshot");
    sh(root, "jj", ["bookmark", "create", "--quiet", "aardvark", "-r", "main"]);
    const runs = logRuns(["jj"]);
    await currentRef(root);
    // Both reads: the log, and the workspace list two bookmarks on one commit call for.
    expect(runs()).toHaveLength(2);
    for (const read of runs()) {
      expect(read).toContain("--ignore-working-copy");
      expect(read).toContain("git.abandon-unreachable-commits=false");
    }
  });
});
