// @effect-diagnostics nodeBuiltinImport:off - isolated local coordination state and real temporary Git repositories.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { PEER_LOCAL_WORKSPACE } from "@t3tools/contracts";
import { LocalAuthority } from "./LocalAuthority.ts";
import { readLocalStoredState } from "./localStore.ts";
import { localPlace } from "./localPlace.ts";
import { withLocalCoordination } from "./localHost.ts";
import { brokerFixture } from "../broker/testkit.ts";
import { run } from "../local.ts";
import type { ReportedSession } from "../hub/coordApi.ts";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => NodeFSP.rm(dir, { recursive: true, force: true })));
});
async function fixture() {
  const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "peer-local-"));
  dirs.push(dir);
  const file = NodePath.join(dir, "state.json");
  return { dir, file, local: new LocalAuthority(file, "here") };
}
const session = (id: string, claims: string[] = []): ReportedSession => ({
  id,
  runtimeGeneration: "one",
  project: "app",
  label: id,
  status: "working",
  files: [],
  claims,
});
const intent = (session: string, path = "src/session.ts") => ({
  environment: "here",
  session,
  paths: [path],
  policy: "coordinate" as const,
});

describe("Peer Local authority", () => {
  it("keeps publication inputs fixed when its author reads a newer source", async () => {
    const { local, file } = await fixture();
    await local.report([session("source"), session("author")]);
    const sourceKeeper = await local.keepContext("app", "task:source", "source", false);
    const authorKeeper = await local.keepContext("app", "project", "author", false);
    if ("refused" in sourceKeeper || "refused" in authorKeeper) throw new Error("keeper refused");
    await local.writeContext("app", "task:source", "source", 0, "Source one", sourceKeeper.epoch);
    await local.contextRead("app", "task:source", "author", 1, "source-one");
    await local.writeContext("app", "project", "author", 0, "Result", authorKeeper.epoch);
    expect((await local.publishedInputs("app", "project", 1)).fresh).toBe(true);
    await local.writeContext("app", "task:source", "source", 1, "Source two", sourceKeeper.epoch);
    await local.contextRead("app", "task:source", "author", 2, "source-two");
    const published = await local.publishedInputs("app", "project", 1);
    expect(published.fresh).toBe(false);
    expect(published.reads?.[0]?.version).toBe(1);
    expect(published.stale[0]?.currentVersion).toBe(2);
    expect((await local.staleReads("app", "author")).fresh).toBe(true);
    const restarted = new LocalAuthority(file, "here");
    expect(await restarted.publishedInputs("app", "project", 1)).toEqual(published);
  });
  it("serializes concurrent intents, records an actual overlap, and clears it when the other agent stops", async () => {
    const { local } = await fixture();
    await local.report([session("a"), session("b")]);
    const answers = await Promise.all([
      local.intent("app", intent("a")),
      local.intent("app", intent("b")),
    ]);
    expect(answers.map((a) => a.verdicts[0]?.verdict)).toEqual(["clear", "deny"]);
    const overlap = answers[1]!.overlaps[0]!;
    expect(overlap.files).toEqual(["src/session.ts"]);
    await local.note(
      "app",
      overlap.id,
      "I will handle the parser; you can update validation.",
      "b",
      "note-1",
    );
    await local.note(
      "app",
      overlap.id,
      "I will handle the parser; you can update validation.",
      "b",
      "note-1",
    );
    expect((await local.intent("app", intent("b"))).verdicts[0]?.verdict).toBe("clear");
    expect((await local.view()).overlaps[0]?.notes).toHaveLength(1);
    const view = await local.report([session("a", ["src/session.ts"])]);
    expect(view.overlaps[0]).toMatchObject({
      state: "resolved",
      resolution: "An agent runtime ended.",
    });
  });

  it("holds automatic intents across heartbeats until the runtime ends or changes generation", async () => {
    const { local } = await fixture();
    const reports = [session("a"), session("b")];
    await local.report(reports);
    expect((await local.intent("app", intent("a"))).verdicts[0]?.verdict).toBe("clear");
    await local.report(reports);
    expect((await local.intent("app", intent("b"))).verdicts[0]?.verdict).toBe("deny");
    await local.report([session("b")]);
    expect((await local.intent("app", intent("b"))).verdicts[0]?.verdict).toBe("clear");
    await local.report([session("a"), session("b")]);
    await local.intent("app", intent("a", "src/new.ts"));
    await local.report([{ ...session("a"), runtimeGeneration: "two" }, session("b")]);
    expect((await local.intent("app", intent("b", "src/new.ts"))).verdicts[0]?.verdict).toBe(
      "clear",
    );
  });

  it("releases reported claims without releasing automatic intents", async () => {
    const { local } = await fixture();
    await local.report([session("a", ["src/explicit.ts"]), session("b")]);
    await local.intent("app", intent("a"));
    await local.report([session("a"), session("b")]);
    expect((await local.intent("app", intent("b", "src/explicit.ts"))).verdicts[0]?.verdict).toBe(
      "clear",
    );
    expect((await local.intent("app", intent("b"))).verdicts[0]?.verdict).toBe("deny");
  });

  it("keeps restart history but drops claims, leases and previous-run agreements", async () => {
    const { file, local } = await fixture();
    await local.report([session("a", ["src/session.ts"]), session("b", ["src/session.ts"])]);
    const overlap = (await local.view()).overlaps[0]!;
    await local.resolve("app", overlap.id, "Reviewed together", "a", "resolve-1");
    const kept = await local.keepContext("app", "project", "a", false);
    if ("refused" in kept) throw new Error("keeper was refused");
    await local.writeContext("app", "project", "a", 0, "Decided together", kept.epoch, "write-1");
    const restarted = new LocalAuthority(file, "here");
    expect((await restarted.view()).sessions).toEqual([]);
    expect((await restarted.readContext("app", "project"))?.keeper).toBeUndefined();
    expect(await restarted.contextVersions("app", "project")).toHaveLength(1);
    expect((await restarted.view()).overlaps[0]?.resolution).toBe("Reviewed together");
    await restarted.report([session("a"), session("b")]);
    expect(
      await restarted.writeContext("app", "project", "a", 1, "Late write", kept.epoch),
    ).toMatchObject({ refused: "kept" });
    await restarted.intent("app", intent("a"));
    expect((await restarted.intent("app", intent("b"))).verdicts[0]?.verdict).toBe("deny");
  });

  it("does not show old open overlaps as live after restarting while coordination is paused", async () => {
    const { file, local } = await fixture();
    await local.report([session("a", ["src/session.ts"]), session("b", ["src/session.ts"])]);
    const overlap = (await local.view()).overlaps[0]!;
    await local.note("app", overlap.id, "Keep this review history.", "a", "note");
    const restarted = new LocalAuthority(file, "here");
    const view = await restarted.view();
    expect(view.sessions).toEqual([]);
    expect(view.overlaps[0]).toMatchObject({
      id: overlap.id,
      state: "resolved",
      notes: [{ text: "Keep this review history." }],
    });
  });

  it("fences reused session ids by runtime generation and a compare-and-swap context version", async () => {
    const { local } = await fixture();
    await local.report([session("a"), session("b")]);
    const kept = await local.keepContext("app", "project", "a", false);
    if ("refused" in kept) throw new Error("keeper was refused");
    const answers = await Promise.all([
      local.writeContext("app", "project", "a", 0, "first", kept.epoch, "first"),
      local.writeContext("app", "project", "a", 0, "second", kept.epoch, "second"),
    ]);
    expect(answers[0]).toMatchObject({ version: 1 });
    expect(answers[1]).toMatchObject({ refused: "stale" });
    expect(
      await local.writeContext("app", "project", "a", 0, "first", kept.epoch, "first"),
    ).toMatchObject({ version: 1 });
    await local.contextRead("app", "project", "b", 1, "read-1");
    await local.writeContext("app", "project", "a", 1, "new version", kept.epoch, "next");
    expect(await local.staleReads("app", "b")).toMatchObject({
      fresh: false,
      stale: [{ readVersion: 1, currentVersion: 2 }],
    });
    await local.report([{ ...session("a"), runtimeGeneration: "two" }, session("b")]);
    const acquired = await local.keepContext("app", "project", "a", false);
    if ("refused" in acquired) throw new Error("keeper was refused");
    expect(acquired.epoch).toBeGreaterThan(kept.epoch!);
    expect(
      await local.writeContext("app", "project", "a", 2, "old runtime", kept.epoch),
    ).toMatchObject({ refused: "kept" });
  });

  it("keeps stale declared inputs over restart and runtime retirement without retaining leases", async () => {
    const { file, local } = await fixture();
    await local.report([session("writer"), session("reader")]);
    const kept = await local.keepContext("app", "task:input", "writer", false);
    if ("refused" in kept) throw new Error("keeper was refused");
    await local.writeContext("app", "task:input", "writer", 0, "old", kept.epoch);
    await local.contextRead("app", "task:input", "reader", 1, "read");
    await local.writeContext("app", "task:input", "writer", 1, "new", kept.epoch);
    await local.report([session("writer")]);
    const restarted = new LocalAuthority(file, "here");
    expect(await restarted.staleReads("app", "reader")).toMatchObject({
      fresh: false,
      recovery: "complete",
      reads: [{ version: 1 }],
      stale: [{ readVersion: 1, currentVersion: 2 }],
    });
    expect((await restarted.view()).sessions).toEqual([]);
    expect((await restarted.readContext("app", "task:input"))?.keeper).toBeUndefined();
  });

  it("advances only an existing author's receipt after a successful write and never on restore", async () => {
    const { local } = await fixture();
    await local.report([session("writer"), session("reader")]);
    const kept = await local.keepContext("app", "project", "writer", false);
    if ("refused" in kept) throw new Error("keeper was refused");
    await local.writeContext("app", "project", "writer", 0, "first", kept.epoch);
    expect((await local.staleReads("app", "writer")).reads).toEqual([]);
    await local.contextRead("app", "project", "writer", 1, "own");
    await local.contextRead("app", "project", "reader", 1, "other");
    await local.writeContext("app", "project", "writer", 1, "second", kept.epoch);
    expect(await local.staleReads("app", "writer")).toMatchObject({
      fresh: true,
      reads: [{ version: 2 }],
    });
    expect(await local.staleReads("app", "reader")).toMatchObject({
      fresh: false,
      reads: [{ version: 1 }],
    });
    await local.restoreContext("app", "project", 1);
    expect(await local.staleReads("app", "writer")).toMatchObject({
      fresh: false,
      reads: [{ version: 2 }],
    });
  });

  it("migrates missing legacy evidence as unknown until an explicit, auditable reconstruction", async () => {
    const { file, local } = await fixture();
    await local.report([session("reader")]);
    const kept = await local.keepContext("app", "project", "reader", false);
    if ("refused" in kept) throw new Error("keeper refused");
    await local.writeContext("app", "project", "reader", 0, "Existing input", kept.epoch);
    const old = JSON.parse(JSON.stringify(await readLocalStoredState(file)));
    delete old.reads;
    delete old.manifests;
    delete old.legacyEvidenceLost;
    old.version = 1;
    await NodeFSP.writeFile(file, JSON.stringify(old));
    const restarted = new LocalAuthority(file, "here");
    await restarted.report([session("reader")]);
    await restarted.contextRead("app", "project", "reader", 1, "read");
    expect(await restarted.staleReads("app", "reader")).toMatchObject({
      fresh: false,
      recovery: "revalidation-required",
    });
    await expect(
      restarted.recoverInputs("app", "reader", "", [], "reconstructed"),
    ).rejects.toThrow();
    expect(
      await restarted.recoverInputs(
        "app",
        "reader",
        "Reconstructed from the task handoff; no other inputs remain.",
        [{ scope: "project", version: 1 }],
        "reconstructed",
      ),
    ).toMatchObject({ fresh: true, recovery: "complete" });
    const stored = JSON.parse(JSON.stringify(await readLocalStoredState(file)));
    expect(stored.manifests[JSON.stringify(["app", "reader"])].reason).toContain(
      "Reconstructed from",
    );
  });

  it("retains open-work history beyond fifty versions and refuses noncurrent reads", async () => {
    const { file, local } = await fixture();
    await local.report([session("writer"), session("reader")]);
    const kept = await local.keepContext("app", "project", "writer", false);
    if ("refused" in kept) throw new Error("keeper was refused");
    await local.writeContext("app", "project", "writer", 0, "v1", kept.epoch);
    await local.contextRead("app", "project", "reader", 1, "pin");
    for (let version = 1; version < 55; version++)
      await local.writeContext("app", "project", "writer", version, `v${version + 1}`, kept.epoch);
    expect(await local.readContextVersion("app", "project", 1)).toMatchObject({ text: "v1" });
    expect(await local.readContextVersion("app", "project", 2)).toMatchObject({ text: "v2" });
    expect(await local.contextVersions("app", "project")).toHaveLength(55);
    await expect(local.contextRead("app", "project", "reader", 2, "missing")).rejects.toThrow(
      "no longer current",
    );
    const state = JSON.parse(JSON.stringify(await readLocalStoredState(file)));
    state.versions[JSON.stringify(["app", "project"])] = [];
    await NodeFSP.writeFile(file, JSON.stringify(state));
    expect(await new LocalAuthority(file, "here").staleReads("app", "reader")).toMatchObject({
      fresh: false,
      recovery: "unavailable",
    });
  });

  it("requires every transferred input to be explicitly reread", async () => {
    const { local } = await fixture();
    await local.report([session("reader")]);
    for (const scope of ["project", "task:other"]) {
      const kept = await local.keepContext("app", scope, "reader", false);
      if ("refused" in kept) throw new Error("keeper refused");
      await local.writeContext("app", scope, "reader", 0, "Canonical input", kept.epoch);
    }
    expect(
      await local.recoverInputs(
        "app",
        "reader",
        "Provider handoff",
        [
          { scope: "project", version: 1 },
          { scope: "task:other", version: 1 },
        ],
        "transferred",
      ),
    ).toMatchObject({ fresh: false, recovery: "revalidation-required" });
    await local.contextRead("app", "project", "reader", 1, "first");
    expect((await local.staleReads("app", "reader")).fresh).toBe(false);
    await local.contextRead("app", "task:other", "reader", 1, "second");
    expect(await local.staleReads("app", "reader")).toMatchObject({
      fresh: true,
      recovery: "complete",
    });
  });

  it("decides only explicit finding IDs atomically with the keeper's versioned context write", async () => {
    const { file, local } = await fixture();
    const author = { ...session("author"), findings: ["Verify the migration"] };
    await local.report([session("keeper"), author]);
    const finding = (await local.view()).findings![0]!;
    const kept = await local.keepContext("app", "project", "keeper", false);
    if ("refused" in kept) throw new Error("keeper was refused");
    await local.writeContext("app", "project", "keeper", 0, "Unrelated edit", kept.epoch);
    expect((await local.view()).findings![0]?.decision).toBeUndefined();
    await expect(
      local.writeContext("app", "project", "keeper", 1, "Bad decision", kept.epoch, "bad", [
        { id: finding.id, status: "incorporated", reason: "Checked migration" },
        { id: "missing", status: "dismissed", reason: "Unavailable" },
      ]),
    ).rejects.toThrow("unavailable");
    expect((await local.readContext("app", "project"))?.version).toBe(1);
    expect((await local.view()).findings![0]?.decision).toBeUndefined();
    await local.report([
      session("keeper"),
      { ...author, findings: [...author.findings, "A concurrently delivered report"] },
    ]);
    const decisions = [
      {
        id: finding.id,
        status: "incorporated" as const,
        reason: "Verified using the migration test",
      },
    ];
    await local.writeContext(
      "app",
      "project",
      "keeper",
      1,
      "Migration verified",
      kept.epoch,
      "decide",
      decisions,
    );
    await local.writeContext(
      "app",
      "project",
      "keeper",
      1,
      "Migration verified",
      kept.epoch,
      "decide",
      decisions,
    );
    const restarted = new LocalAuthority(file, "here");
    const findings = (await restarted.view()).findings!;
    expect(findings.find((entry) => entry.id === finding.id)?.decision).toMatchObject({
      status: "incorporated",
      actor: "local",
      session: "keeper",
      contextVersion: 2,
    });
    expect(findings.find((entry) => entry.id !== finding.id)?.decision).toBeUndefined();
    expect((await restarted.readContext("app", "project"))?.version).toBe(2);
  });

  it("never accepts version zero as a real input and detects missing declared receipt rows", async () => {
    const { file, local } = await fixture();
    await local.report([session("reader")]);
    await expect(local.contextRead("app", "task:missing", "reader", 0, "empty")).rejects.toThrow(
      "no longer current",
    );
    await expect(
      local.recoverInputs(
        "app",
        "reader",
        "No source exists",
        [{ scope: "task:missing", version: 0 }],
        "reconstructed",
      ),
    ).rejects.toThrow("unavailable");
    const kept = await local.keepContext("app", "project", "reader", false);
    if ("refused" in kept) throw new Error("keeper refused");
    await local.writeContext("app", "project", "reader", 0, "Known source", kept.epoch);
    await local.contextRead("app", "project", "reader", 1, "read");
    const stored = JSON.parse(JSON.stringify(await readLocalStoredState(file)));
    stored.reads = [];
    await NodeFSP.writeFile(file, JSON.stringify(stored));
    expect(await new LocalAuthority(file, "here").staleReads("app", "reader")).toMatchObject({
      fresh: false,
      recovery: "unavailable",
    });
  });

  it("does not let a retried old read operation revalidate a transferred input", async () => {
    const { local, file } = await fixture();
    await local.report([session("reader")]);
    const kept = await local.keepContext("app", "project", "reader", false);
    if ("refused" in kept) throw new Error("keeper refused");
    await local.writeContext("app", "project", "reader", 0, "Known input", kept.epoch);
    const original = await local.contextRead("app", "project", "reader", 1, "r1");
    await local.recoverInputs(
      "app",
      "reader",
      "Provider transfer",
      [{ scope: "project", version: 1 }],
      "transferred",
    );
    const restarted = new LocalAuthority(file, "here");
    await restarted.report([session("reader")]);
    expect(await restarted.contextRead("app", "project", "reader", 1, "r1")).toEqual(original);
    expect((await restarted.staleReads("app", "reader")).recovery).toBe("revalidation-required");
    await expect(restarted.contextRead("app", "project", "reader", 2, "r1")).rejects.toThrow(
      "different input",
    );
    await restarted.contextRead("app", "project", "reader", 1, "r2");
    expect((await restarted.staleReads("app", "reader")).recovery).toBe("complete");
  });

  it("unions automatic transfers with inputs read concurrently and preserves the target revision", async () => {
    const { file } = await fixture();
    let at = "2026-01-01T00:00:00.000Z";
    const local = new LocalAuthority(file, "here", () => at);
    await local.report([session("reader")]);
    for (const scope of ["project", "task:new"]) {
      const kept = await local.keepContext("app", scope, "reader", false);
      if ("refused" in kept) throw new Error("keeper refused");
      await local.writeContext("app", scope, "reader", 0, "Canonical source", kept.epoch);
      if (scope === "project")
        await local.writeContext("app", scope, "reader", 1, "Updated source", kept.epoch);
    }
    await local.contextRead("app", "project", "reader", 2, "newer");
    // The broker took its transfer snapshot before this input was declared.
    await local.contextRead("app", "task:new", "reader", 1, "concurrent");
    at = "2026-02-01T00:00:00.000Z";
    const transferred = await local.recoverInputs(
      "app",
      "reader",
      "Earlier broker snapshot",
      [{ scope: "project", version: 1 }],
      "transferred",
    );
    expect(transferred.reads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ scope: "project", version: 2 }),
        expect.objectContaining({ scope: "task:new", version: 1 }),
      ]),
    );
    expect(transferred.reads?.find((read) => read.scope === "project")?.at).toBe(
      "2026-01-01T00:00:00.000Z",
    );
    const missing = await local.recoverInputs(
      "app",
      "reader",
      "Source unavailable",
      [],
      "unavailable",
    );
    expect(missing.reads).toHaveLength(2);
    expect(missing.recovery).toBe("unavailable");
    const rebuilt = await local.recoverInputs(
      "app",
      "reader",
      "This work now uses only the project source",
      [{ scope: "project", version: 2 }],
      "reconstructed",
    );
    expect(rebuilt.reads).toHaveLength(1);
  });

  it("never replaces a corrupt state file with an empty history after a failed read", async () => {
    const { file } = await fixture();
    await NodeFSP.writeFile(file, "broken");
    const local = new LocalAuthority(file, "here");
    await expect(local.view()).rejects.toThrow();
    await expect(local.report([])).rejects.toThrow();
    expect(await NodeFSP.readFile(file, "utf8")).toBe("broken");
  });

  it("enrolls only opened repositories and gives linked worktrees the same project", async () => {
    const { dir } = await fixture();
    const repo = NodePath.join(dir, "repo");
    const linked = NodePath.join(dir, "linked");
    await NodeFSP.mkdir(repo);
    await run("git", ["init", repo]);
    await run("git", [
      "-C",
      repo,
      "-c",
      "user.name=Local test",
      "-c",
      "user.email=test@example.test",
      "commit",
      "--allow-empty",
      "-m",
      "Initial",
    ]);
    await run("git", ["-C", repo, "worktree", "add", "-b", "linked", linked]);
    expect(await localPlace(repo, [])).toBeNull();
    const main = await localPlace(repo, [repo]);
    const worktree = await localPlace(linked, [repo]);
    expect(main?.workspace).toBe(PEER_LOCAL_WORKSPACE);
    expect(worktree?.project).toBe(main?.project);
    expect(worktree?.root).toBe(await NodeFSP.realpath(linked));
  });

  it("gives Jujutsu workspaces the same local identity", async () => {
    const { dir } = await fixture();
    const repo = NodePath.join(dir, "jj-repo");
    const linked = NodePath.join(dir, "jj-linked");
    await run("jj", ["git", "init", "--colocate", repo]);
    await run("jj", [
      "--config",
      "user.name=Local test",
      "--config",
      "user.email=test@example.test",
      "-R",
      repo,
      "workspace",
      "add",
      linked,
    ]);
    const main = await localPlace(repo, [repo]);
    const other = await localPlace(linked, [repo]);
    expect(main?.workspace).toBe(PEER_LOCAL_WORKSPACE);
    expect(other?.project).toBe(main?.project);
    expect(other?.root).toBe(await NodeFSP.realpath(linked));
  });

  it("keeps a Hub checkout on Hub authority during an outage", async () => {
    const { local } = await fixture();
    const fixtureBroker = await brokerFixture((host) =>
      withLocalCoordination(
        {
          ...host,
          report: async () => {
            throw new Error("Hub unavailable");
          },
        },
        local,
        async () => ({ workspace: PEER_LOCAL_WORKSPACE, project: "local", root: "/local" }),
      ),
    );
    try {
      expect((await fixtureBroker.broker.host.placeOf(fixtureBroker.root))?.workspace).toBe("acme");
      await expect(fixtureBroker.broker.host.report("acme", [])).rejects.toThrow("Hub unavailable");
      expect((await local.view()).sessions).toEqual([]);
    } finally {
      await fixtureBroker.dispose();
    }
  });

  it("runs real broker CLI claims and status while signed out, without invoking Hub transport", async () => {
    const { local } = await fixture();
    const broker = await brokerFixture((host) =>
      withLocalCoordination(
        {
          ...host,
          environment: "here",
          email: () => null,
          policy: () => "coordinate",
          workspaces: () => [],
          placeOf: async () => null,
          report: async () => {
            throw new Error("Hub must not be used");
          },
        },
        local,
        async () => ({
          workspace: PEER_LOCAL_WORKSPACE,
          project: "app",
          root: NodePath.dirname(host.socketPath),
        }),
      ),
    );
    try {
      await broker.register("one");
      await broker.register("two");
      await broker.broker.syncNow();
      expect(
        await broker.broker.runCli("claim", ["src/session.ts"], { "x-peer-session": "claude:one" }),
      ).toContain("clear");
      expect(
        await broker.broker.runCli("claim", ["src/session.ts"], { "x-peer-session": "claude:two" }),
      ).toContain("wait");
      expect(
        await broker.broker.runCli("status", [], { "x-peer-session": "claude:two" }),
      ).toContain("src/session.ts");
      expect((await local.view()).overlaps.filter((o) => o.state === "open")).toHaveLength(1);
    } finally {
      await broker.dispose();
    }
  });
});
