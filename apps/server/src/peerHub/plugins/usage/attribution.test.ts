import { describe, expect, it } from "@effect/vitest";

import type { PersistedRun, RepositoryManifest } from "../../core/state/PeerState.ts";
import { attribute, needsRemote, runPlaces, sharedPlace } from "./attribution.ts";

const manifest = (
  slug: string,
  projects: Readonly<Record<string, string>>,
): RepositoryManifest => ({
  workspace: { slug },
  projects: Object.entries(projects).map(([id, url]) => ({
    id,
    repositories: [{ id: "repo", url }],
  })),
});

const run = (over: Partial<PersistedRun>): PersistedRun =>
  ({
    id: "run_1",
    workspace: "acme",
    project: "pay",
    email: "ana@acme.test",
    startedAt: "2026-10-01T09:00:00.000Z",
    sessions: [{ id: "claude:one", from: "2026-10-01T09:00:00.000Z" }],
    ...over,
  }) as PersistedRun;

const acme = manifest("acme", {
  pay: "https://github.com/acme/api.git",
  web: "git@github.com:acme/web.git",
});
const beta = manifest("beta", {
  tools: "https://github.com/beta/tools.git",
  shared: "https://github.com/acme/web",
});

const context = {
  runs: new Map(),
  hubHomes: ["/home/ana/.t3/hub"],
  manifests: [acme, beta],
  remoteOf: (cwd: string) =>
    ({
      "/work/api": "git@github.com:acme/api.git",
      "/work/tools": "https://github.com/beta/tools",
      "/work/web": "https://github.com/acme/web.git",
      "/work/personal": "https://github.com/ana/notes.git",
    })[cwd] ?? null,
};

const session = (over: { sessionId?: string; cwd?: string; dir?: string; provider?: string }) => ({
  provider: "claude",
  sessionId: "one",
  dir: "/home/ana/.claude/projects",
  ...over,
});

describe("a session's place", () => {
  it("is the run's that names it, whatever its directory says", () => {
    const place = attribute(session({ cwd: "/work/tools" }), {
      ...context,
      runs: runPlaces([run({})], "ana@acme.test"),
    });
    expect(place).toEqual({ workspace: "acme", project: "pay", capacity: "personal" });
  });

  it("goes by the agent as well as the id: a run's sessions are `<agent>:<native id>`", () => {
    const runs = runPlaces([run({})], "ana@acme.test");
    expect(attribute(session({ provider: "codex" }), { ...context, runs })).toBeNull();
  });

  it("takes the newest run, and only this person's", () => {
    const runs = runPlaces(
      [
        run({ project: "web", startedAt: "2026-10-02T09:00:00.000Z" }),
        run({ project: "pay" }),
        run({
          workspace: "beta",
          project: "tools",
          email: "bob@acme.test",
          startedAt: "2026-10-09",
        }),
      ],
      "ana@acme.test",
    );
    expect(runs.get("claude:one")).toEqual({ workspace: "acme", project: "web" });
  });

  it("is the project of its directory's repository", () => {
    expect(attribute(session({ cwd: "/work/api" }), context)).toEqual({
      workspace: "acme",
      project: "pay",
      capacity: "personal",
    });
  });

  it("is the lowest project id when several of one workspace hold the repository", () => {
    const one = manifest("acme", {
      zeta: "https://github.com/acme/api.git",
      alpha: "https://github.com/acme/api.git",
    });
    expect(
      attribute(session({ cwd: "/work/api" }), { ...context, manifests: [one] })?.project,
    ).toBe("alpha");
  });

  it("is nothing for a repository of two workspaces", () => {
    expect(attribute(session({ cwd: "/work/web" }), context)).toBeNull();
  });

  it("is nothing for a repository of no workspace, a gone directory or none at all", () => {
    expect(attribute(session({ cwd: "/work/personal" }), context)).toBeNull();
    expect(attribute(session({ cwd: "/work/deleted" }), context)).toBeNull();
    expect(attribute(session({}), context)).toBeNull();
  });

  it("is nothing while a workspace is unread, since it may hold the repository too", () => {
    expect(
      attribute(session({ cwd: "/work/api" }), { ...context, manifests: [acme, null] }),
    ).toBeNull();
  });

  it("is shared capacity's by its directory alone, with no repository to match", () => {
    const dir = "/home/ana/.t3/hub/acme/claude/pay/projects";
    expect(attribute(session({ dir, cwd: "/work/personal" }), context)).toEqual({
      workspace: "acme",
      project: "pay",
      capacity: "shared",
    });
    expect(needsRemote(session({ dir }), context)).toBe(false);
  });

  it("is nothing for a project the workspace no longer has", () => {
    const gone = "/home/ana/.t3/hub/acme/claude/old/projects";
    expect(attribute(session({ dir: gone }), context)).toBeNull();
    const runs = runPlaces([run({ project: "old" })], "ana@acme.test");
    expect(attribute(session({}), { ...context, runs })).toBeNull();
  });
});

describe("a shared directory", () => {
  it("is only one below the Hub's home and of the harness that keeps its work there", () => {
    const homes = ["/h"];
    expect(sharedPlace("/h/acme/claude/pay", homes)).toEqual({ workspace: "acme", project: "pay" });
    expect(sharedPlace("/h/acme/knowledge/pay", homes)).toBeNull();
    expect(sharedPlace("/h/acme/claude", homes)).toBeNull();
    expect(sharedPlace("/other/acme/claude/pay", homes)).toBeNull();
    expect(sharedPlace("/h", homes)).toBeNull();
  });
});
