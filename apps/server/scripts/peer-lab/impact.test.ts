// @effect-diagnostics nodeBuiltinImport:off - native fixture adapter proof, no servers or real indexes.
import { it, expect } from "vite-plus/test";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { installImpactGraph, impactBaseline } from "./impact.ts";
import { createCodeGraph } from "../../src/peerHub/plugins/impact/client/codegraph.ts";
import { createDiff } from "../../src/peerHub/plugins/impact/client/diff.ts";
import { checkSession } from "../../src/peerHub/plugins/impact/client/check.ts";
import { runProcess } from "../../src/peerHub/plugins/impact/client/process.ts";
import { newFootprintState } from "../../src/peerHub/plugins/impact/footprint.ts";
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
it("both changed lab checkouts produce the signature and incoming use through native Git and CodeGraph", async () => {
  const directory = await NodeFSP.mkdtemp(
    NodePath.join(NodeOS.tmpdir(), "peer-impact-lab-checkouts-"),
  );
  try {
    const roots = [NodePath.join(directory, "ana"), NodePath.join(directory, "bob")];
    for (const [i, root] of roots.entries()) {
      await NodeFSP.mkdir(NodePath.join(root, "src"), { recursive: true });
      impactBaseline(root);
      const git = (args: string[]) => runProcess("git", args, root);
      await git(["init", "--quiet", `--initial-branch=ip${i + 1}-impact`]);
      await git(["add", "src/money.ts", "src/receipt.ts"]);
      await git([
        "-c",
        "user.name=Lab",
        "-c",
        "user.email=lab@acme.test",
        "-c",
        "core.hooksPath=/dev/null",
        "commit",
        "--quiet",
        "-m",
        "impact baseline",
      ]);
      await git(["update-ref", "refs/remotes/origin/main", "HEAD"]);
    }
    await NodeFSP.writeFile(
      NodePath.join(roots[0]!, "src/money.ts"),
      "export function formatPrice(value: number, currency?: string): string { return String(value); }\n",
    );
    await NodeFSP.writeFile(
      NodePath.join(roots[1]!, "src/receipt.ts"),
      'import { formatPrice } from "./money";\nexport function receiptLine(value: number): string { return formatPrice(value + 0); }\n',
    );
    const binary = installImpactGraph(directory),
      results = await Promise.all(
        roots.map((root, i) =>
          checkSession(
            {
              id: `claude:lab-impact-${i ? "bob" : "ana"}`,
              project: "lab",
              root,
              files: [i ? "src/receipt.ts" : "src/money.ts"],
              branch: "main",
              provided: [],
              state: newFootprintState(),
              now: 0,
            },
            createCodeGraph({ binary }),
            createDiff(),
            new AbortController().signal,
          ),
        ),
      );
    expect(results.map((r) => r.health.state)).toEqual(["ready", "ready"]);
    expect(results[0]!.footprint.changed).toMatchObject([
      { name: "formatPrice", path: "src/money.ts", change: "signature", rev: 1 },
    ]);
    expect(results[1]!.footprint.uses).toEqual([
      {
        name: "formatPrice",
        path: "src/money.ts",
        from: "receiptLine",
        fromPath: "src/receipt.ts",
      },
    ]);
  } finally {
    await NodeFSP.rm(directory, { recursive: true, force: true });
  }
}, 10_000);
