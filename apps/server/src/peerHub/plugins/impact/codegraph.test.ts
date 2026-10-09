// @effect-diagnostics nodeBuiltinImport:off - isolated filesystem fixtures.
import { describe, expect, it } from "vite-plus/test";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import ready from "./__fixtures__/codegraph-0.50/ready.json" with { type: "json" };
import none from "./__fixtures__/codegraph-0.50/no-index.json" with { type: "json" };
import corrupt from "./__fixtures__/codegraph-0.50/corrupt.json" with { type: "json" };
import map from "./__fixtures__/codegraph-0.50/file-map.json" with { type: "json" };
import search from "./__fixtures__/codegraph-0.50/search.json" with { type: "json" };
import callees from "./__fixtures__/codegraph-0.50/callees.json" with { type: "json" };
import {
  decodeHealth,
  decodeMap,
  decodeSearch,
  decodeCallees,
  createCodeGraph,
} from "./client/codegraph.ts";
describe("bounded CodeGraph adapter", () => {
  it("backs off only after consecutive failures, resetting after successful decoded processes", async () => {
    let fail = true,
      processes = 0;
    const cg = createCodeGraph({
      binary: "/fake",
      run: async () => {
        processes++;
        if (fail) throw new Error("offline");
        return JSON.stringify(ready);
      },
    });
    for (let i = 0; i < 6; i++) {
      fail = i % 2 === 0;
      expect((await cg.health("/root", i * 60001)).state).toBe(fail ? "failed" : "ready");
      expect(cg.failures("/root")).toBe(fail ? 1 : 0);
    }
    expect(processes).toBe(6);
    fail = true;
    for (let i = 6; i < 9; i++) await cg.health("/root", i * 60001);
    expect(cg.failures("/root")).toBe(3);
    fail = false;
    expect((await cg.health("/root", 9 * 60001)).state).toBe("failed");
    expect(processes).toBe(9);
  });
  it("pins complete 0.50 output and fails closed for unhealthy indexes", () => {
    expect(decodeHealth("/root", ready).state).toBe("ready");
    expect(decodeHealth("/root", none).state).toBe("uninitialized");
    expect(decodeHealth("/root", corrupt).state).toBe("corrupt");
    for (const value of [
      { ...ready, partial: true },
      { ...ready, index: { ...ready.index, reindexRecommended: true } },
      { ...ready, worktreeMismatch: "elsewhere" },
      { ...ready, extractionStatus: "maybe" },
      { ...ready, version: "0.49.0" },
    ])
      expect(decodeHealth("/root", value).state).not.toBe("ready");
    const pending = decodeHealth("/root", {
      ...ready,
      pendingChanges: { added: ["src/a.ts"], modified: [], removed: [] },
    });
    expect(pending.pending?.has("src/a.ts")).toBe(true);
    expect(
      decodeHealth("/root", { ...ready, pendingChanges: { added: 0, modified: 1, removed: 0 } })
        .pending,
    ).toBeNull();
  });
  it("gets exact ranges from structured search and rejects ambiguity, truncation and foreign paths", () => {
    const names = decodeMap(map, "sample.ts");
    expect(names).toHaveLength(3);
    expect(decodeSearch(search, names[1]!)).toMatchObject({
      name: "formatPrice",
      path: "sample.ts",
      start: 2,
      end: 4,
    });
    expect(() => decodeSearch([...search, ...search], names[1]!)).toThrow();
    expect(() =>
      decodeSearch(
        Array.from({ length: 20 }, () => search[0]),
        names[1]!,
      ),
    ).toThrow();
    expect(() =>
      decodeMap({ ...map, output: map.output.replace("3 symbols", "4 symbols") }, "sample.ts"),
    ).toThrow();
    expect(
      decodeCallees({
        ...callees,
        callees: [...callees.callees, { name: "bad", filePath: "../secret", startLine: 1 }],
      }),
    ).toEqual([{ name: "formatPrice", path: "src/money.ts" }]);
  });
  it("runs argv without a shell, retries health on its schedule, and never mutates an index", async () => {
    const calls: string[][] = [],
      cg = createCodeGraph({
        binary: "/fake",
        run: async (_bin, args) => {
          calls.push([...args]);
          return JSON.stringify(
            args[0] === "status"
              ? ready
              : args[0] === "node"
                ? {
                    ...map,
                    output:
                      "**sample.ts** — 1 symbol\n### Symbols\n- `formatPrice` (method) (value: number): string — :2",
                  }
                : args[0] === "search"
                  ? search
                  : callees,
          );
        },
      });
    await cg.health("/root", 0);
    await cg.health("/root", 19_999);
    expect(calls).toHaveLength(1);
    const symbols = await cg.symbols("/root", "sample.ts");
    expect(symbols[0]?.end).toBe(4);
    await cg.callees("/root", symbols[0]!);
    expect(calls.at(-1)).toEqual([
      "callees",
      "formatPrice",
      "-p",
      "/root",
      "--file",
      "sample.ts",
      "--json",
      "--limit",
      "20",
    ]);
    expect(calls.map((v) => v[0])).toEqual(["status", "node", "search", "callees"]);
  });
  it("caps output, terminates hangs and makes three failed roots unusable for ten minutes", async () => {
    const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "peer-impact-process-"));
    try {
      const binary = NodePath.join(dir, "cg");
      await NodeFSP.writeFile(binary, "#!/bin/sh\nexec sleep 30\n", { mode: 0o700 });
      const cg = createCodeGraph({ binary, timeoutMs: 30 });
      for (let i = 0; i < 3; i++) await cg.health(dir, i * 60_001);
      expect(cg.failures(dir)).toBe(3);
      expect((await cg.health(dir, 180_004)).state).toBe("failed");
      await NodeFSP.writeFile(binary, "#!/bin/sh\nprintf bad-json\n", { mode: 0o700 });
      expect((await cg.health(dir, 900_000)).state).toBe("failed");
    } finally {
      await NodeFSP.rm(dir, { recursive: true, force: true });
    }
  });
});
