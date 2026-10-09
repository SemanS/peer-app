// @effect-diagnostics nodeBuiltinImport:off - bounded local Git and file read adapter.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import { repositoryPath } from "./codegraph.ts";
import { runProcess, type Runner } from "./process.ts";
export type Hunk = { start: number; end: number };
export type ChangedFile = { text: string; hunks: Hunk[]; newFile: boolean };
export type Diff = { files: Map<string, ChangedFile> };
export function parseDiff(text: string): Map<string, Hunk[]> {
  const files = new Map<string, Hunk[]>();
  let current: string | undefined;
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) current = undefined;
    if (line.startsWith("+++ b/")) {
      const path = line.slice(6);
      if (repositoryPath(path)) {
        current = path;
        files.set(path, []);
      }
    }
    if (line.startsWith("Binary files ") && current) {
      files.delete(current);
      current = undefined;
    }
    const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (m && current) {
      const start = Math.max(1, Number(m[1])),
        count = Number(m[2] ?? 1);
      files.get(current)!.push({ start, end: start + Math.max(0, count - 1) });
    }
  }
  return files;
}
/** Three processes per invocation. An absent final fallback carries into the next check. */
export function createDiff(options: { run?: Runner } = {}) {
  const run = options.run ?? runProcess,
    choice = new Map<string, number>();
  return {
    read: async (
      root: string,
      paths: ReadonlyArray<string>,
      branch: string,
      signal?: AbortSignal,
    ): Promise<Diff | null> => {
      const files = paths.filter(repositoryPath).slice(-50);
      if (!files.length) return { files: new Map() };
      const git = (args: ReadonlyArray<string>) =>
        run("git", ["-c", "core.quotePath=false", ...args], root, {
          timeoutMs: 3000,
          cap: 4 * 1024 * 1024,
          signal,
        });
      const status = await git([
          "status",
          "--porcelain=v1",
          "-z",
          "--untracked-files=all",
          "--",
          ...files,
        ]),
        untracked = new Set(
          status
            .split("\0")
            .filter((v) => v.startsWith("?? "))
            .map((v) => v.slice(3)),
        );
      const bases = [
        ...(branch !== "" && !/^[/-]|[\s~^:?*[\\]|\.\.|@\{/.test(branch)
          ? [`origin/${branch}`]
          : []),
        "origin/HEAD",
        "HEAD",
      ];
      let at = Math.min(choice.get(root) ?? 0, bases.length - 1),
        output: string | undefined;
      for (let tries = 0; tries < 2 && at < bases.length; tries++, at++)
        try {
          output = await git([
            "diff",
            "-U0",
            "--no-color",
            "--no-ext-diff",
            "--no-textconv",
            "--no-renames",
            "--merge-base",
            bases[at]!,
            "--",
            ...files,
          ]);
          choice.set(root, at);
          break;
        } catch (error) {
          if (signal?.aborted) throw error;
          choice.set(root, Math.min(at + 1, bases.length - 1));
        }
      if (output === undefined) return null;
      const hunks = parseDiff(output),
        result = new Map<string, ChangedFile>();
      let bytes = 0;
      const canonical = await NodeFSP.realpath(root);
      for (const file of files) {
        const range = hunks.get(file);
        if (!range?.length && !untracked.has(file)) continue;
        try {
          const target = await NodeFSP.realpath(NodePath.join(root, file));
          if (!target.startsWith(canonical + NodePath.sep)) continue;
          const stat = await NodeFSP.stat(target);
          if (!stat.isFile() || stat.size + bytes > 4 * 1024 * 1024) continue;
          bytes += stat.size;
          const buffer = await NodeFSP.readFile(target);
          if (buffer.includes(0)) continue;
          const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
          result.set(file, {
            text,
            newFile: untracked.has(file),
            hunks: untracked.has(file)
              ? [{ start: 1, end: Math.max(1, text.split("\n").length) }]
              : (range ?? []),
          });
        } catch {
          /* Removed, foreign, or unreadable files do not imply removed symbols. */
        }
      }
      return { files: result };
    },
  };
}
