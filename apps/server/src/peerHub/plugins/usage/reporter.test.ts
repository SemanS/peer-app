import { assert, describe, it } from "@effect/vitest";
import {
  EnvironmentId,
  PeerHubError,
  UsageReadError,
  type PeerUsageReportInput,
  type PeerUsageSharingAnswer,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as TestClock from "effect/testing/TestClock";

import type { UsageSessionTotal } from "../../../usage/usageSessionTotals.ts";
import type { UsageReportOutcome } from "./hub.ts";
import { createReporter, type ReporterInput } from "./reporter.ts";

const NOW = Date.parse("2026-10-30T12:00:00Z");

const persisted = (email: string | null = "ana@acme.test") => ({
  email,
  workspaces: [
    {
      slug: "acme",
      manifest: {
        workspace: { slug: "acme" },
        projects: [
          { id: "pay", repositories: [] },
          { id: "web", repositories: [] },
        ],
      },
    },
  ],
  runs: {
    run_1: {
      workspace: "acme",
      project: "pay",
      email: "ana@acme.test",
      startedAt: "2026-10-01T09:00:00.000Z",
      sessions: [
        { id: "claude:pay", from: "" },
        { id: "claude:pay-2", from: "" },
      ],
    },
    run_2: {
      workspace: "acme",
      project: "web",
      email: "ana@acme.test",
      startedAt: "2026-10-01T09:00:00.000Z",
      sessions: [{ id: "claude:web", from: "" }],
    },
  },
});

const total = (sessionId: string, output: number, day = "2026-10-30"): UsageSessionTotal => ({
  day,
  provider: "claude",
  model: "claude-opus-5-5",
  sessionId,
  dir: "/home/ana/.claude/projects",
  totals: {
    uncachedInputTokens: 1,
    cachedInputTokens: 0,
    cacheCreationTokens: 0,
    outputTokens: output,
    reasoningTokens: 0,
  },
  costUsd: 1,
  unpriced: false,
});

/** A reporter over plain stand-ins, each answer changed by assigning to `world`. */
const stage = (
  over: Partial<Omit<ReporterInput, "usage">> & {
    readonly sharingTurnedOn?: ReporterInput["usage"]["sharingTurnedOn"];
  } = {},
) => {
  const { sharingTurnedOn = Effect.never, ...rest } = over;
  const world = {
    now: NOW,
    state: persisted(),
    features: { usage: 1 } as Readonly<Record<string, number>>,
    sharing: { sharing: true, at: "2026-10-01T00:00:00Z" } as PeerUsageSharingAnswer,
    sessions: [total("pay", 5)],
    partial: false,
    answer: ((): Effect.Effect<UsageReportOutcome, PeerHubError> => Effect.succeed("stored")) as (
      input: PeerUsageReportInput,
    ) => Effect.Effect<UsageReportOutcome, PeerHubError>,
    reports: [] as Array<PeerUsageReportInput>,
    reads: 0,
    asked: 0,
  };
  const reporter = createReporter({
    state: {
      current: () => ({ persisted: world.state }) as never,
      hubHome: "/home/ana/.t3/hub",
      environmentId: EnvironmentId.make("ana-laptop"),
    },
    features: Effect.sync(() => world.features),
    usage: {
      sharing: () =>
        Effect.sync(() => {
          world.asked += 1;
          return world.sharing;
        }),
      report: (input) =>
        Effect.suspend(() => {
          world.reports.push(input);
          return world.answer(input);
        }),
      sharingTurnedOn,
    },
    read: () =>
      Effect.sync(() => {
        world.reads += 1;
        return { sessions: world.sessions, partial: world.partial };
      }),
    remoteOf: () => Promise.resolve(null),
    now: () => world.now,
    ...rest,
  });
  return { world, reporter };
};

describe("a pass", () => {
  it.effect("sends and reads nothing while sharing is off", () =>
    Effect.gen(function* () {
      const { world, reporter } = stage();
      world.sharing = { sharing: false, at: null };
      yield* reporter.pass;
      assert.deepStrictEqual(world.reports, []);
      assert.strictEqual(world.reads, 0);
    }),
  );

  it.effect("sends nothing to an older Hub, and asks it nothing when it lists no feature", () =>
    Effect.gen(function* () {
      const { world, reporter } = stage();
      world.features = { metrics: 1 };
      yield* reporter.pass;
      assert.strictEqual(world.asked, 0);

      world.features = { usage: 1 };
      world.sharing = { unsupported: true };
      yield* reporter.pass;
      assert.deepStrictEqual(world.reports, []);
      assert.strictEqual(world.reads, 0);
    }),
  );

  it.effect("sends nobody's usage when nobody is signed in", () =>
    Effect.gen(function* () {
      const { world, reporter } = stage();
      world.state = persisted(null);
      yield* reporter.pass;
      assert.strictEqual(world.asked, 0);
    }),
  );

  it.effect("sends a changed day once, and only that day", () =>
    Effect.gen(function* () {
      const { world, reporter } = stage();
      world.sessions = [total("pay", 5), total("pay", 7, "2026-10-29")];
      yield* reporter.pass;
      assert.deepStrictEqual(
        world.reports.map((report) => report.day),
        ["2026-10-29", "2026-10-30"],
      );
      assert.strictEqual(world.reports[0]?.environment, "ana-laptop");
      assert.strictEqual(world.reports[0]?.project, "pay");

      yield* reporter.pass;
      assert.lengthOf(world.reports, 2);

      world.sessions = [total("pay", 6), total("pay", 7, "2026-10-29")];
      yield* reporter.pass;
      assert.lengthOf(world.reports, 3);
      assert.strictEqual(world.reports[2]?.day, "2026-10-30");
      assert.strictEqual(world.reports[2]?.rows[0]?.output, 6);
    }),
  );

  it.effect("asks for the last 35 UTC days, today included", () =>
    Effect.gen(function* () {
      let asked: unknown;
      const { reporter } = stage({
        read: (input) =>
          Effect.sync(() => {
            asked = input;
            return { sessions: [], partial: false };
          }),
      });
      yield* reporter.pass;
      assert.deepStrictEqual(asked, { sinceDay: "2026-09-26", untilDay: "2026-10-30" });
    }),
  );

  it.effect("keeps `rev` ahead of the clock's and of its own last one", () =>
    Effect.gen(function* () {
      const { world, reporter } = stage();
      yield* reporter.pass;
      assert.strictEqual(world.reports[0]?.rev, NOW);
      world.now = NOW - 1000;
      world.sessions = [total("pay", 6)];
      yield* reporter.pass;
      assert.strictEqual(world.reports[1]?.rev, NOW + 1);
    }),
  );

  it.effect("after `stale_rollup`, sends again on the next pass with a higher `rev`", () =>
    Effect.gen(function* () {
      const { world, reporter } = stage();
      world.answer = () => Effect.succeed("stale");
      yield* reporter.pass;
      world.answer = () => Effect.succeed("stored");
      yield* reporter.pass;
      assert.lengthOf(world.reports, 2);
      assert.isAbove(world.reports[1]!.rev, world.reports[0]!.rev);
      yield* reporter.pass;
      assert.lengthOf(world.reports, 2);
    }),
  );

  it.effect("never takes a day back when its sessions are gone from this pass", () =>
    Effect.gen(function* () {
      const { world, reporter } = stage();
      yield* reporter.pass;
      assert.lengthOf(world.reports, 1);
      world.sessions = [];
      yield* reporter.pass;
      yield* reporter.pass;
      assert.lengthOf(world.reports, 1);
    }),
  );

  it.effect("sends no empty rows for a day of sessions with no tokens", () =>
    Effect.gen(function* () {
      const { world, reporter } = stage();
      const empty = total("pay", 0);
      world.sessions = [{ ...empty, totals: { ...empty.totals, uncachedInputTokens: 0 } }];
      yield* reporter.pass;
      assert.deepStrictEqual(world.reports, []);
    }),
  );

  it.effect("sends nothing, and scans nothing, while any workspace's manifest is missing", () =>
    Effect.gen(function* () {
      const { world, reporter } = stage();
      const known = persisted();
      world.state = {
        ...known,
        workspaces: [...known.workspaces, { slug: "beta", manifest: null as never }],
      };
      yield* reporter.pass;
      assert.deepStrictEqual(world.reports, []);
      assert.strictEqual(world.reads, 0);

      world.state = known;
      yield* reporter.pass;
      assert.lengthOf(world.reports, 1);
    }),
  );

  it.effect("sends nothing when the sessions were read in part, or could not be read", () =>
    Effect.gen(function* () {
      const reads = { fails: false };
      const { world, reporter } = stage({
        read: () =>
          reads.fails
            ? Effect.fail(new UsageReadError({ reason: "scanFailed", detail: "no" }))
            : Effect.sync(() => ({ sessions: world.sessions, partial: world.partial })),
      });
      world.partial = true;
      yield* reporter.pass;
      assert.deepStrictEqual(world.reports, []);

      world.partial = false;
      reads.fails = true;
      yield* reporter.pass;
      assert.deepStrictEqual(world.reports, []);

      reads.fails = false;
      yield* reporter.pass;
      assert.lengthOf(world.reports, 1);
    }),
  );

  it.effect("asks again for an `origin` that was not found, and places the session then", () =>
    Effect.gen(function* () {
      const answers: Array<string | null> = [null, "https://github.com/acme/api.git"];
      const asked: Array<string> = [];
      const { world, reporter } = stage({
        remoteOf: (cwd) => {
          asked.push(cwd);
          return Promise.resolve(answers.shift() ?? null);
        },
      });
      const state = persisted();
      world.state = {
        ...state,
        workspaces: [
          {
            slug: "acme",
            manifest: {
              ...state.workspaces[0]!.manifest,
              projects: [
                {
                  id: "pay",
                  repositories: [{ id: "api", url: "https://github.com/acme/api.git" } as never],
                },
              ],
            },
          },
        ],
      };
      world.sessions = [{ ...total("elsewhere", 5), cwd: "/one" }];
      yield* reporter.pass;
      assert.deepStrictEqual(world.reports, []);
      yield* reporter.pass;
      assert.lengthOf(world.reports, 1);
      yield* reporter.pass;
      assert.deepStrictEqual(asked, ["/one", "/one"]);
    }),
  );

  it.effect("sends everything again once the Hub says sharing went off and on", () =>
    Effect.gen(function* () {
      const { world, reporter } = stage();
      yield* reporter.pass;
      assert.lengthOf(world.reports, 1);
      // Another computer turned it off and on: no wake here, only a new `at`.
      world.sharing = { sharing: true, at: "2026-10-30T11:00:00Z" };
      yield* reporter.pass;
      assert.lengthOf(world.reports, 2);
      assert.deepStrictEqual(world.reports[1]?.rows, world.reports[0]?.rows);
    }),
  );

  it.effect("sends everything again after a pass saw sharing off", () =>
    Effect.gen(function* () {
      const { world, reporter } = stage();
      yield* reporter.pass;
      world.sharing = { sharing: false, at: null };
      yield* reporter.pass;
      world.sharing = { sharing: true, at: "2026-10-01T00:00:00Z" };
      yield* reporter.pass;
      assert.lengthOf(world.reports, 2);
    }),
  );

  it.effect("stops at `usage_not_shared` and remembers nothing it sent", () =>
    Effect.gen(function* () {
      const { world, reporter } = stage();
      world.sessions = [total("pay", 5), total("web", 7)];
      world.answer = () => Effect.succeed("not-shared");
      yield* reporter.pass;
      assert.lengthOf(world.reports, 1);
      world.answer = () => Effect.succeed("stored");
      yield* reporter.pass;
      assert.lengthOf(world.reports, 3);
    }),
  );

  it.effect("a project the person left costs that project alone", () =>
    Effect.gen(function* () {
      const { world, reporter } = stage();
      world.sessions = [total("pay", 5), total("pay-2", 6, "2026-10-29"), total("web", 7)];
      world.answer = ({ project }) =>
        project === "pay"
          ? Effect.fail(new PeerHubError({ detail: "no such project", status: 404 }))
          : Effect.succeed("stored");
      yield* reporter.pass;
      assert.deepStrictEqual(
        world.reports.map((report) => report.project),
        ["pay", "web"],
      );
    }),
  );

  it.effect("loses nothing when the Hub cannot be reached", () =>
    Effect.gen(function* () {
      const { world, reporter } = stage();
      world.sessions = [total("pay", 5), total("web", 7)];
      world.answer = () => Effect.fail(new PeerHubError({ detail: "unreachable" }));
      yield* reporter.pass;
      assert.lengthOf(world.reports, 1);
      world.answer = () => Effect.succeed("stored");
      yield* reporter.pass;
      assert.lengthOf(world.reports, 3);
    }),
  );

  it.effect("starts over for another person on this computer", () =>
    Effect.gen(function* () {
      const { world, reporter } = stage();
      yield* reporter.pass;
      world.state = { ...persisted("bob@acme.test") };
      world.state = {
        ...world.state,
        runs: {
          run_1: { ...world.state.runs.run_1, email: "bob@acme.test" },
          run_2: world.state.runs.run_2,
        },
      };
      yield* reporter.pass;
      assert.lengthOf(world.reports, 2);
    }),
  );

  it.effect("sends nothing for a session no rule places", () =>
    Effect.gen(function* () {
      const { world, reporter } = stage();
      world.sessions = [{ ...total("nobodys", 5), cwd: "/home/ana/notes" }];
      yield* reporter.pass;
      assert.deepStrictEqual(world.reports, []);
    }),
  );

  it.effect("asks for each directory's `origin` once, and not for a session a run names", () =>
    Effect.gen(function* () {
      const asked: Array<string> = [];
      const { world, reporter } = stage({
        remoteOf: (cwd) => {
          asked.push(cwd);
          return Promise.resolve("https://github.com/ana/notes.git");
        },
      });
      world.sessions = [
        { ...total("pay", 5), cwd: "/run/named" },
        { ...total("a", 5), cwd: "/one" },
        { ...total("b", 5), cwd: "/one" },
        { ...total("c", 5, "2026-10-29"), cwd: "/one" },
      ];
      yield* reporter.pass;
      yield* reporter.pass;
      assert.deepStrictEqual(asked, ["/one"]);
    }),
  );
});

describe("the loop", () => {
  it.effect("runs after a minute, then every 30 minutes, and at once on a wake", () =>
    Effect.gen(function* () {
      const wakes = yield* Queue.unbounded<string>();
      const { world, reporter } = stage({ sharingTurnedOn: Queue.take(wakes) });
      yield* reporter.run.pipe(Effect.forkScoped);
      yield* Effect.yieldNow;

      yield* TestClock.adjust("59 seconds");
      assert.lengthOf(world.reports, 0);
      yield* TestClock.adjust("1 second");
      assert.lengthOf(world.reports, 1);

      world.sessions = [total("pay", 6)];
      yield* TestClock.adjust("29 minutes");
      assert.lengthOf(world.reports, 1);
      yield* TestClock.adjust("1 minute");
      assert.lengthOf(world.reports, 2);

      // Same content: only the wake makes it go again, because sharing went off in between.
      yield* Queue.offer(wakes, "acme");
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      assert.lengthOf(world.reports, 3);
    }).pipe(Effect.scoped),
  );
});
