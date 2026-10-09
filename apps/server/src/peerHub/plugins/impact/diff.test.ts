// @effect-diagnostics nodeBuiltinImport:off - isolated filesystem fixtures.
import { describe, expect, it } from "vite-plus/test";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { createDiff, parseDiff } from "./client/diff.ts";
import { runProcess } from "./client/process.ts";
describe("impact changed-line diff", () => {
  it("keeps pure deletion positions and ignores binary blocks", () => {
    const diffs = parseDiff(
      "diff --git a/a.ts b/a.ts\n+++ b/a.ts\n@@ -2,3 +2,0 @@\n-old\ndiff --git a/b.png b/b.png\nBinary files a/b.png and b/b.png differ\n",
    );
    expect(diffs.get("a.ts")).toEqual([{ start: 2, end: 2 }]);
    expect(diffs.has("b.png")).toBe(false);
  });
  it("includes committed and uncommitted changes, new files, safe base fallbacks and no external driver", async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "peer-impact-diff-")),
      git = (args: string[]) =>
        runProcess("git", args, root, { timeoutMs: 3000, cap: 4 * 1024 * 1024 });
    try {
      await git(["init", "-q"]);
      await git(["config", "user.email", "test@example.com"]);
      await git(["config", "user.name", "test"]);
      await NodeFSP.writeFile(
        NodePath.join(root, "a.ts"),
        "export function price() {\n return 1;\n}\n",
      );
      await git(["add", "a.ts"]);
      await git(["commit", "-qm", "base"]);
      await git(["update-ref", "refs/remotes/origin/main", "HEAD"]);
      await NodeFSP.writeFile(
        NodePath.join(root, "a.ts"),
        "export function price(value = 0) {\n return value;\n}\n",
      );
      await git(["commit", "-qam", "signature"]);
      await NodeFSP.writeFile(
        NodePath.join(root, "a.ts"),
        "export function price(value = 0) {\n return value + 1;\n}\n",
      );
      await NodeFSP.writeFile(NodePath.join(root, "new.ts"), "export const fresh = true;\n");
      await NodeFSP.writeFile(NodePath.join(root, "binary"), Buffer.from([0, 1, 2]));
      const calls: string[][] = [],
        diff = createDiff({
          run: async (...args) => {
            calls.push([...args[1]]);
            return runProcess(...args);
          },
        }),
        value = await diff.read(root, ["a.ts", "new.ts", "binary"], "main");
      expect(value?.files.get("a.ts")?.hunks).toEqual([{ start: 1, end: 2 }]);
      expect(value?.files.get("new.ts")?.newFile).toBe(true);
      expect(value?.files.has("binary")).toBe(false);
      expect(calls.length).toBeLessThanOrEqual(3);
      expect(calls.flat()).toContain("--no-ext-diff");
      await git(["update-ref", "-d", "refs/remotes/origin/main"]);
      const fallback = createDiff();
      expect(await fallback.read(root, ["a.ts"], "missing")).toBeNull();
      expect((await fallback.read(root, ["a.ts"], "missing"))?.files.get("a.ts")?.hunks).toEqual([
        { start: 2, end: 2 },
      ]);
    } finally {
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  });
});
