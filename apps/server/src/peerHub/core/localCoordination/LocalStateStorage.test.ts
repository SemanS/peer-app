// @effect-diagnostics nodeBuiltinImport:off - isolated storage crash and migration fixtures.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import { describe, expect, it } from "vite-plus/test";
import { LocalStateStorage } from "./LocalStateStorage.ts";
import { LocalAuthority } from "./LocalAuthority.ts";
import { readLocalStoredState } from "./localStore.ts";

const decode = (value: unknown) => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("invalid state");
  return value as Readonly<Record<string, unknown>>;
};
async function fixture() {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "peer-local-storage-"));
  const file = NodePath.join(directory, "state.json");
  return {
    file,
    directory,
    dispose: () => NodeFSP.rm(directory, { recursive: true, force: true }),
    pointer: async () =>
      JSON.parse(await NodeFSP.readFile(file, "utf8")) as {
        storageFormat: number;
        snapshot: string;
        journal: string;
        bytes: number;
        sequence: number;
      },
  };
}
const base = () => ({
  version: 2,
  contexts: { one: { version: 1, text: "current" } },
  versions: { one: [{ version: 1, text: "historical".repeat(10000) }] },
  reads: [],
  manifests: {},
  operations: [{ key: "large-write", result: "cached payload".repeat(10000) }],
});

