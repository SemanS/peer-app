import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { PeerRecipesError, type PeerHubStatus, type ThreadId } from "@t3tools/contracts";
import {
  askableAgents,
  recipeLabel,
  recipesOrUnavailable,
  recipeOperation,
  recipeDeliveryText,
} from "./recipes.ts";
const own = {
  id: "peer:own",
  email: "ana",
  environment: "laptop",
  source: "peer",
  harness: "codex",
  status: "working",
  title: "Own",
  task: "task",
  runtimePresent: true,
};
const status = {
  email: "ana",
  environmentId: "laptop",
  agents: {
    list: [
      {
        id: "herdr:a",
        paneId: "p",
        title: "Agent",
        status: "idle",
        workspace: "acme",
        projectId: "app",
        coordinationLevel: "A",
      },
      {
        id: "herdr:c",
        paneId: "c",
        title: "Observed",
        status: "working",
        workspace: "acme",
        projectId: "app",
        coordinationLevel: "C",
      },
      {
        id: "herdr:b",
        paneId: "b",
        title: "Waiting",
        status: "blocked",
        workspace: "acme",
        projectId: "app",
        coordinationLevel: "B",
      },
    ],
  },
  workspaces: [
    {
      slug: "acme",
      projects: [
        {
          project: { id: "app" },
          repositories: [],
          work: {
            runs: [
              {
                id: "run_a",
                task: "task",
                agent: "claude",
                runtime: "herdr",
                state: "running",
                keys: ["herdr:a"],
              },
              {
                id: "run_c",
                task: "task",
                agent: "claude",
                runtime: "herdr",
                state: "running",
                keys: ["herdr:c"],
              },
              {
                id: "run_b",
                task: "task",
                agent: "claude",
                runtime: "herdr",
                state: "running",
                keys: ["herdr:b"],
              },
            ],
            threads: [
              own,
              { ...own, id: "peer:colleague", email: "other" },
              { ...own, id: "peer:remote", environment: "remote" },
              { ...own, id: "peer:stale", runtimePresent: false },
              { ...own, id: "peer:other-task", task: "other" },
              { ...own, id: "peer:unsupported", harness: "grok" },
            ],
          },
        },
      ],
    },
  ],
} as unknown as PeerHubStatus;
it("offers only own coordinated agents on this task, and explains blocked agents", () => {
  const agents = askableAgents(status, { workspace: "acme", project: "app", task: "task" });
  expect(agents.map((a) => a.title)).toEqual(["Agent", "Own", "Waiting"]);
  expect(agents.find((a) => a.title === "Waiting")?.reason).toMatch(/answer/);
  expect(agents.find((a) => a.title === "Own")?.target).toEqual({
    kind: "thread",
    threadId: "own" as ThreadId,
  });
  expect(askableAgents(status, { workspace: "other", project: "app", task: "task" })).toEqual([]);
});
it("offers an agent whose task the Hub inferred from its branch, but only the person's own record of it", () => {
  const project = status.workspaces[0]!.projects[0]!;
  const agent = (id: string) => ({
    id,
    paneId: id,
    title: id,
    status: "idle",
    workspace: "acme",
    projectId: "app",
    coordinationLevel: "B",
  });
  const herdr = { ...own, source: "herdr", harness: "claude" };
  const withThreads = (threads: ReadonlyArray<Record<string, unknown>>) =>
    ({
      ...status,
      agents: { list: [agent("herdr:own"), agent("herdr:colleague"), agent("herdr:remote")] },
      workspaces: [
        {
          ...status.workspaces[0]!,
          projects: [{ ...project, work: { ...project.work, runs: [], threads } }],
        },
      ],
    }) as unknown as PeerHubStatus;
  const rows = askableAgents(
    withThreads([
      { ...herdr, id: "herdr:own" },
      { ...herdr, id: "herdr:colleague", email: "other" },
      { ...herdr, id: "herdr:remote", environment: "remote" },
    ]),
    { workspace: "acme", project: "app", task: "task" },
  );
  expect(rows.map((row) => row.title)).toEqual(["herdr:own"]);
  expect(
    askableAgents(withThreads([{ ...herdr, id: "herdr:own", task: "other" }]), {
      workspace: "acme",
      project: "app",
      task: "task",
    }),
  ).toEqual([]);
});
it.effect(
  "treats an old environment's unknown method as an empty catalog, retaining other failures",
  () =>
    Effect.gen(function* () {
      expect(
        yield* recipesOrUnavailable(
          Effect.fail(new PeerRecipesError({ message: "Unknown method peer.recipes.list" })),
        ),
      ).toEqual({ enabled: false, recipes: [] });
      expect(
        yield* recipesOrUnavailable(Effect.die("Unknown request tag: peer.recipes.list")),
      ).toEqual({ enabled: false, recipes: [] });
      expect(
        yield* recipesOrUnavailable(
          Effect.fail(new PeerRecipesError({ message: "Connection lost" })),
        ).pipe(Effect.flip),
      ).toMatchObject({ message: "Connection lost" });
    }),
);
it("labels a recipe by its title, and says so when it only reads", () => {
  expect(recipeLabel({ title: "Catch me up", access: "read" })).toBe("Catch me up (reads only)");
  expect(recipeLabel({ title: "Hand a task to a teammate", access: "write" })).toBe(
    "Hand a task to a teammate",
  );
});
it("keeps the same operation after a refusal and replaces it after a changed draft or success", () => {
  const target = { kind: "herdr", agentId: "a" } as const;
  const first = recipeOperation(null, target, "catch-up", "x", () => "first");
  expect(recipeOperation(first, target, "catch-up", "x", () => "second")).toBe(first);
  expect(recipeOperation(first, target, "catch-up", "y", () => "second").id).toBe("second");
  expect(recipeOperation(null, target, "catch-up", "x", () => "third").id).toBe("third");
  expect(recipeDeliveryText("Own", { delivery: "queued" })).toBe("Queued for Own");
});

