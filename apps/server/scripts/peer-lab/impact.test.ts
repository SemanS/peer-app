// @effect-diagnostics nodeBuiltinImport:off - native fixture adapter proof, no servers or real indexes.
import { it, expect } from "vite-plus/test";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { installImpactGraph, impactBaseline, readyImpactGraph, waitImpactPair } from "./impact.ts";
import { impactView } from "../../src/peerHub/plugins/impact/fixtures.test.ts";
import ready from "../../src/peerHub/plugins/impact/__fixtures__/codegraph-0.50/ready.json" with { type: "json" };
import { createCodeGraph } from "../../src/peerHub/plugins/impact/client/codegraph.ts";
import { createDiff } from "../../src/peerHub/plugins/impact/client/diff.ts";
import { checkSession } from "../../src/peerHub/plugins/impact/client/check.ts";
import { runProcess } from "../../src/peerHub/plugins/impact/client/process.ts";
import { newFootprintState } from "../../src/peerHub/plugins/impact/footprint.ts";
it("fixture installation and actual health readiness have distinct bounded limits and no retries", async () => {
  const calls: Array<{ args: ReadonlyArray<string>; timeout: number | undefined }> = [];
  await expect(
    readyImpactGraph("/fixture", ["/checkout"], async (_bin, args, _root, options) => {
      calls.push({ args, timeout: options?.timeoutMs });
      if (calls.length === 1) return JSON.stringify(ready);
      throw new Error("process deadline");
    }),
  ).rejects.toThrow("lab CodeGraph startup at /checkout: process deadline");
  expect(calls).toEqual([
    { args: ["status", "/checkout", "--json"], timeout: 10000 },
    { args: ["status", "/checkout", "--json"], timeout: 2000 },
  ]);
  let attempts = 0;
  await expect(
    readyImpactGraph("/fixture", ["/checkout"], async () => {
      attempts++;
      throw new Error("native launch failed");
    }),
  ).rejects.toThrow("lab CodeGraph bootstrap at /checkout: native launch failed");
  expect(attempts).toBe(1);
  for (const output of [
    "{",
    JSON.stringify({ ...ready, initialized: false }),
    JSON.stringify({ ...ready, extractionStatus: "corrupt" }),
  ]) {
    attempts = 0;
    await expect(
      readyImpactGraph("/fixture", ["/checkout"], async () => {
        attempts++;
        return output;
      }),
    ).rejects.toThrow("lab CodeGraph bootstrap at /checkout:");
    expect(attempts).toBe(1);
  }
});
it("the lab can observe one documented failed-health retry, while an otherwise missing pair stays bounded", async () => {
  const paired = {
    ...impactView,
    records: impactView.records.map((record) => ({
      ...record,
      items: record.items.map((item) => ({ ...item, name: "formatPrice" })),
    })),
  };
  let now = 0;
  const notices: string[] = [];
  const result = await waitImpactPair({
    view: async () => (now >= 72000 ? paired : { records: [], provided: [] }),
    health: async () => [{ computer: "Bob", state: now >= 67000 ? "ready" : "failed" }],
    pause: async (ms) => {
      now += ms;
    },
    say: (label) => {
      notices.push(label);
    },
  });
  expect(result.view.records).toHaveLength(1);
  expect(now).toBe(72000);
  expect(notices).toEqual(["Impact health retry"]);
  now = 0;
  const absent = await waitImpactPair({
    view: async () => ({ records: [], provided: [] }),
    health: async () => [{ computer: "Bob", state: "ready" }],
    pause: async (ms) => {
      now += ms;
    },
    say: () => {
      throw new Error("unexpected retry without failed health");
    },
  });
  expect(absent.view.records).toEqual([]);
  expect(now).toBe(60000);
});
it(
  "the lab replay supplies exact bounded maps and repository-only calls through the actual native adapter",
  async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "peer-impact-lab-replay-"));
    try {
      await NodeFSP.mkdir(NodePath.join(root, "src"));
      impactBaseline(root);
      const binary = installImpactGraph(root);
      await readyImpactGraph(binary, [root]);
      const cg = createCodeGraph({ binary });
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
  },
  10_000 + 8 * 2_000 + 4_000,
);
it(
  "both changed lab checkouts produce the signature and incoming use through native Git and CodeGraph",
  async () => {
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
      const binary = installImpactGraph(directory);
      await readyImpactGraph(binary, roots);
      const results = await Promise.all(
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
    // Cold fixture ≤10 s, eight Git setup calls ≤2 s each, two readiness calls ≤2 s,
    // then parallel checks with ≤6 s Git and ≤10 s CodeGraph per checkout, plus cleanup.
  },
  10_000 + 8 * 2_000 + 2 * 2_000 + 6_000 + 10_000 + 4_000,
);
