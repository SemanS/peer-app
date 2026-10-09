// @effect-diagnostics nodeBuiltinImport:off - isolated storage failure fixtures.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";
import { createLocalStore, dayAt, dayOf } from "./client/localStore.ts";
import { init } from "./vocabulary.ts";
it("keeps private switches per identity, writes atomically and caches completed days", async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "peer-metrics-store-"));
  try {
    const now = Date.parse("2026-10-09T00:00:00Z"),
      store = createLocalStore(root, () => now);
    await store.load();
    store.consent("ana@test", "acme").sharing = true;
    await store.saveState();
    const restarted = createLocalStore(root, () => now);
    await restarted.load();
    expect(restarted.consent("ana@test", "acme").sharing).toBe(true);
    expect(restarted.consent("bob@test", "acme").sharing).toBe(false);
    const row = { ...init(), counters: { "pr.checked": 1 } };
    await store.save("acme", "pay", "2026-10-08", row);
    await NodeFSP.rm(NodePath.join(root, "acme", "pay", "2026-10-08.json"));
    expect(await store.read("acme", "pay", "2026-10-08")).toEqual(row);
    expect(await store.read("acme", "pay", "2026-10-08")).toEqual(row);
    await store.save("acme", "pay", "2026-10-08", row);
    expect(
      (await NodeFSP.stat(NodePath.join(root, "acme", "pay", "2026-10-08.json"))).mode & 0o777,
    ).toBe(0o600);
    expect((await NodeFSP.stat(NodePath.join(root, "acme"))).mode & 0o777).toBe(0o700);
    expect(() => store.save("..", "pay", "2026-10-08", row)).toThrow();
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});
it("prunes only expired files, moves corrupted rows aside and erases every local file", async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "peer-metrics-store-"));
  try {
    const now = Date.parse("2026-10-09T00:00:00Z"),
      store = createLocalStore(root, () => now),
      today = dayOf(now);
    await store.save("acme", "pay", dayAt(today, -401), init());
    await store.save("acme", "pay", dayAt(today, -399), init());
    await store.prune();
    expect((await store.files()).map((f) => f.day)).toEqual([dayAt(today, -399)]);
    const bad = NodePath.join(root, "acme", "pay", today + ".json");
    await NodeFSP.writeFile(bad, "truncated{");
    expect(await store.read("acme", "pay", today)).toBeNull();
    expect(await NodeFSP.readdir(NodePath.dirname(bad))).toContain(today + ".json.corrupt." + now);
    await expect(store.read("acme/path", "pay", today)).rejects.toThrow();
    await store.eraseAll();
    expect(await NodeFSP.stat(root).catch(() => null)).toBeNull();
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});
it("rejects malformed persisted consent and restores prototype-named ids as ordinary private keys", async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "peer-metrics-state-"));
  try {
    const now = Date.parse("2026-10-09T00:00:00Z"),
      store = createLocalStore(root, () => now);
    store.consent("constructor", "constructor").sharing = true;
    await store.saveState();
    const restarted = createLocalStore(root, () => now);
    await restarted.load();
    expect(restarted.consent("constructor", "constructor").sharing).toBe(true);
    expect(restarted.consent("constructor", "acme").sharing).toBe(false);
    await NodeFSP.writeFile(
      NodePath.join(root, "state.json"),
      JSON.stringify({
        ana: {
          workspaces: { acme: { sharing: "true", markers: {} } },
          cursors: {},
          checked: [],
          conflicting: [],
        },
      }),
    );
    const bad = createLocalStore(root, () => now);
    await bad.load();
    expect(bad.consent("ana", "acme").sharing).toBe(false);
    expect(await NodeFSP.readdir(root)).toContain(`state.json.corrupt.${now}`);
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});
