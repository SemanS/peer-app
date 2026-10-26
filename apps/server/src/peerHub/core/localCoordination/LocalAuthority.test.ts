// @effect-diagnostics nodeBuiltinImport:off - isolated local coordination state and real temporary Git repositories.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { PEER_LOCAL_WORKSPACE } from "@t3tools/contracts";
import { LocalAuthority } from "./LocalAuthority.ts";
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
