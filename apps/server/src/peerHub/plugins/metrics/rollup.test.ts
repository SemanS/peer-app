// @effect-diagnostics nodeBuiltinImport:off - isolated day files and a failing disk fixture.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as DateTime from "effect/DateTime";
import { expect, it } from "vite-plus/test";
import { createLocalStore } from "./client/localStore.ts";
import { createCollector } from "./rollup.ts";
it("keeps UTC days/projects separate, deduplicates requests and retries a failed flush intact", async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "peer-metrics-fold-"));
  try {
    let now = Date.parse("2026-10-08T23:59:58Z"),
      failures = 0;
    const path = NodePath.join(root, "metrics"),
      store = createLocalStore(path, () => now),
      collector = createCollector(
        store,
        () => now,
        () => failures++,
      );
    const event = (project: string, t = DateTime.formatIso(DateTime.makeUnsafe(now))) => ({
      event: "provider.usage",
      workspace: "acme",
      project,
      t,
      session: "codex:a",
      turnId: t,
      index: 0,
      inputTokens: 4,
    });
    collector.record(event("pay"));
    collector.record(event("pay"));
    now = Date.parse("2026-10-09T00:00:03Z");
    collector.record(event("pay"));
    collector.record(event("other"));
    expect(
      collector.sum("acme", "pay", "2026-10-08", "2026-10-09").counters["provider.requests"],
    ).toBe(2);
    expect(collector.snapshot("acme", "other", "2026-10-09").counters["provider.requests"]).toBe(1);
    await NodeFSP.writeFile(path, "disk unavailable");
    await collector.flush();
    expect(failures).toBe(1);
    expect(collector.entries("acme")).toHaveLength(3);
    await NodeFSP.rm(path);
    await collector.flush();
    expect(await store.files()).toHaveLength(3);
    const after = createCollector(
      createLocalStore(path, () => now),
      () => now,
      () => failures++,
    );
    await after.load();
    expect(after.sum("acme", "pay", "2026-10-08", "2026-10-09").counters["provider.requests"]).toBe(
      2,
    );
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});
