// @effect-diagnostics nodeBuiltinImport:off globalDate:off - isolated durable checkpoint files and explicit time boundaries.
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import { CoordinationBroker } from "./Broker.ts";
import { LocalAuthority } from "../localCoordination/LocalAuthority.ts";
import { readLocalStoredState } from "../localCoordination/localStore.ts";
import { NO_PLUGINS } from "./host.ts";
import { commandArguments } from "./cli.ts";
import {
  checkpointInputs,
  inputCommand,
  resumeInputCheckpoint,
  saveInputCheckpoint,
} from "./inputCheckpoints.ts";
import { brokerFixture } from "./testkit.ts";

async function fixture() {
  let local!: LocalAuthority;
  let offline = false;
  let authority = "https://hub-a.test";
  const test = await brokerFixture(() => ({
    contextAuthority: () => authority,
    report: (_workspace, sessions) => local.report(sessions),
    staleReads: (_workspace, project, session) => {
      if (offline) return Promise.reject(new Error("offline"));
      return local.staleReads(project, session);
    },
    recoverInputs: (_workspace, ...args) => local.recoverInputs(...args),
    contextRead: (_workspace, ...args) => local.contextRead(...args),
    readContext: (_workspace, ...args) => local.readContext(...args),
    readContextVersion: (_workspace, ...args) => local.readContextVersion(...args),
    keepContext: (_workspace, ...args) => local.keepContext(...args),
  }));
  local = new LocalAuthority(NodePath.join(test.root, "authority.json"), "test");
  const seedSources = async (scopes: readonly string[]) => {
    const file = NodePath.join(test.root, "authority.json");
    const state = JSON.parse(JSON.stringify(await readLocalStoredState(file)));
    for (const scope of scopes) {
      const key = JSON.stringify(["app", scope]);
      state.contexts[key] ??= {
        project: "app",
        scope,
        version: 1,
        epoch: 0,
        updatedAt: new Date().toISOString(),
        text: `Canonical input ${scope}`,
      };
      state.versions[key] ??= [
        {
          version: 1,
          at: state.contexts[key].updatedAt,
          by: "local",
          added: [state.contexts[key].text],
          dropped: [],
          text: state.contexts[key].text,
        },
      ];
    }
    await NodeFSP.writeFile(file, JSON.stringify(state));
    local = new LocalAuthority(file, "test");
    await local.report(test.broker.reportFor("acme"));
  };
  const meet = async (id: string, thread = "peer:thread") => {
    await test.register(id);
    const session = test.broker.sessions.get(`claude:${id}`)!;
    session.thread = thread;
    await test.broker.syncNow();
    await seedSources([
      "task:one",
      "task:existing",
      "task:before",
      "task:future",
      "task:child",
      "task:parent",
      ...Array.from({ length: 13 }, (_, index) => `task:${index}`),
    ]);
    return session;
  };
  return {
    ...test,
    get local() {
      return local;
    },
    meet,
    seedSources,
    reloadAuthority: async () => {
      local = new LocalAuthority(NodePath.join(test.root, "authority.json"), "test");
      await local.report(test.broker.reportFor("acme"));
    },
    authority: (value: string) => {
      authority = value;
    },
    offline: (value: boolean) => {
      offline = value;
    },
  };
}
const digest = (text: string) => NodeCrypto.createHash("sha256").update(text).digest("hex");
const checkpointDir = (root: string) =>
  NodePath.join(root, "contexts", "acme", "app", "inputs", digest("https://hub-a.test"));

