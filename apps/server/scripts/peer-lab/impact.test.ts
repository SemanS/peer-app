// @effect-diagnostics nodeBuiltinImport:off - native fixture adapter proof, no servers or real indexes.
import { it, expect } from "vite-plus/test";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import {
  installImpactGraph,
  impactBaseline,
  readyImpactGraph,
  waitImpactPair,
  waitImpactDismissal,
  impactLab,
  waitImpactOpening,
} from "./impact.ts";
import { keeperLine } from "../../src/peerHub/plugins/impact/text.ts";
import { impactView } from "../../src/peerHub/plugins/impact/fixtures.test.ts";
import ready from "../../src/peerHub/plugins/impact/__fixtures__/codegraph-0.50/ready.json" with { type: "json" };
import { createCodeGraph } from "../../src/peerHub/plugins/impact/client/codegraph.ts";
import { createDiff } from "../../src/peerHub/plugins/impact/client/diff.ts";
import { checkSession } from "../../src/peerHub/plugins/impact/client/check.ts";
import { runProcess } from "../../src/peerHub/plugins/impact/client/process.ts";
import { newFootprintState } from "../../src/peerHub/plugins/impact/footprint.ts";
const sessions = ["claude:lab-impact-ana", "claude:lab-impact-bob"] as const;
const paired = {
  records: impactView.records.map((record) => ({
    ...record,
    id: "lab-pair",
    project: "lab",
    sides: [
      { ...record.sides[0], session: sessions[0], task: "ip1" },
      { ...record.sides[1], session: sessions[1], task: "ip2" },
    ] as const,
    items: [
      {
        name: "formatPrice",
        path: "src/money.ts",
        change: "signature" as const,
        changer: sessions[0],
        from: [{ name: "receiptLine", path: "src/receipt.ts" }],
      },
    ],
  })),
  provided: [],
};
it("the pair observer waits for the exact two sessions and signature use, ignoring unrelated and stale pairs", async () => {
  let now = 0;
  const unrelated = {
    ...paired,
    records: paired.records.map((r) => ({
      ...r,
      id: "unrelated",
      sides: [r.sides[0], { ...r.sides[1], session: "claude:other" }] as const,
    })),
  };
  const result = await waitImpactPair({
    view: async () => (now >= 1000 ? paired : unrelated),
    health: async () => [{ computer: "Ana", state: "ready", open: 4 }],
    pause: async (ms) => {
      now += ms;
    },
    say: () => {},
  });
  expect(result.view.records[0]?.id).toBe("lab-pair");
  expect(now).toBe(1000);
  now = 0;
  const stale = await waitImpactPair({
    view: async () => ({
      ...paired,
      records: paired.records.map((r) => ({
        ...r,
        items: [{ ...r.items[0]!, from: [{ name: "differentUse", path: "src/receipt.ts" }] }],
      })),
    }),
    health: async () => [{ computer: "Ana", state: "ready", open: 2 }],
    pause: async (ms) => {
      now += ms;
    },
    say: () => {},
  });
  expect(stale.view.records[0]?.items[0]?.from[0]?.name).toBe("differentUse");
  expect(now).toBe(60000);
});
it("warmup consumes startup or notice format before changing code and awaits passive caches and persisted advice deltas", async () => {
  let now = 0,
    phase: "baseline" | "open" | "dismissed" | "off" = "baseline",
    changedAt = 0,
    dismissedAt = 0,
    baselineChecked = false;
  const written: Array<{ event: string; session: string; [key: string]: unknown }> = [],
    pending: Array<{ at: number; value: (typeof written)[number] }> = [],
    delivered = new Set<string>(),
    tasks = ["ip1", "ip2"],
    healthScopes: Array<ReadonlyArray<string> | undefined> = [],
    logs = () => {
      if (!baselineChecked && now >= 1000) {
        baselineChecked = true;
        for (const session of sessions)
          written.push({ event: "impact.check", session, state: "ready", changed: 0, uses: 0 });
      }
      for (let i = pending.length - 1; i >= 0; i--)
        if (pending[i]!.at <= now) written.push(pending.splice(i, 1)[0]!.value);
      return written;
    },
    agents = sessions.map((session, i) => ({
      name: i ? "Bob" : "Ana",
      start: () => {
        written.push({ event: "session.started", session, task: tasks[i] });
        return i ? {} : { additionalContext: keeperLine };
      },
      edit: () => ({}),
      hook: (event: string) => {
        let text = "";
        if (event === "UserPromptSubmit") {
          if (phase === "baseline") {
            expect(now).toBeGreaterThanOrEqual(1000);
            if (i) text = keeperLine;
          } else if (phase === "open" && !delivered.has(session)) {
            expect(now - changedAt).toBeGreaterThanOrEqual(1000);
            text = "Peer · impact (advice): formatPrice is used from receiptLine";
            delivered.add(session);
          }
          if (text)
            pending.push({
              at: now + 250,
              value: { event: "impact.told", session, chars: text.length },
            });
          pending.push({ at: now + 250, value: { event: "hook", session, hookEvent: event } });
        }
        return { additionalContext: text };
      },
      peer: () => "",
    }));
  await impactLab({
    agents: [agents[0]!, agents[1]!],
    roots: ["/ana", "/bob"],
    view: async () => (phase === "open" ? paired : { records: [], provided: [] }),
    health: async (scope?: ReadonlyArray<string>) => {
      healthScopes.push(scope);
      return [0, 1].map((i) => ({
        computer: i ? "Bob" : "Ana",
        eachTaskOpen: phase === "open" && now - changedAt >= (i ? 750 : 1000),
        state: now >= 1000 ? "ready" : "not checked",
        open:
          phase === "baseline" || phase === "off"
            ? 0
            : phase === "dismissed"
              ? now - dismissedAt >= 750
                ? 0
                : 2
              : now - changedAt >= (i ? 750 : 1000)
                ? 2
                : 0,
      }));
    },
    changed: () => {
      expect(baselineChecked).toBe(true);
      expect(logs().filter((e) => e.event === "hook")).toHaveLength(2);
      expect(logs().filter((e) => e.event === "impact.told")).toEqual([
        { event: "impact.told", session: sessions[1], chars: keeperLine.length },
      ]);
      phase = "open";
      changedAt = now;
    },
    dismiss: async () => {
      phase = "dismissed";
      dismissedAt = now;
    },
    reopen: async () => {
      phase = "open";
    },
    setEnabled: async (enabled) => {
      if (!enabled) phase = "off";
    },
    check: (ok, label) => {
      if (!ok) throw new Error(label);
    },
    pause: async (ms) => {
      now += ms;
    },
    say: () => {},
    events: logs,
  });
  expect(healthScopes.some((scope) => scope?.join(",") === tasks.join(","))).toBe(true);
  expect(logs().filter((e) => e.event === "impact.told" && e.session === sessions[0])).toHaveLength(
    1,
  );
  expect(logs().filter((e) => e.event === "impact.told" && e.session === sessions[1])).toHaveLength(
    2,
  );
});
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
it("dismissal waits for both cached views and fails boundedly if the remote observation is missing", async () => {
  let now = 0;
  const health = () =>
    Promise.resolve([
      { computer: "Ana", state: "ready", open: now >= 1250 ? 0 : 2 },
      { computer: "Bob", state: "ready", open: 0 },
    ]);
  const pause = async (ms: number) => {
    now += ms;
  };
  expect(
    (await waitImpactDismissal({ health, pause })).every((computer) => computer.open === 0),
  ).toBe(true);
  expect(now).toBe(1250);
  now = 0;
  const missing = await waitImpactDismissal({
    health: async () => [
      { computer: "Ana", state: "ready", open: 2 },
      { computer: "Bob", state: "ready", open: 0 },
    ],
    pause,
  });
  expect(missing[0]?.open).toBe(2);
  expect(now).toBe(10000);
});
it("opening waits for both passive caches, while an absent slice or missing root fails within ten seconds", async () => {
  let now = 0,
    reads = 0;
  const pause = async (ms: number) => {
    now += ms;
  };
  const opened = await waitImpactOpening({
    health: async () => {
      reads++;
      return [
        { computer: "Ana", state: "ready", open: now >= 1250 ? 2 : 0, eachTaskOpen: now >= 1250 },
        { computer: "Bob", state: "ready", open: 2, eachTaskOpen: true },
      ];
    },
    pause,
  });
  expect(opened.every((computer) => computer.open === 2)).toBe(true);
  expect(now).toBe(1250);
  expect(reads).toBe(6);
  for (const missing of [
    { computer: "Ana", state: "ready", open: undefined },
    { computer: "Ana", state: "not checked", open: 2 },
    { computer: "Ana", state: "ready", open: 0, eachTaskOpen: false },
    { computer: "Ana", state: "ready", open: 1, eachTaskOpen: false },
  ]) {
    now = 0;
    reads = 0;
    const absent = await waitImpactOpening({
      health: async () => {
        reads++;
        return [missing, { computer: "Bob", state: "ready", open: 2, eachTaskOpen: true }];
      },
      pause,
    });
    expect(absent[0]).toEqual(missing);
    expect(now).toBe(10000);
    expect(reads).toBe(40);
  }
});
it("a missing persisted warm hook stops before any code change even if startup already consumed formatting", async () => {
  let now = 0,
    changes = 0;
  const events = sessions.flatMap((session, i) => [
    { event: "session.started", session, task: i ? "ip2" : "ip1" },
    { event: "impact.check", session, state: "ready", changed: 0, uses: 0 },
  ]);
  const agent = {
    name: "Agent",
    start: () => ({ additionalContext: keeperLine }),
    edit: () => ({}),
    hook: () => ({}),
    peer: () => "",
  };
  await expect(
    impactLab({
      agents: [agent, agent],
      roots: ["/ana", "/bob"],
      view: async () => {
        throw new Error("Hub must not be read before baseline logs");
      },
      health: async () => sessions.map((computer) => ({ computer, state: "ready", open: 0 })),
      events: () => events,
      pause: async (ms) => {
        now += ms;
      },
      say: () => {},
      changed: () => {
        changes++;
      },
      dismiss: async () => {},
      reopen: async () => {},
      setEnabled: async () => {},
      check: (ok, label) => {
        if (!ok) throw new Error(label);
      },
    }),
  ).rejects.toThrow("both baseline hooks reached their persisted log milestone");
  expect(now).toBe(10000);
  expect(changes).toBe(0);
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
      expect(results.map((r) => r.footprint.session)).toEqual(sessions);
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
