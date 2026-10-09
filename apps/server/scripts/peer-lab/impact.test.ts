// @effect-diagnostics nodeBuiltinImport:off - native fixture adapter proof, no servers or real indexes.
import { it, expect } from "vite-plus/test";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { installImpactGraph, impactBaseline } from "./impact.ts";
import { createCodeGraph } from "../../src/peerHub/plugins/impact/client/codegraph.ts";
it("the lab replay supplies exact bounded maps and repository-only calls through the actual native adapter", async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "peer-impact-lab-replay-"));
  try {
    await NodeFSP.mkdir(NodePath.join(root, "src"));
    impactBaseline(root);
    const binary = installImpactGraph(root),
      cg = createCodeGraph({ binary });
    expect((await cg.health(root, 0)).state).toBe("ready");
    expect(await cg.symbols(root, "src/money.ts")).toMatchObject([
      { name: "formatPrice", path: "src/money.ts", start: 1, end: 1 },
    ]);
    const symbols = await cg.symbols(root, "src/receipt.ts"),
      receipt = symbols.find((symbol) => symbol.name === "receiptLine")!;
    expect(receipt).toMatchObject({ path: "src/receipt.ts", start: 2, end: 2 });
    expect(await cg.callees(root, receipt)).toEqual([
      { name: "formatPrice", path: "src/money.ts" },
    ]);
    const calls = (
      await NodeFSP.readFile(NodePath.join(root, "impact-codegraph-calls.jsonl"), "utf8")
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { args: string[] });
    expect(
      calls.every((call) => ["status", "node", "search", "callees"].includes(call.args[0]!)),
    ).toBe(true);
    expect(
      calls
        .filter((call) => call.args[0] === "node")
        .every((call) => call.args.includes("--symbols-only")),
    ).toBe(true);
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});