it("merges this environment's live owned shells before Hub reporting, without reviving stale records", () => {
  const project = status.workspaces[0]!.projects[0]!;
  const localStatus = {
    ...status,
    workspaces: [
      {
        ...status.workspaces[0]!,
        projects: [
          {
            ...project,
            repositories: [{ projectId: "project" }],
            work: {
              ...project.work,
              runs: [
                ...(project.work.runs ?? []),
                {
                  id: "run_local",
                  task: "task",
                  agent: "claude",
                  runtime: "peer",
                  state: "running",
                  keys: ["peer:local"],
                },
                {
                  id: "run_stale",
                  task: "task",
                  agent: "claude",
                  runtime: "peer",
                  state: "running",
                  keys: ["peer:stale"],
                },
              ],
            },
          },
        ],
      },
    ],
  } as unknown as PeerHubStatus;
  const shell = {
    id: "local",
    environmentId: "laptop",
    projectId: "project",
    title: "Local",
    archivedAt: null,
    deletedAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    runtime: { status: "running", providerName: "Codex" },
  } as unknown as import("../state/models.ts").EnvironmentThreadShell;
  const rows = askableAgents(localStatus, { workspace: "acme", project: "app", task: "task" }, [
    shell,
    { ...shell, id: "stale" as ThreadId },
    {
      ...shell,
      id: "remote" as ThreadId,
      environmentId: "remote" as import("@t3tools/contracts").EnvironmentId,
    },
    {
      ...shell,
      id: "unsupported" as ThreadId,
      runtime: { ...shell.runtime!, providerName: "Grok" },
    },
  ]);
  expect(rows.map((r) => r.title)).toEqual(["Agent", "Local", "Own", "Waiting"]);
  const blocked = askableAgents(localStatus, { workspace: "acme", project: "app", task: "task" }, [
    { ...shell, hasPendingApprovals: true },
  ]);
  expect(blocked.find((r) => r.title === "Local")?.reason).toMatch(/answer/);
});