describe("durable context input checkpoints", () => {
  it("checkpoints declared reads at Stop and PreCompact, deduplicates unchanged state, and keeps the last snapshot offline", async () => {
    const test = await fixture();
    try {
      const session = await test.meet("source");
      await test.local.contextRead("app", "task:one", session.id, 1, "read");
      await test.broker.answerHook("Stop", session, {});
      const id = await saveInputCheckpoint(test.broker, session);
      await test.broker.answerHook("PreCompact", session, {});
      expect(await saveInputCheckpoint(test.broker, session)).toBe(id);
      expect(
        (await NodeFSP.readdir(checkpointDir(test.root))).filter((name) => name.endsWith(".json")),
      ).toHaveLength(1);
      test.offline(true);
      await checkpointInputs(test.broker, session);
      expect(
        await NodeFSP.readFile(NodePath.join(checkpointDir(test.root), `${id}.json`), "utf8"),
      ).toContain("task:one");
    } finally {
      await test.dispose();
    }
  });

  it("imports a provider continuation's full reference set without dropping existing dependencies or claiming reads", async () => {
    const test = await fixture();
    try {
      const source = await test.meet("source");
      for (let index = 0; index < 13; index++)
        await test.local.contextRead("app", `task:${index}`, source.id, 1, `${index}`);
      const id = await saveInputCheckpoint(test.broker, source);
      const target = await test.meet("target");
      await test.local.contextRead("app", "task:existing", target.id, 1, "existing");
      expect(await resumeInputCheckpoint(test.broker, target)).toContain(
        "Imported 14 input references",
      );
      expect(await test.local.staleReads("app", target.id)).toMatchObject({
        fresh: false,
        recovery: "revalidation-required",
      });
      expect(target.read.size).toBe(14);
      for (const read of (await test.local.staleReads("app", target.id)).reads ?? [])
        await test.local.contextRead("app", read.scope, target.id, 1, read.scope);
      expect(await resumeInputCheckpoint(test.broker, target)).toBeNull();
      expect(target.inputImports).toContain(id);
      expect((await test.local.staleReads("app", target.id)).fresh).toBe(true);
      expect(
        await NodeFSP.readFile(target.ownContextPath.replace(/\.md$/, ".memory.json"), "utf8"),
      ).toContain(id);
    } finally {
      await test.dispose();
    }
  });

  it("uses only a fork source snapshot before the declared cutoff and never the parent's future inputs", async () => {
    const test = await fixture();
    try {
      const source = await test.meet("parent", "peer:parent");
      await test.local.contextRead("app", "task:before", source.id, 1, "before");
      const before = await saveInputCheckpoint(test.broker, source);
      const oldText = JSON.parse(
        await NodeFSP.readFile(NodePath.join(checkpointDir(test.root), `${before}.json`), "utf8"),
      );
      // Give the source boundary a deterministic past timestamp, preserving the content checksum.
      oldText.at = "2026-01-01T00:00:00.000Z";
      const text = JSON.stringify(oldText);
      const id = digest(text);
      await NodeFSP.writeFile(NodePath.join(checkpointDir(test.root), `${id}.json`), text);
      await NodeFSP.writeFile(
        NodePath.join(checkpointDir(test.root), `${digest("peer:parent")}.history`),
        JSON.stringify([{ id, at: oldText.at }]),
      );
      await test.local.contextRead("app", "task:future", source.id, 1, "future");
      await saveInputCheckpoint(test.broker, source);
      const child = await test.meet("child", "peer:child");
      Object.assign(test.broker.host, {
        contextLineage: async () => ({
          required: true,
          sources: [{ thread: "peer:parent", cutoff: "2026-01-02T00:00:00.000Z" }],
        }),
      });
      expect(await resumeInputCheckpoint(test.broker, child)).toContain(
        "Imported 1 input references",
      );
      expect(
        (await test.local.staleReads("app", child.id)).reads?.map((read) => read.scope),
      ).toEqual(["task:before"]);
    } finally {
      await test.dispose();
    }
  });

  it("marks missing lineage coverage unavailable durably, and an explicit recovery can establish a new baseline", async () => {
    const test = await fixture();
    try {
      const child = await test.meet("child", "peer:child");
      Object.assign(test.broker.host, {
        contextLineage: async () => ({
          required: true,
          sources: [{ thread: "peer:missing", cutoff: "2026-01-01T00:00:00.000Z" }],
        }),
      });
      expect(await resumeInputCheckpoint(test.broker, child)).toContain("unavailable");
      expect(await test.local.staleReads("app", child.id)).toMatchObject({
        fresh: false,
        recovery: "unavailable",
        reads: [],
      });
      const incomplete = await saveInputCheckpoint(test.broker, child);
      expect(
        await inputCommand(
          test.broker,
          child,
          commandArguments([
            "recover",
            "Reviewed the task and checked all available inputs; source history was lost",
          ]),
        ),
      ).toContain("complete");
      expect((await test.local.staleReads("app", child.id)).fresh).toBe(true);
      const changes = await inputCommand(
        test.broker,
        child,
        commandArguments(["changes", "--since", incomplete]),
      );
      expect(changes).toContain("Baseline coverage: unavailable");
      expect(changes).not.toContain("declared revisions match");
      expect(await resumeInputCheckpoint(test.broker, child)).toBeNull();
      const restarted = new CoordinationBroker(test.broker.host);
      await restarted.sessionFor("claude", { session_id: "child", cwd: test.root }, undefined);
      const restored = restarted.sessions.get("claude:child")!;
      restored.thread = child.thread;
      await restarted.syncNow();
      expect(await resumeInputCheckpoint(restarted, restored)).toBeNull();
      expect(restored.inputRecovery).toBe("complete");
      await restarted.stop();
    } finally {
      await test.dispose();
    }
  });

  it("reports a 60-day return with changed and deleted sources without turning missing history into freshness", async () => {
    const test = await fixture();
    try {
      const source = await test.meet("source");
      const keep = await test.local.keepContext("app", "task:input", source.id, false);
      if ("refused" in keep) throw new Error("keeper refused");
      await test.local.writeContext("app", "task:input", source.id, 0, "Old plan", keep.epoch);
      await test.local.contextRead("app", "task:input", source.id, 1, "read");
      const id = await saveInputCheckpoint(test.broker, source);
      const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
      await NodeFSP.utimes(NodePath.join(checkpointDir(test.root), `${id}.json`), old, old);
      await test.local.writeContext(
        "app",
        "task:input",
        source.id,
        1,
        "Replacement plan",
        keep.epoch,
      );
      let result = await inputCommand(
        test.broker,
        source,
        commandArguments(["changes", "--since", id]),
      );
      expect(result).toContain("v1 → v2");
      Object.assign(test.broker.host, { readContext: async () => null });
      result = await inputCommand(
        test.broker,
        source,
        commandArguments(["changes", "--since", id]),
      );
      expect(result).toContain("source unavailable (required v1)");
      expect(result).not.toContain("unchanged v1");
    } finally {
      await test.dispose();
    }
  });

  it("pages 1000 declared inputs without losing coverage or reading every source on the first page", async () => {
    const test = await fixture();
    try {
      const session = await test.meet("source");
      const reads = Array.from({ length: 1000 }, (_, index) => ({
        scope: `task:${String(index).padStart(4, "0")}`,
        version: 1,
      }));
      await test.seedSources(reads.map((read) => read.scope));
      await test.local.recoverInputs(
        "app",
        session.id,
        "Rebuilt the complete task input list",
        reads,
        "reconstructed",
      );
      const id = await saveInputCheckpoint(test.broker, session);
      let calls = 0;
      Object.assign(test.broker.host, {
        readContext: async () => {
          calls++;
          return null;
        },
      });
      const first = await inputCommand(
        test.broker,
        session,
        commandArguments(["changes", "--since", id]),
      );
      expect(first).toContain("Coverage: 25 of 1000 inputs, page 1");
      expect(first).toContain(`--since ${id} --page 2`);
      expect(calls).toBe(25);
      const last = await inputCommand(
        test.broker,
        session,
        commandArguments(["changes", "--since", id, "--page", "40"]),
      );
      expect(last).toContain("task:0999");
      expect(last).not.toContain("Next:");
      expect((await test.local.staleReads("app", session.id)).reads).toHaveLength(1000);
    } finally {
      await test.dispose();
    }
  });

  it("merges declared child sources into the parent's existing inputs and preserves unavailable recovery", async () => {
    const test = await fixture();
    try {
      const child = await test.meet("child", "peer:child");
      await test.local.contextRead("app", "task:child", child.id, 1, "child");
      await saveInputCheckpoint(test.broker, child);
      const parent = await test.meet("parent", "peer:parent");
      await test.local.contextRead("app", "task:parent", parent.id, 1, "parent");
      Object.assign(test.broker.host, {
        contextLineage: async () => ({
          required: true,
          sources: [{ thread: "peer:child", cutoff: "2099-01-01T00:00:00.000Z" }],
        }),
      });
      expect(await resumeInputCheckpoint(test.broker, parent)).toContain(
        "Imported 2 input references",
      );
      expect(
        (await test.local.staleReads("app", parent.id)).reads?.map((read) => read.scope).toSorted(),
      ).toEqual(["task:child", "task:parent"]);
      await test.local.recoverInputs(
        "app",
        parent.id,
        "A different required source was removed",
        [{ scope: "task:parent", version: 1 }],
        "unavailable",
      );
      await test.local.recoverInputs(
        "app",
        parent.id,
        "Known transfer only",
        [{ scope: "task:parent", version: 1 }],
        "transferred",
      );
      await test.local.contextRead("app", "task:parent", parent.id, 1, "reread");
      expect((await test.local.staleReads("app", parent.id)).recovery).toBe("unavailable");
    } finally {
      await test.dispose();
    }
  });

  it("rejects tampered and cross-environment checkpoints and does not import private context text", async () => {
    const test = await fixture();
    try {
      const source = await test.meet("source");
      await NodeFSP.mkdir(NodePath.dirname(source.ownContextPath), { recursive: true });
      await NodeFSP.writeFile(source.ownContextPath, "PRIVATE secret analysis");
      const id = await saveInputCheckpoint(test.broker, source);
      const file = NodePath.join(checkpointDir(test.root), `${id}.json`);
      const original = await NodeFSP.readFile(file, "utf8");
      expect(original).not.toContain("PRIVATE");
      await NodeFSP.writeFile(file, `${original} `);
      const target = await test.meet("target");
      await expect(
        inputCommand(test.broker, target, commandArguments(["import", id, "Transfer"])),
      ).rejects.toThrow("changed");
      const foreign = JSON.stringify({
        ...JSON.parse(original),
        environment: "another-environment",
      });
      const foreignId = digest(foreign);
      await NodeFSP.writeFile(
        NodePath.join(checkpointDir(test.root), `${foreignId}.json`),
        foreign,
      );
      await expect(
        inputCommand(test.broker, target, commandArguments(["import", foreignId, "Transfer"])),
      ).rejects.toThrow("another authority or project");
      const foreignProject = JSON.stringify({
        ...JSON.parse(original),
        project: "another-project",
      });
      const projectId = digest(foreignProject);
      await NodeFSP.writeFile(
        NodePath.join(checkpointDir(test.root), `${projectId}.json`),
        foreignProject,
      );
      await expect(
        inputCommand(test.broker, target, commandArguments(["import", projectId, "Transfer"])),
      ).rejects.toThrow("another authority or project");
      expect((await test.local.staleReads("app", target.id)).reads).toEqual([]);
    } finally {
      await test.dispose();
    }
  });

  it("rejects the same environment and project checkpoint after changing Hub authorities", async () => {
    const test = await fixture();
    try {
      const source = await test.meet("source");
      await test.local.contextRead("app", "task:one", source.id, 1, "read");
      const id = await saveInputCheckpoint(test.broker, source);
      const original = await NodeFSP.readFile(
        NodePath.join(checkpointDir(test.root), `${id}.json`),
        "utf8",
      );
      test.authority("https://hub-b.test");
      const otherDir = NodePath.join(
        test.root,
        "contexts",
        "acme",
        "app",
        "inputs",
        digest("https://hub-b.test"),
      );
      await NodeFSP.mkdir(otherDir, { recursive: true });
      await NodeFSP.writeFile(NodePath.join(otherDir, `${id}.json`), original);
      await expect(
        inputCommand(test.broker, source, commandArguments(["import", id, "Transfer"])),
      ).rejects.toThrow("another authority or project");
      await expect(
        inputCommand(test.broker, source, commandArguments(["changes", "--since", id])),
      ).rejects.toThrow("another authority or project");
    } finally {
      await test.dispose();
    }
  });

  it("removes a deleted input only through explicit recovery with an audited reason", async () => {
    const test = await fixture();
    try {
      const session = await test.meet("source");
      await test.local.contextRead("app", "task:one", session.id, 1, "read");
      const file = NodePath.join(test.root, "authority.json");
      const stored = JSON.parse(JSON.stringify(await readLocalStoredState(file)));
      delete stored.contexts[JSON.stringify(["app", "task:one"])];
      delete stored.versions[JSON.stringify(["app", "task:one"])];
      await NodeFSP.writeFile(file, JSON.stringify(stored));
      await test.seedSources([]);
      expect((await test.local.staleReads("app", session.id)).recovery).toBe("unavailable");
      await expect(
        inputCommand(test.broker, session, commandArguments(["recover", "Checked the task"])),
      ).rejects.toThrow();
      expect(
        await inputCommand(
          test.broker,
          session,
          commandArguments([
            "recover",
            "The task no longer uses that deleted plan",
            "--drop",
            "task:one",
          ]),
        ),
      ).toContain("Removed declared input task:one");
      expect(await test.local.staleReads("app", session.id)).toMatchObject({
        fresh: true,
        recovery: "complete",
        reads: [],
      });
      const saved = JSON.parse(JSON.stringify(await readLocalStoredState(file)));
      expect(saved.manifests[JSON.stringify(["app", session.id])].reason).toContain(
        "Explicitly removed dependency task:one",
      );
    } finally {
      await test.dispose();
    }
  });

  it("revalidates exact canonical reads before review in the same turn", async () => {
    const test = await fixture();
    try {
      const source = await test.meet("source");
      await test.local.contextRead("app", "task:one", source.id, 1, "read");
      await saveInputCheckpoint(test.broker, source);
      const target = await test.meet("target");
      await resumeInputCheckpoint(test.broker, target);
      expect(target.inputRecovery).toBe("revalidation-required");
      await test.broker.contextCli(target, "task:one", undefined);
      expect(target.inputRecovery).toBe("complete");
      expect(await test.broker.handoffRefusal(target, "review")).toBeNull();
    } finally {
      await test.dispose();
    }
  });

  it("does not reuse an applied lineage boundary after changing Hub authority", async () => {
    const test = await fixture();
    try {
      const source = await test.meet("source", "peer:source");
      await test.local.contextRead("app", "task:one", source.id, 1, "read");
      await saveInputCheckpoint(test.broker, source);
      const target = await test.meet("target", "peer:target");
      Object.assign(test.broker.host, {
        contextLineage: async () => ({
          required: true,
          sources: [{ thread: "peer:source", cutoff: "2099-01-01T00:00:00.000Z" }],
        }),
      });
      await resumeInputCheckpoint(test.broker, target);
      await test.broker.contextCli(target, "task:one", undefined);
      expect((await test.local.staleReads("app", target.id)).fresh).toBe(true);
      expect(target.inputLineage).toHaveLength(1);
      test.authority("https://hub-b.test");
      expect(await resumeInputCheckpoint(test.broker, target)).toContain("unavailable");
      expect((await test.local.staleReads("app", target.id)).recovery).toBe("unavailable");
    } finally {
      await test.dispose();
    }
  });

  it("carries known inputs from an incomplete source and requires explicit reconstruction", async () => {
    const test = await fixture();
    try {
      const source = await test.meet("source");
      await test.local.contextRead("app", "task:one", source.id, 1, "source");
      await test.local.recoverInputs(
        "app",
        source.id,
        "Part of the historical input evidence was lost",
        [{ scope: "task:one", version: 1 }],
        "unavailable",
      );
      await saveInputCheckpoint(test.broker, source);
      const child = await test.meet("child");
      expect(await resumeInputCheckpoint(test.broker, child)).toContain(
        "Imported 1 input references",
      );
      expect(await test.local.staleReads("app", child.id)).toMatchObject({
        recovery: "unavailable",
        fresh: false,
        reads: [{ scope: "task:one", version: 1 }],
      });
      await test.broker.contextCli(child, "task:one", undefined);
      expect((await test.local.staleReads("app", child.id)).recovery).toBe("unavailable");
      await inputCommand(
        test.broker,
        child,
        commandArguments(["recover", "Rebuilt the task's inputs and checked the known source"]),
      );
      expect((await test.local.staleReads("app", child.id)).recovery).toBe("complete");
    } finally {
      await test.dispose();
    }
  });

  it("preserves source references even if their historical revision disappeared before import", async () => {
    const test = await fixture();
    try {
      const source = await test.meet("source");
      await test.local.contextRead("app", "task:one", source.id, 1, "source");
      await saveInputCheckpoint(test.broker, source);
      const stored = JSON.parse(
        JSON.stringify(await readLocalStoredState(NodePath.join(test.root, "authority.json"))),
      );
      delete stored.contexts[JSON.stringify(["app", "task:one"])];
      delete stored.versions[JSON.stringify(["app", "task:one"])];
      await NodeFSP.writeFile(NodePath.join(test.root, "authority.json"), JSON.stringify(stored));
      await test.seedSources([]);
      await test.register("child");
      const child = test.broker.sessions.get("claude:child")!;
      child.thread = source.thread;
      await test.broker.syncNow();
      expect(await resumeInputCheckpoint(test.broker, child)).toContain(
        "Imported 1 input references",
      );
      expect(await test.local.staleReads("app", child.id)).toMatchObject({
        recovery: "unavailable",
        fresh: false,
        reads: [{ scope: "task:one", version: 1 }],
      });
    } finally {
      await test.dispose();
    }
  });

  it("restores the full checkpoint after total authority loss and never silently drops known inputs", async () => {
    const test = await fixture();
    let resumed: CoordinationBroker | undefined;
    try {
      let session = await test.meet("source");
      const scopes = Array.from({ length: 13 }, (_, index) => `task:${index}`);
      for (const scope of scopes) await test.local.contextRead("app", scope, session.id, 1, scope);
      test.broker.markRead(
        session,
        "task:0",
        1,
        "Only one receipt is in the local notification cache",
      );
      await saveInputCheckpoint(test.broker, session);
      await test.broker.saveMemories();
      const thread = session.thread;
      const file = NodePath.join(test.root, "authority.json");
      await NodeFSP.rm(file);
      await NodeFSP.rm(`${file}.store`, { recursive: true, force: true });
      await test.reloadAuthority();
      resumed = new CoordinationBroker(test.broker.host);
      await resumed.sessionFor("claude", { session_id: "source", cwd: test.root }, undefined);
      session = resumed.sessions.get("claude:source")!;
      session.thread = thread;
      await resumed.syncNow();
      expect(session.read.size).toBe(1);

      expect(await test.local.staleReads("app", session.id)).toMatchObject({
        fresh: true,
        recovery: "complete",
        reads: [],
      });
      // Before a new startup hook, cached evidence already prevents a false empty-manifest handoff.
      expect((await resumed.handoffRefusal(session))?.reason).toContain("unavailable");
      expect(await resumeInputCheckpoint(resumed, session)).toContain("lost receipts");
      expect(await test.local.staleReads("app", session.id)).toMatchObject({
        fresh: false,
        recovery: "unavailable",
      });
      expect((await test.local.staleReads("app", session.id)).reads).toHaveLength(13);
      expect(session.read.size).toBe(13);
      await expect(
        inputCommand(
          resumed,
          session,
          commandArguments(["recover", "Checked the task but sources are still missing"]),
        ),
      ).rejects.toThrow();
      // Reconstructed canonical sources are read again before accepting an explicit new baseline.
      await test.seedSources(scopes);
      for (const scope of scopes) await resumed.contextCli(session, scope, undefined);
      expect((await test.local.staleReads("app", session.id)).recovery).toBe("unavailable");
      await inputCommand(
        resumed,
        session,
        commandArguments([
          "recover",
          "Restored all thirteen sources and checked their current content",
        ]),
      );
      expect(await resumed.handoffRefusal(session, "review")).toBeNull();
    } finally {
      await resumed?.stop();
      await test.dispose();
    }
  });

  it("treats an older authority backup as missing newer checkpoint evidence", async () => {
    const test = await fixture();
    try {
      const session = await test.meet("source");
      const kept = await test.local.keepContext("app", "task:one", session.id, false);
      if ("refused" in kept) throw new Error("keeper refused");
      await test.local.writeContext("app", "task:one", session.id, 1, "Version two", kept.epoch);
      await test.local.contextRead("app", "task:one", session.id, 2, "read-two");
      const file = NodePath.join(test.root, "authority.json");
      const backup = await readLocalStoredState(file);
      await test.local.writeContext("app", "task:one", session.id, 2, "Version three", kept.epoch);
      await test.local.contextRead("app", "task:one", session.id, 3, "read-three");
      test.broker.markRead(session, "task:one", 3, "Version three");
      await saveInputCheckpoint(test.broker, session);
      await NodeFSP.writeFile(file, JSON.stringify(backup));
      await test.reloadAuthority();
      expect(await test.local.staleReads("app", session.id)).toMatchObject({
        fresh: true,
        reads: [{ version: 2 }],
      });
      expect((await test.broker.handoffRefusal(session))?.reason).toContain("unavailable");
      expect(await resumeInputCheckpoint(test.broker, session)).toContain("lost receipts");
      expect(session.read.get("task:one")?.version).toBe(3);
      await expect(
        inputCommand(
          test.broker,
          session,
          commandArguments(["recover", "Restored an older backup"]),
        ),
      ).rejects.toThrow();
      await test.broker.contextCli(session, "task:one", undefined);
      await inputCommand(
        test.broker,
        session,
        commandArguments([
          "recover",
          "Checked the rollback and revalidated the current version two",
        ]),
      );
      expect(await test.broker.handoffRefusal(session, "review")).toBeNull();
    } finally {
      await test.dispose();
    }
  });

  it("runs automatic resume in the real startup path", async () => {
    const test = await fixture();
    try {
      const source = await test.meet("source");
      await test.seedSources(["task:input"]);
      await test.local.contextRead("app", "task:input", source.id, 1, "read");
      await saveInputCheckpoint(test.broker, source);
      const target = await test.meet("target");
      const start = await test.broker.startedContext(target, "resume", NO_PLUGINS);
      expect(start).toContain("Imported 1 input references");
      expect((await test.local.staleReads("app", target.id)).recovery).toBe(
        "revalidation-required",
      );
    } finally {
      await test.dispose();
    }
  });
});
