// @effect-diagnostics nodeBuiltinImport:off - a stand-in binary on a temporary folder, and the reader's own source.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import corrupt from "./__fixtures__/codegraph-0.50/corrupt.json" with { type: "json" };
import missing from "./__fixtures__/codegraph-0.50/node-missing.json" with { type: "json" };
import invoice from "./__fixtures__/codegraph-0.50/node-invoice.json" with { type: "json" };
import money from "./__fixtures__/codegraph-0.50/node-money.json" with { type: "json" };
import none from "./__fixtures__/codegraph-0.50/no-index.json" with { type: "json" };
import ready from "./__fixtures__/codegraph-0.50/ready.json" with { type: "json" };
import { createCodeGraph, symbolsOf, usable, type Runner } from "./client/codegraph.ts";
import { resolveItems } from "./client/resolve.ts";

const fixtures = NodePath.resolve(import.meta.dirname, "__fixtures__/codegraph-0.50");
const cleanup: string[] = [];
const os = () => NodeOS.tmpdir();
afterEach(async () => {
  for (const dir of cleanup.splice(0)) await NodeFSP.rm(dir, { recursive: true, force: true });
});

/**
 * A `codegraph` that answers `status` and `node` with what CodeGraph 0.50.3 printed, keeps a log of
 * how it was called, and, called with anything else (`init`, `index`, `sync`), leaves a mark and
 * fails, so a test that sees the mark knows what ran.
 */
async function standIn(body = "") {
  const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "plans-codegraph-"));
  cleanup.push(dir);
  const binary = NodePath.join(dir, "codegraph");
  await NodeFSP.writeFile(
    binary,
    [
      "#!/bin/sh",
      `echo "$*" >> '${dir}/calls.log'`,
      body,
      'case "$1" in',
      `  status) cat '${fixtures}/ready.json' ;;`,
      '  node) case "$2" in',
      `    src/invoice.ts) cat '${fixtures}/node-invoice.json' ;;`,
      `    src/money.ts) cat '${fixtures}/node-money.json' ;;`,
      `    *) sed "s#src/missing.ts#$2#" '${fixtures}/node-missing.json' ;;`,
      "  esac ;;",
      `  *) echo "forbidden: $1" >&2; : > '${dir}/FORBIDDEN'; exit 99 ;;`,
      "esac",
    ].join("\n"),
    { mode: 0o755 },
  );
  const calls = () =>
    NodeFS.existsSync(`${dir}/calls.log`)
      ? NodeFS.readFileSync(`${dir}/calls.log`, "utf8").trim().split("\n")
      : [];
  return { binary, dir, calls, forbidden: () => NodeFS.existsSync(`${dir}/FORBIDDEN`) };
}

describe("what the index's status says", () => {
  it("calls an index ready when it is complete, current and from CodeGraph 0.50 or later", () => {
    expect(usable(ready)).toBe(true);
    expect(usable({ ...ready, version: "0.51.0" })).toBe(true);
    expect(usable({ ...ready, version: "1.0.2" })).toBe(true);
  });

  it("calls anything else no index to use", () => {
    expect(usable(none)).toBe(false);
    expect(usable(corrupt)).toBe(false);
    expect(usable({ ...ready, version: "0.49.9" })).toBe(false);
    expect(usable({ ...ready, extractionStatus: "stale" })).toBe(false);
    expect(usable({ ...ready, partial: true })).toBe(false);
    expect(usable({ ...ready, worktreeMismatch: "/other" })).toBe(false);
    expect(usable({ ...ready, index: { ...ready.index, reindexRecommended: true } })).toBe(false);
    expect(usable({ ...ready, pendingChanges: { added: 0, modified: 2, removed: 0 } })).toBe(false);
    expect(usable({ ...ready, pendingChanges: { modified: ["src/a.ts"] } })).toBe(false);
    expect(usable({ ...ready, pendingChanges: { modified: [] } })).toBe(true);
    expect(usable({ ...ready, pendingChanges: { modified: "some" } })).toBe(false);
    expect(usable(null)).toBe(false);
    expect(usable("ready")).toBe(false);
  });
});

