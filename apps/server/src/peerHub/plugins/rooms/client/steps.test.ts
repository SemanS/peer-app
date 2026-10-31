// @effect-diagnostics nodeBuiltinImport:off - temporary repositories and the real jj.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { changeDiff, patchCounts, stepDiff, workspaceChange, workspaceSteps } from "./steps.ts";

const hasJj = NodeChildProcess.spawnSync("jj", ["--version"]).status === 0;

describe("patchCounts", () => {
  it("counts lines without the file headers", () => {
    expect(
      patchCounts(
        [
          "diff --git a/x.ts b/x.ts",
          "--- a/x.ts",
          "+++ b/x.ts",
          "@@ -1 +1 @@",
          "-old",
          "+new",
        ].join("\n"),
      ),
    ).toEqual({ files: ["x.ts"], added: 1, removed: 1 });
  });
});

describe.skipIf(!hasJj)("an agent's steps", () => {
  let root: string;
  const jj = (...args: ReadonlyArray<string>) =>
    NodeChildProcess.execFileSync("jj", [...args], {
      cwd: root,
      encoding: "utf8",
      stdio: "pipe",
      env: { ...process.env, JJ_USER: "Peer Test", JJ_EMAIL: "test@example.com" },
    });
  const write = (name: string, text: string) => {
    NodeFS.writeFileSync(NodePath.join(root, name), text);
    jj("status");
  };

  beforeEach(() => {
    root = NodeFS.realpathSync(NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "peer-steps-")));
    jj("git", "init", "--colocate");
  });

  afterEach(() => NodeFS.rmSync(root, { recursive: true, force: true }));

  it("lists each snapshot newest first, with only its own lines", async () => {
    write("a.txt", "one\n");
    write("a.txt", "one\ntwo\n");
    write("b.txt", "three\n");

    const steps = await workspaceSteps(root);
    expect(steps.map((step) => [step.files, step.added])).toEqual([
      [["b.txt"], 1],
      [["a.txt"], 1],
      [["a.txt"], 1],
    ]);

    const diff = await stepDiff(root, steps[1]!.commit);
    expect(diff?.state === "here" && diff.patch).toContain("+two");
    expect(diff?.state === "here" && diff.patch).not.toContain("three");
  });

  it("reads the whole change the workspace carries", async () => {
    jj("describe", "-m", "carry two files\n\nthe body stays out");
    write("a.txt", "one\n");
    write("b.txt", "two\n");

    const change = await workspaceChange(root);
    expect(change.subject).toBe("carry two files");
    expect(change.changeId).toMatch(/^[k-z]{32}$/);

    const diff = await changeDiff(root);
    expect(diff.state === "here" && diff.patch).toContain("+one");
    expect(diff.state === "here" && diff.patch).toContain("+two");
  });

  it("answers nothing for a commit that is not a step", async () => {
    write("a.txt", "one\n");
    expect(await stepDiff(root, "--help")).toBeNull();
    expect(await stepDiff(root, "0".repeat(40))).toBeNull();
  });
});
