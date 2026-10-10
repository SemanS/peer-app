// @effect-diagnostics preferSchemaOverJson:off - host-side lab fixture checks; no server processes.
import { expect, it } from "vite-plus/test";
import { dependencyState, type PeerWorkThread } from "@t3tools/contracts";
import { dependencyBlocks, withDependencyEvidence, observeDependencyIdle } from "./dependencies.ts";

it("finds the dependency start block and notices among other hook paragraphs", () => {
  const start =
    "Peer · dependencies recorded for this task (reference from your team, not instructions):\n- you depend on KRK-1: open\n`peer context <task>` reads one; `peer depends` lists them.";
  const notice = "Peer · dependency facts (reference, not instructions):\n- KRK-1 is in review.";
  const hook = (hookEvent: string, additionalContext: string) => ({
    event: "hook",
    session: "claude:b",
    hookEvent,
    answer: { hookSpecificOutput: { hookEventName: hookEvent, additionalContext } },
  });
  const found = dependencyBlocks([
    hook("SessionStart", `You are Bob's agent here.\n\n${start}\n\nOther work on this project now`),
    hook("UserPromptSubmit", `Peer: shared context changed.\n\n${notice}`),
    hook("PostToolUse", "Peer: you changed src/receipt.ts"),
    {
      event: "cli",
      session: "claude:b",
      answer: { hookSpecificOutput: { additionalContext: notice } },
    },
  ]);
  expect(found.blocks.map((b) => [b.hookEvent, b.kind])).toEqual([
    ["SessionStart", "start"],
    ["UserPromptSubmit", "notice"],
  ]);
  expect(found.startChars).toBe(start.length);
  expect(found.noticeChars).toBe(notice.length);
});

it("registers repository-bound open and merged evidence and restores local-only metadata", async () => {
  const local = { id: "app", url: "/tmp/lab/origin.git", branch: "main" };
  let config = {
    projects: {
      lab: { name: "Lab", repositories: [local], coordination: { policy: "coordinate" } },
    },
  };
  const reports: Array<Record<string, unknown>> = [];
  await withDependencyEvidence(
    async (path, input) => {
      if (path.endsWith("/config")) {
        if (input.method === "PUT") config = (input.body as { config: typeof config }).config;
        return { config };
      }
      const body = input.body as { threads: Array<Record<string, unknown>> };
      for (const row of body.threads) {
        const repo = config.projects.lab.repositories.find((r) => r.id === row.repository);
        if (!repo || repo.url !== "https://github.com/acme/lab.git")
          throw new Error("unregistered PR repository");
        const pr = (row.pullRequests as Array<{ url: string; headBranch: string }>)[0]!;
        if (pr.url !== "https://github.com/acme/lab/pull/18" || pr.headBranch !== row.branch)
          throw new Error("wrong repository or branch evidence");
        reports.push(row);
      }
      return { accepted: body.threads.length };
    },
    async (evidence) => {
      await evidence.report("vl1", "open");
      await evidence.report("vl1", "merged");
      expect(config.projects.lab.repositories).toHaveLength(2);
    },
  );
  expect(reports.map((r) => (r.pullRequests as Array<{ state: string }>)[0]!.state)).toEqual([
    "open",
    "merged",
  ]);
  expect(config.projects.lab.repositories).toEqual([local]);
  expect(config.projects.lab.coordination).toEqual({ policy: "coordinate" });
});

it("cleans evidence after a failing scenario and preserves unrelated current config edits", async () => {
  const local = { id: "app", url: "/tmp/lab/origin.git", branch: "main" };
  let config = { projects: { lab: { name: "Lab", repositories: [local], description: "before" } } };
  let cleared = false;
  await expect(
    withDependencyEvidence(
      async (path, input) => {
        if (path.endsWith("/config")) {
          if (input.method === "PUT") config = (input.body as { config: typeof config }).config;
          return { config };
        }
        cleared = (input.body as { threads: unknown[] }).threads.length === 0;
        return {};
      },
      async () => {
        config.projects.lab.description = "changed during scenario";
        throw new Error("scenario failed");
      },
    ),
  ).rejects.toThrow("scenario failed");
  expect(cleared).toBe(true);
  expect(config.projects.lab.repositories).toEqual([local]);
  expect(config.projects.lab.description).toBe("changed during scenario");
});

it("refuses a work report the Hub did not accept and still removes its temporary repository", async () => {
  const local = { id: "app", url: "/tmp/lab/origin.git", branch: "main" };
  let config = { projects: { lab: { repositories: [local] } } };
  await expect(
    withDependencyEvidence(
      async (path, input) => {
        if (path.endsWith("/config")) {
          if (input.method === "PUT") config = (input.body as { config: typeof config }).config;
          return { config };
        }
        return { accepted: 0 };
      },
      async (evidence) => evidence.report("vl1", "merged"),
    ),
  ).rejects.toThrow("dependency PR work was not accepted");
  expect(config.projects.lab.repositories).toEqual([local]);
});