describe("Local incremental authority persistence", () => {
  it("migrates legacy JSON without dropping history and journals receipts without rewriting it or cached operations", async () => {
    const test = await fixture();
    try {
      const original = base();
      await NodeFSP.writeFile(test.file, JSON.stringify(original));
      const storage = new LocalStateStorage(test.file);
      expect(await storage.load(decode)).toEqual(original);
      const first = { ...original, reads: [{ scope: "one", version: 1 }] };
      await storage.save(first);
      const pointer = await test.pointer();
      const snapshot = NodePath.join(`${test.file}.store`, `${pointer.snapshot}.snapshot.json`);
      const before = await NodeFSP.stat(snapshot);
      const next = {
        ...first,
        reads: [{ scope: "one", version: 2 }],
        operations: [...first.operations, { key: "read", result: "small" }],
      };
      await storage.save(next);
      const committed = await test.pointer();
      expect(committed.snapshot).toBe(pointer.snapshot);
      expect((await NodeFSP.stat(snapshot)).mtimeMs).toBe(before.mtimeMs);
      expect(committed.bytes).toBeLessThan(2000);
      expect((await NodeFSP.stat(test.file)).size).toBeLessThan(1000);
      expect(await new LocalStateStorage(test.file).load(decode)).toEqual(next);
    } finally {
      await test.dispose();
    }
  });

  it("ignores an uncommitted partial append and removes it before the next committed write", async () => {
    const test = await fixture();
    try {
      const storage = new LocalStateStorage(test.file);
      await storage.load(decode);
      const first = base();
      await storage.save(first);
      const next = { ...first, reads: ["one"] };
      await storage.save(next);
      let pointer = await test.pointer();
      const path = NodePath.join(`${test.file}.store`, pointer.journal);
      await NodeFSP.appendFile(path, '{"partial');
      const restarted = new LocalStateStorage(test.file);
      const recovered = await restarted.load(decode);
      expect(recovered).toEqual(next);
      const final = { ...next, reads: ["one", "two"] };
      await restarted.save(final);
      pointer = await test.pointer();
      expect((await NodeFSP.stat(path)).size).toBe(pointer.bytes);
      expect(await new LocalStateStorage(test.file).load(decode)).toEqual(final);
    } finally {
      await test.dispose();
    }
  });

  it("refuses missing or corrupted committed evidence instead of falling back to an empty state", async () => {
    const test = await fixture();
    try {
      const storage = new LocalStateStorage(test.file);
      await storage.load(decode);
      const first = base();
      await storage.save(first);
      await storage.save({ ...first, reads: ["required"] });
      const pointer = await test.pointer();
      const journal = NodePath.join(`${test.file}.store`, pointer.journal);
      const text = await NodeFSP.readFile(test.file, "utf8");
      const bytes = await NodeFSP.readFile(journal);
      await NodeFSP.truncate(journal, pointer.bytes - 1);
      await expect(new LocalStateStorage(test.file).load(decode)).rejects.toThrow("missing");
      expect(await NodeFSP.readFile(test.file, "utf8")).toBe(text);
      await NodeFSP.writeFile(journal, bytes);
      const snapshot = NodePath.join(`${test.file}.store`, `${pointer.snapshot}.snapshot.json`);
      await NodeFSP.appendFile(snapshot, " ");
      await expect(new LocalStateStorage(test.file).load(decode)).rejects.toThrow("checksum");
      await NodeFSP.rm(journal);
      await expect(new LocalStateStorage(test.file).load(decode)).rejects.toThrow();
    } finally {
      await test.dispose();
    }
  });

  it("compacts by committing a new complete snapshot before retiring the old journal", async () => {
    const test = await fixture();
    try {
      const storage = new LocalStateStorage(test.file, { compactAfterBytes: 1 });
      await storage.load(decode);
      const first = base();
      await storage.save(first);
      const old = await test.pointer();
      const next = { ...first, reads: ["required"] };
      await storage.save(next);
      const pointer = await test.pointer();
      expect(pointer.journal).not.toBe(old.journal);
      expect(pointer.bytes).toBe(0);
      expect(await new LocalStateStorage(test.file).load(decode)).toEqual(next);
      await expect(
        NodeFSP.stat(NodePath.join(`${test.file}.store`, old.journal)),
      ).rejects.toThrow();
    } finally {
      await test.dispose();
    }
  });

  it("preserves restart lease fencing when the next mutation only records an unrelated read", async () => {
    const test = await fixture();
    try {
      const report = {
        id: "keeper",
        project: "app",
        label: "work",
        status: "working" as const,
        files: [],
        claims: [],
      };
      const first = new LocalAuthority(test.file, "here");
      await first.report([report]);
      const kept = await first.keepContext("app", "project", "keeper", false);
      if ("refused" in kept) throw new Error("keeper");
      await first.writeContext("app", "project", "keeper", 0, "first", kept.epoch);
      const second = new LocalAuthority(test.file, "here");
      await second.report([report]);
      const epoch = (await second.readContext("app", "project"))!.epoch!;
      await second.contextRead("app", "project", "keeper", 1, "read-after-restart");
      const third = new LocalAuthority(test.file, "here");
      expect((await third.readContext("app", "project"))!.epoch).toBe(epoch + 1);
      expect((await third.readContext("app", "project"))!.keeper).toBeUndefined();
      const persisted = await readLocalStoredState(test.file);
      expect(persisted!.contexts[JSON.stringify(["app", "project"])]!.epoch).toBe(epoch);
      expect(persisted!.contexts[JSON.stringify(["app", "project"])]!.keeper).toBeUndefined();
    } finally {
      await test.dispose();
    }
  });

  it("keeps the previous commit after pointer replacement fails, then discards the orphan append on retry", async () => {
    const test = await fixture();
    try {
      const storage = new LocalStateStorage(test.file);
      await storage.load(decode);
      const first = base();
      await storage.save(first);
      const original = await test.pointer();
      const backup = `${test.file}.previous`;
      await NodeFSP.rename(test.file, backup);
      await NodeFSP.mkdir(test.file);
      await expect(storage.save({ ...first, reads: ["failed input"] })).rejects.toThrow();
      await NodeFSP.rmdir(test.file);
      await NodeFSP.rename(backup, test.file);
      expect(await new LocalStateStorage(test.file).load(decode)).toEqual(first);
      const final = { ...first, reads: ["successful input"] };
      await storage.save(final);
      expect((await test.pointer()).sequence).toBe(original.sequence + 1);
      expect(await new LocalStateStorage(test.file).load(decode)).toEqual(final);
    } finally {
      await test.dispose();
    }
  });

  it("blocks further access after an uncertain post-rename commit until a validated restart", async () => {
    const test = await fixture();
    try {
      const storage = new LocalStateStorage(test.file);
      await storage.load(decode);
      const first = base();
      await storage.save(first);
      const sync = storage["syncDirectory"].bind(storage);
      storage["syncDirectory"] = async (path) => {
        if (path === test.directory) throw new Error("Injected directory fsync I/O failure");
        await sync(path);
      };
      const next = { ...first, reads: ["committed before sync error"] };
      await expect(storage.save(next)).rejects.toThrow("I/O failure");
      await expect(storage.save(first)).rejects.toThrow("requires a restart");
      await expect(storage.load(decode)).rejects.toThrow("requires a restart");
      expect(await new LocalStateStorage(test.file).load(decode)).toEqual(next);
    } finally {
      await test.dispose();
    }
  });

  it("cleans a failed compaction baseline without deleting the currently committed generation", async () => {
    const test = await fixture();
    try {
      const storage = new LocalStateStorage(test.file, { compactAfterBytes: 1 });
      await storage.load(decode);
      const first = base();
      await storage.save(first);
      const files = (await NodeFSP.readdir(`${test.file}.store`)).toSorted();
      const sync = storage["syncDirectory"].bind(storage);
      let calls = 0;
      storage["syncDirectory"] = async (path) => {
        if (path === `${test.file}.store` && ++calls === 2)
          throw new Error("Injected journal entry sync failure");
        await sync(path);
      };
      await expect(storage.save({ ...first, reads: ["failed compaction"] })).rejects.toThrow(
        "entry sync failure",
      );
      expect((await NodeFSP.readdir(`${test.file}.store`)).toSorted()).toEqual(files);
      expect(await new LocalStateStorage(test.file).load(decode)).toEqual(first);
      storage["syncDirectory"] = sync;
      const next = { ...first, reads: ["retry"] };
      await storage.save(next);
      expect(await new LocalStateStorage(test.file).load(decode)).toEqual(next);
    } finally {
      await test.dispose();
    }
  });

  it("refuses a missing commit pointer when durable evidence still exists", async () => {
    const test = await fixture();
    try {
      const local = new LocalAuthority(test.file, "here");
      await local.report([
        { id: "reader", project: "app", label: "work", status: "working", files: [], claims: [] },
      ]);
      await NodeFSP.rm(test.file);
      const restarted = new LocalAuthority(test.file, "here");
      await expect(restarted.staleReads("app", "reader")).rejects.toThrow(
        "commit pointer is missing",
      );
      await expect(restarted.report([])).rejects.toThrow("commit pointer is missing");
      await expect(NodeFSP.stat(test.file)).rejects.toThrow();
    } finally {
      await test.dispose();
    }
  });

  it("supports the Windows durability boundary without opening directory handles", async () => {
    const test = await fixture();
    try {
      const storage = new LocalStateStorage(test.file, { platform: "win32" });
      await storage.load(decode);
      const first = base();
      await storage.save(first);
      await storage.save({ ...first, reads: ["one"] });
      expect(
        await new LocalStateStorage(test.file, { platform: "win32" }).load(decode),
      ).toMatchObject({ reads: ["one"] });
    } finally {
      await test.dispose();
    }
  });
});
