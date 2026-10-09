// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off - temporary log fixtures only.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { it, expect } from "vite-plus/test";
import { createMetricsLog, debugPathOf } from "./metricsLog.ts";
it("scrubs legacy content once, preserves projected counts and never touches debug evidence", async () => {
  const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "peer-metrics-log-")),
    path = NodePath.join(dir, "coordination.jsonl");
  try {
    const old =
      JSON.stringify({
        event: "cli",
        t: "2026-01-01T00:00:00Z",
        command: "note",
        args: ["SENTINEL"],
        out: "SENTINEL",
        outcome: "done",
      }) + "\ntruncated{";
    await NodeFSP.writeFile(path, old);
    await NodeFSP.writeFile(`${path}.1`, old);
    await NodeFSP.writeFile(debugPathOf(path), "SENTINEL-debug");
    const log = createMetricsLog({ path, forced: false });
    await log.idle();
    for (const p of [path, `${path}.1`]) {
      const text = await NodeFSP.readFile(p, "utf8");
      expect(text).not.toContain("SENTINEL");
      expect(text).toContain('"argCount":1');
      expect(text.startsWith('{"event":"log.format","v":2}\n')).toBe(true);
    }
    const before = await NodeFSP.stat(path);
    await createMetricsLog({ path, forced: false }).idle();
    const after = await NodeFSP.stat(path);
    expect(after.ino).toBe(before.ino);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(await NodeFSP.readFile(debugPathOf(path), "utf8")).toBe("SENTINEL-debug");
    expect((await NodeFSP.readdir(dir)).sort()).toEqual([
      "coordination.debug.jsonl",
      "coordination.jsonl",
      "coordination.jsonl.1",
    ]);
  } finally {
    await NodeFSP.rm(dir, { recursive: true, force: true });
  }
});
it("queues projected records, isolates throwing listeners and bounds opt-in debug/rotation", async () => {
  const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "peer-metrics-log-")),
    path = NodePath.join(dir, "coordination.jsonl");
  try {
    let now = 0;
    const log = createMetricsLog({ path, now: () => now, forced: false, rotateBytes: 130 });
    const events: string[] = [];
    log.subscribe(() => {
      throw Error("listener");
    });
    const unsubscribe = log.subscribe((r) => {
      expect(r).not.toHaveProperty("text");
      events.push(r.event);
    });
    log.setDebugUntil(86400000);
    log.record("hook", { chars: 80, ms: 5 }, { text: "SENTINEL" });
    await log.idle();
    expect(await NodeFSP.readFile(path, "utf8")).not.toContain("SENTINEL");
    expect(await NodeFSP.readFile(debugPathOf(path), "utf8")).toContain("SENTINEL");
    now = 86400001;
    log.record("future.metric", {}, { text: "AFTER-EXPIRY" });
    await log.idle();
    expect(await NodeFSP.readFile(debugPathOf(path), "utf8")).not.toContain("AFTER-EXPIRY");
    expect(log.debugState().on).toBe(false);
    unsubscribe();
    log.record("hook", { chars: 90, ms: 7 });
    log.record("hook", { chars: 100, ms: 9 });
    await log.idle();
    expect(events).toEqual(["hook", "future.metric"]);
    expect((await NodeFSP.readdir(dir)).filter((x) => x.endsWith(".1"))).toEqual([
      "coordination.jsonl.1",
    ]);
    expect(
      (await NodeFSP.readFile(path, "utf8")).startsWith('{"event":"log.format","v":2}\n'),
    ).toBe(true);
    expect((await NodeFSP.stat(debugPathOf(path))).mode & 0o777).toBe(0o600);
    log.setDebugUntil(now + 86400000);
    await log.idle();
    expect(await NodeFSP.readFile(debugPathOf(path), "utf8")).toBe("");
    log.deleteDebug();
    await log.idle();
    expect(await NodeFSP.stat(debugPathOf(path)).catch(() => null)).toBeNull();
  } finally {
    await NodeFSP.rm(dir, { recursive: true, force: true });
  }
});

it("restores a debug deadline without truncating and cannot switch off a forced diagnostic log", async () => {
  const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "peer-metrics-debug-"));
  try {
    const path = NodePath.join(dir, "coordination.jsonl");
    const log = createMetricsLog({ path, now: () => 100, forced: false });
    log.setDebugUntil(1000);
    log.record("hook", {}, { text: "KEPT" });
    await log.idle();
    const restored = createMetricsLog({ path, now: () => 200, forced: false });
    restored.setDebugUntil(1000, { keep: true });
    restored.record("hook", {}, { text: "RESTORED" });
    await restored.idle();
    expect(await NodeFSP.readFile(debugPathOf(path), "utf8")).toContain("KEPT");
    expect(await NodeFSP.readFile(debugPathOf(path), "utf8")).toContain("RESTORED");
    restored.setDebugUntil(null);
    restored.record("hook", {}, { text: "DISABLED" });
    await restored.idle();
    expect(await NodeFSP.readFile(debugPathOf(path), "utf8")).not.toContain("DISABLED");
    const forced = createMetricsLog({ path, forced: true });
    forced.setDebugUntil(null);
    forced.record("hook", {}, { text: "FORCED" });
    await forced.idle();
    expect(forced.debugState()).toMatchObject({ on: true, forced: true });
    expect(await NodeFSP.readFile(debugPathOf(path), "utf8")).toContain("FORCED");
  } finally {
    await NodeFSP.rm(dir, { recursive: true, force: true });
  }
});
it("a failed disk write leaves subscribers and subsequent calls usable", async () => {
  const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "peer-metrics-failure-"));
  try {
    const parent = NodePath.join(dir, "not-a-directory");
    await NodeFSP.writeFile(parent, "ordinary file");
    const log = createMetricsLog({
      path: NodePath.join(parent, "coordination.jsonl"),
      forced: false,
    });
    const events: string[] = [];
    log.subscribe((r) => events.push(r.event));
    log.record("hook", { ms: 2 });
    await expect(log.idle()).resolves.toBeUndefined();
    log.record("hook", { ms: 3 });
    await expect(log.idle()).resolves.toBeUndefined();
    expect(events).toEqual(["hook", "hook"]);
  } finally {
    await NodeFSP.rm(dir, { recursive: true, force: true });
  }
});