describe("what the index lists in a file", () => {
  it("names the symbols in the order CodeGraph lists them, flat as it writes them", () => {
    expect(symbolsOf(invoice, "src/invoice.ts")).toEqual([
      "Invoice",
      "InvoiceLine",
      "constructor",
      "amount",
      "fromJson",
      "Currency",
      "Eur",
      "Usd",
      "sum",
      "refund",
      "refundCents",
      "refundReason",
    ]);
    expect(symbolsOf(money, "src/money.ts")).toEqual(["formatPrice"]);
  });

  it("leaves imports out, and names a file the index does not hold as having none", () => {
    const withImport = {
      ...money,
      output:
        '**src/money.ts** — 2 symbols, no other indexed file depends on it\n\n### Symbols\n- `./tax` (import) import { applyTax } from "./tax"; — :1\n- `formatPrice` (function) (value: number): string — :2',
    };
    expect(symbolsOf(withImport, "src/money.ts")).toEqual(["formatPrice"]);
    expect(symbolsOf({ ...missing, query: "src/new.ts" }, "src/new.ts")).toEqual([]);
  });

  it("refuses a listing that is not for the file, that failed, or that holds fewer symbols than it says", () => {
    expect(() => symbolsOf(invoice, "src/other.ts")).toThrow("unsupported");
    expect(() => symbolsOf({ ...invoice, isError: true }, "src/invoice.ts")).toThrow("unsupported");
    expect(() => symbolsOf({ ...invoice, output: 7 }, "src/invoice.ts")).toThrow("unsupported");
    expect(() => symbolsOf(null, "src/invoice.ts")).toThrow("unsupported");
    expect(() =>
      symbolsOf(
        { ...money, output: "**src/money.ts** — 9 symbols, x\n- `a` (function) () — :1" },
        "src/money.ts",
      ),
    ).toThrow("truncated");
  });

  it("leaves out names with control characters or of more than 200 characters", () => {
    const hostile = {
      ...money,
      output: `- \`bad\u0007name\` (function) () — :1\n- \`${"n".repeat(201)}\` (function) () — :2\n- \`fine\` (function) () — :3`,
    };
    expect(symbolsOf(hostile, "src/money.ts")).toEqual(["fine"]);
  });
});