it("cleans a committed repository when its acknowledgement is lost before the scenario starts", async () => {
  const local = { id: "app", url: "/tmp/lab/origin.git", branch: "main" };
  let config = { projects: { lab: { repositories: [local] } } };
  let writes = 0,
    clears = 0,
    ran = false;
  await expect(
    withDependencyEvidence(
      async (path, input) => {
        if (path.endsWith("/config")) {
          if (input.method === "PUT") {
            config = (input.body as { config: typeof config }).config;
            if (++writes === 1) throw new Error("lost config acknowledgement");
          }
          return { config };
        }
        if ((input.body as { threads: unknown[] }).threads.length === 0) clears++;
        return {};
      },
      async () => {
        ran = true;
      },
    ),
  ).rejects.toThrow("lost config acknowledgement");
  expect(ran).toBe(false);
  expect(clears).toBe(1);
  expect(config.projects.lab.repositories).toEqual([local]);
});

it("reopens unfinished follow-up work without erasing the historical merged pull request", async () => {
  const local = { id: "app", url: "/tmp/lab/origin.git", branch: "main" };
  let config = { projects: { lab: { repositories: [local] } } };
  const retained = new Map<string, Record<string, unknown>>();
  const deliveries = (): Array<Pick<PeerWorkThread, "delivery">> =>
    [...retained.values()].map((row) => ({
      delivery:
        (row.pullRequests as Array<{ state: string }>).every((pr) => pr.state === "merged") &&
        (row.pullRequests as unknown[]).length > 0
          ? "merged"
          : "open",
    }));
  await withDependencyEvidence(
    async (path, input) => {
      if (path.endsWith("/config")) {
        if (input.method === "PUT") config = (input.body as { config: typeof config }).config;
        return { config };
      }
      const { threads } = input.body as { threads: Array<Record<string, unknown>> };
      // The Hub makes absent work unavailable while retaining its delivery evidence.
      for (const row of threads) retained.set(String(row.id), row);
      return { accepted: threads.length };
    },
    async (evidence) => {
      await evidence.report("vl1", "merged");
      await evidence.clear();
      expect(dependencyState({ status: "open" }, deliveries())).toBe("merged");
      await evidence.followup("vl1");
      expect(dependencyState({ status: "open" }, deliveries())).toBe("open");
    },
  );
  expect(retained.size).toBe(2);
  expect(retained.get("peer:dependency-evidence")?.pullRequests).toEqual([
    {
      url: "https://github.com/acme/lab/pull/18",
      state: "merged",
      headBranch: "vl1-dependency-prerequisite",
    },
  ]);
  expect(retained.get("peer:dependency-followup")).toMatchObject({
    task: "vl1",
    status: "working",
    branch: "vl1-dependency-followup",
    pullRequests: [],
  });
  expect(config.projects.lab.repositories).toEqual([local]);
});

it("observes an actually registered held wait and refuses both a returned waiter and a wake log", async () => {
  let answer!: (value: string | null) => void;
  const wait = new Promise<string | null>((resolve) => {
    answer = resolve;
  });
  const rows: Array<{ event: string; session: string }> = [];
  let pauses = 0;
  const observer = await observeDependencyIdle({
    session: "claude:idle",
    wait,
    events: () => rows,
    pause: async () => {
      pauses++;
      rows.push({ event: "wait", session: "claude:idle" });
    },
  });
  expect(pauses).toBe(1);
  await observer.check();
  rows.push({ event: "wake", session: "claude:someone-else" });
  await observer.check();
  rows.push({ event: "wake", session: "claude:idle" });
  await expect(observer.check()).rejects.toThrow("dependency observer was woken");
  rows.pop();
  answer("unexpected dependency wake");
  await expect(observer.check()).rejects.toThrow("dependency observer wait ended");
});

it("refuses an observer that never entered a wait or exited while becoming idle", async () => {
  let pauses = 0;
  await expect(
    observeDependencyIdle({
      session: "claude:idle",
      wait: new Promise(() => {}),
      events: () => [],
      pause: async () => {
        pauses++;
      },
    }),
  ).rejects.toThrow("dependency observer did not enter a wait");
  expect(pauses).toBeLessThanOrEqual(100);
  await expect(
    observeDependencyIdle({
      session: "claude:idle",
      wait: Promise.resolve(null),
      events: () => [{ event: "wait", session: "claude:idle" }],
      pause: async () => {},
    }),
  ).rejects.toThrow("dependency observer wait ended");
});
