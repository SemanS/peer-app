// @effect-diagnostics preferSchemaOverJson:off - assertions inspect serialized privacy boundaries.
import { expect, it } from "@effect/vitest";
import type {
  OrchestrationV2ProviderTurn,
  OrchestrationV2ThreadShell,
  PeerMetricsTaskRow,
  ThreadPullRequestLink,
} from "@t3tools/contracts";
import { taskRef } from "@t3tools/shared/peerRef";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import type { PeerWorkPass } from "../../core/work/PeerWork.ts";
import { freshPerson } from "./client/localStore.ts";
import { createObservers } from "./observers.ts";
const turn = (
  id: string,
  at: number,
  usage: object | undefined,
  provider = "shared",
): OrchestrationV2ProviderTurn =>
  ({
    id,
    providerThreadId: provider,
    completedAt: DateTime.makeUnsafe(at),
    status: "completed",
    ...(usage ? { turnTokenUsage: usage } : {}),
  }) as never;
const usage = {
  usageScope: "main_agent",
  usageStatus: "complete",
  inputTokens: 100,
  outputTokens: 10,
  cachedInputTokens: 20,
  cacheCreationTokens: 5,
  hasSubagents: false,
};
const fixture = () => {
  let reads = 0,
    threads: OrchestrationV2ThreadShell[] = [],
    turns: OrchestrationV2ProviderTurn[] = [];
  const rows: { reference: string; row: PeerMetricsTaskRow }[] = [],
    prs: { checked: boolean; conflicting: boolean }[] = [];
  const observe = createObservers({
    task: (_w, _p, _at, reference, row) => {
      rows.push({ reference, row });
    },
    pr: (_w, _p, checked, conflicting) => {
      prs.push({ checked, conflicting });
    },
  });
  const pass = (at: number, task: string | null = "SENTINEL-title-1234"): PeerWorkPass => ({
    at,
    threads,
    assignment: () => task ?? undefined,
    projectOf: new Map([
      [
        "t3",
        {
          workspace: { slug: "acme", name: "Acme" },
          project: { id: "pay" } as never,
          repositoryPath: "/isolated",
        },
      ],
    ]),
    sharedInstance: new Map([
      ["shared", { workspace: { slug: "acme", name: "Acme" }, projectId: "pay" }],
    ]),
    turnsOf: () =>
      Effect.sync(() => {
        reads++;
        return {
          providerThreads: [
            { id: "shared", providerInstanceId: "shared" },
            { id: "personal", providerInstanceId: "personal" },
          ],
          providerTurns: turns,
        } as never;
      }),
  });
  const thread = (updated: number, links: ThreadPullRequestLink[] = [], provider = "shared") =>
    ({
      id: "thread",
      projectId: "t3",
      providerInstanceId: provider,
      providerInstanceHistory: ["shared", "personal"],
      updatedAt: DateTime.makeUnsafe(updated),
      pullRequests: links,
    }) as never as OrchestrationV2ThreadShell;
  return {
    observe,
    rows,
    prs,
    pass,
    thread,
    reads: () => reads,
    set: (t: OrchestrationV2ThreadShell[], u: OrchestrationV2ProviderTurn[]) => {
      threads = t;
      turns = u;
    },
  };
};
it.effect(
  "seeds cursors, attributes only shared completed turns by opaque task and never counts them twice",
  () =>
    Effect.gen(function* () {
      const f = fixture(),
        person = freshPerson();
      f.set([f.thread(1)], [turn("seed", 1, usage)]);
      yield* f.observe(f.pass(1), person);
      expect(f.rows).toEqual([]);
      const observations = [
        turn("seed", 1, usage),
        turn("full", 2, usage),
        turn("personal", 3, usage, "personal"),
        turn("partial", 4, { ...usage, usageStatus: "partial" }),
        turn("unavailable", 5, { ...usage, usageStatus: "unavailable" }),
        turn("child", 6, { ...usage, hasSubagents: true }),
      ];
      f.set([f.thread(6, [], "personal")], observations);
      yield* f.observe(f.pass(2), person);
      expect(f.rows.map((r) => r.reference)).toEqual(Array(4).fill(taskRef("SENTINEL-title-1234")));
      expect(f.rows[0]?.row).toEqual({ in: 100, out: 10, cached: 25, turns: 1, partial: 0 });
      expect(f.rows.map((r) => r.row.partial)).toEqual([0, 1, 1, 1]);
      expect(f.rows[2]?.row.in).toBe(0);
      expect(JSON.stringify(f.rows)).not.toContain("SENTINEL");
      yield* f.observe(f.pass(3), person);
      expect(f.reads()).toBe(2);
      f.set([f.thread(7)], [...observations, turn("no-task", 7, undefined)]);
      yield* f.observe(f.pass(4, null), person);
      expect(f.rows.at(-1)).toEqual({
        reference: "none",
        row: { in: 0, out: 0, cached: 0, turns: 1, partial: 1 },
      });
    }).pipe(Effect.scoped),
);
it.effect("PR mergeability is measured once per computer and only for open assigned links", () =>
  Effect.gen(function* () {
    const f = fixture(),
      person = freshPerson(),
      link = (number: number, mergeability: string, state = "open"): ThreadPullRequestLink =>
        ({
          host: "github.com",
          repository: "acme/pay",
          number,
          source: "manual",
          snapshot: { state, mergeability },
        }) as never;
    f.set([f.thread(1, [link(1, "mergeable")])], []);
    yield* f.observe(f.pass(1), person);
    expect(f.prs).toEqual([]);
    f.set(
      [f.thread(2, [link(1, "conflicting"), link(2, "unknown"), link(3, "conflicting", "closed")])],
      [],
    );
    yield* f.observe(f.pass(2), person);
    expect(f.prs).toEqual([{ checked: false, conflicting: true }]);
    f.set(
      [
        f.thread(3, [
          link(1, "conflicting"),
          link(2, "conflicting"),
          link(4, "mergeable", "merged"),
        ]),
      ],
      [],
    );
    yield* f.observe(f.pass(3), person);
    expect(f.prs).toEqual([
      { checked: false, conflicting: true },
      { checked: true, conflicting: true },
    ]);
    f.set([f.thread(4, [link(2, "conflicting")])], []);
    yield* f.observe(f.pass(4), person);
    expect(f.prs).toHaveLength(2);
  }).pipe(Effect.scoped),
);