describe("the reader on a stand-in for CodeGraph", () => {
  it("asks the status and the symbols of a file, and nothing else, never building an index", async () => {
    const graph = await standIn();
    const root = graph.dir;
    const reader = createCodeGraph({ binary: graph.binary });
    expect(await reader.ready(root, 0)).toBe(true);
    expect(await reader.symbols(root, "src/invoice.ts", 0)).toContain("refundCents");
    expect(await reader.symbols(root, "src/money.ts", 0)).toEqual(["formatPrice"]);
    expect(await reader.symbols(root, "src/new.ts", 0)).toEqual([]);
    expect(graph.calls()).toEqual([
      `status ${root} --json`,
      `node src/invoice.ts -p ${root} --symbols-only --json`,
      `node src/money.ts -p ${root} --symbols-only --json`,
      `node src/new.ts -p ${root} --symbols-only --json`,
    ]);
    expect(graph.forbidden()).toBe(false);
  });

  it("keeps the stand-in honest: init, index and sync fail it and leave their mark", async () => {
    for (const command of ["init", "index", "sync"]) {
      const graph = await standIn();
      const code = await new Promise<number>((resolve) =>
        NodeChildProcess.execFile(graph.binary, [command, "."], (error) =>
          resolve(error === null ? 0 : ((error as { code?: number }).code ?? -1)),
        ),
      );
      expect(code).toBe(99);
      expect(graph.forbidden()).toBe(true);
    }
  });

  it("holds no call that could build or refresh an index in its source", async () => {
    const source = await NodeFSP.readFile(
      NodePath.resolve(import.meta.dirname, "client/codegraph.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/["'`](init|index|sync|watch|serve)["'`]/);
    expect([...source.matchAll(/\["(\w+)",/g)].map((match) => match[1])).toEqual([
      "status",
      "node",
    ]);
  });

  it("uses the binary PEER_CODEGRAPH_BIN names", async () => {
    const graph = await standIn();
    const before = process.env.PEER_CODEGRAPH_BIN;
    process.env.PEER_CODEGRAPH_BIN = graph.binary;
    try {
      expect(await createCodeGraph().ready(graph.dir, 0)).toBe(true);
    } finally {
      if (before === undefined) delete process.env.PEER_CODEGRAPH_BIN;
      else process.env.PEER_CODEGRAPH_BIN = before;
    }
    expect(graph.calls()).toEqual([`status ${graph.dir} --json`]);
  });

  it("says no index for a binary that is missing, and for one that fails, without throwing", async () => {
    const reader = createCodeGraph({ binary: "/nonexistent/codegraph" });
    expect(await reader.ready(os(), 0)).toBe(false);
    await expect(reader.symbols(os(), "src/a.ts", 0)).rejects.toThrow();
    const failing = await standIn("exit 3");
    expect(await createCodeGraph({ binary: failing.binary }).ready(failing.dir, 0)).toBe(false);
  });

  it("gives up on a call after its time, and on one that prints more than 1 MiB", async () => {
    const slow = await standIn("exec sleep 5");
    const reader = createCodeGraph({ binary: slow.binary, timeoutMs: 150 });
    expect(await reader.ready(slow.dir, 0)).toBe(false);
    const big = await standIn("head -c 2097152 /dev/zero | tr '\\0' 'a'; exit 0");
    const printing = createCodeGraph({ binary: big.binary });
    expect(await printing.ready(big.dir, 0)).toBe(false);
    await expect(printing.symbols(big.dir, "src/a.ts", 0)).rejects.toThrow("too much");
  });
});

describe("a declaration resolved against the recorded index", () => {
  it("knows the names it lists, keeps the others and the files it does not hold as written, and builds nothing", async () => {
    const graph = await standIn();
    const out = await resolveItems(
      createCodeGraph({ binary: graph.binary }),
      graph.dir,
      {
        changes: [
          { path: "src/invoice.ts", name: "refundCents" },
          { path: "src/invoice.ts", name: "InvoiceLine.amount" },
          { path: "src/invoice.ts", name: "nope" },
        ],
        maybes: [],
        uses: [{ path: "src/new.ts", name: "thing" }],
        provides: [],
      },
      () => 0,
    );
    expect(out.notes).toEqual({
      index: "ready",
      unresolved: [
        { path: "src/invoice.ts", name: "nope", candidates: [] },
        { path: "src/new.ts", name: "thing", candidates: [] },
      ],
    });
    expect(graph.calls().map((call) => call.split(" ")[0])).toEqual(["status", "node", "node"]);
    expect(graph.forbidden()).toBe(false);
  });
});

describe("the reader's memory", () => {
  const counting = (answer: (args: ReadonlyArray<string>) => string) => {
    const seen: string[] = [];
    const runner: Runner = async (_binary, args) => {
      seen.push(args[0] ?? "");
      return answer(args);
    };
    return { runner, seen };
  };
  const status = JSON.stringify(ready);

  it("keeps a ready answer for 20 seconds and another for a minute", async () => {
    const good = counting(() => status);
    const reader = createCodeGraph({ binary: "/x", run: good.runner });
    await reader.ready("/work", 0);
    await reader.ready("/work", 19_999);
    expect(good.seen).toEqual(["status"]);
    await reader.ready("/work", 20_001);
    expect(good.seen).toEqual(["status", "status"]);
    const bad = counting(() => JSON.stringify(none));
    const wary = createCodeGraph({ binary: "/x", run: bad.runner });
    await wary.ready("/work", 0);
    await wary.ready("/work", 59_999);
    expect(bad.seen).toEqual(["status"]);
    await wary.ready("/work", 60_001);
    expect(bad.seen).toEqual(["status", "status"]);
  });

  it("keeps a file's symbols for 30 seconds", async () => {
    const files = counting(() => JSON.stringify(money));
    const reader = createCodeGraph({ binary: "/x", run: files.runner });
    await reader.symbols("/work", "src/money.ts", 0);
    await reader.symbols("/work", "src/money.ts", 29_999);
    expect(files.seen).toEqual(["node"]);
    await reader.symbols("/work", "src/money.ts", 30_001);
    expect(files.seen).toEqual(["node", "node"]);
  });

  it("leaves a checkout alone for ten minutes after three failures in a row", async () => {
    const failing = counting(() => {
      throw new Error("process exited 1");
    });
    const reader = createCodeGraph({ binary: "/x", run: failing.runner });
    for (const at of [0, 1_000, 2_000]) {
      await expect(reader.symbols("/work", `src/f${at}.ts`, at)).rejects.toThrow("exited");
    }
    expect(failing.seen).toHaveLength(3);
    await expect(reader.symbols("/work", "src/more.ts", 3_000)).rejects.toThrow("paused");
    expect(await reader.ready("/work", 3_000)).toBe(false);
    expect(failing.seen).toHaveLength(3);
    await expect(reader.symbols("/work", "src/more.ts", 602_001)).rejects.toThrow("exited");
    expect(failing.seen).toHaveLength(4);
  });
});
