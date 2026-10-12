// @effect-diagnostics nodeBuiltinImport:off globalDate:off - a workspace checkout made with git in a temporary directory, and overlap notes written now.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterEach, assert, describe, it } from "@effect/vitest";
import type { PeerHubStartAgentInput, PeerHubStatus } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";
import { vi } from "vite-plus/test";

import { brokerFixture, pluginsOf } from "../../core/broker/testkit.ts";
import * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import { brokerPlugins } from "../../core/coordination/PeerCoordination.ts";
import type { HubOverlap, ReportedSession } from "../../core/hub/coordApi.ts";
import * as PeerPlugins from "../../core/plugins/PeerPlugins.ts";
import * as PeerStatus from "../../core/status/PeerStatus.ts";
import { coreLayer, paymentsSeed, paymentsT3, seedState, standInHub } from "../../core/testkit.ts";
import * as PeerWork from "../../core/work/PeerWork.ts";
import * as Start from "../../core/work/start.ts";
import type { HerdrAgent } from "./client/herdr.ts";
import { HerdrClient, type HerdrClientShape } from "./client/HerdrClient.ts";
import { HerdrProcess, type HerdrProcessShape } from "./client/HerdrProcess.ts";
import { fakeHerdrProcess, fakeHerdrWorld } from "./client/HerdrProcess.testkit.ts";
import { HerdrPlugin } from "./index.ts";

afterEach(() => vi.unstubAllEnvs());

const coordination: PeerHubStatus["coordination"] = {
  enabled: false,
  policy: "coordinate",
  claudeHooks: false,
  logPath: "/tmp/coordination.jsonl",
  sessions: [],
  overlaps: [],
  findings: [],
  contexts: [],
  candidates: [],
};

/** A Codex agent herdr runs, idle in pane w1:p1 with its own session. */
const agentIn = (cwd: string, extra: Partial<HerdrAgent> = {}): HerdrAgent => ({
  terminalId: "t1",
  paneId: "w1:p1",
  agent: "codex",
  title: "Split payments",
  status: "idle",
  completionSeq: undefined,
  cwd,
  session: { id: "s1", path: undefined },
  ...extra,
});

/**
 * herdr where `agents` run now, as a stand-in: what Peer asks of it goes to `asked`, in order, and
 * `woken` settles once it woke an agent. An agent it starts runs idle in pane w2:p1, without a
 * session yet.
 */
const standInHerdr = (agents: { current: ReadonlyArray<HerdrAgent> | null }) => {
  const asked: Array<string> = [];
  const woken = Promise.withResolvers<void>();
  const client: HerdrClientShape = {
    follow: () => ({ read: async () => agents.current, live: () => false, close: () => undefined }),
    list: async () => agents.current,
    read: async () => ({ kind: "unavailable" }),
    prompt: async (target, text) => void asked.push(`prompt ${target}: ${text}`),
    wake: async (expected, text) => {
      asked.push(`wake ${expected.paneId}: ${text}`);
      woken.resolve();
      return { status: "queued" };
    },
    focus: async (paneId) => void asked.push(`focus ${paneId}`),
    notify: async () => undefined,
    start: async (input) => {
      const env = Object.entries(input.env ?? {}).map(([name, value]) => `${name}=${value}`);
      asked.push(`start ${input.harness} with ${env.join(" ")}`);
      agents.current = [
        ...(agents.current ?? []),
        agentIn(input.cwd, { terminalId: "t2", paneId: "w2:p1", session: undefined }),
      ];
      return { paneId: "w2:p1", terminalId: "t2" };
    },
  };
  return { client, asked, woken: woken.promise };
};

/** acme's work: Payments has two open tasks, KRK-1 and KRK-2. */
const ACME_WORK = {
  projects: {
    pay: {
      areas: [],
      tasks: [
        {
          id: "krk-1",
          key: "KRK-1",
          title: "Split payments",
          status: "open",
          createdBy: "ana@acme.test",
          createdAt: "2026-10-08T10:00:00Z",
          updatedAt: "2026-10-08T10:00:00Z",
        },
        {
          id: "krk-2",
          key: "KRK-2",
          title: "Refunds",
          status: "open",
          createdBy: "ana@acme.test",
          createdAt: "2026-10-08T10:00:00Z",
          updatedAt: "2026-10-08T10:00:00Z",
        },
      ],
      threads: [],
    },
  },
};

/** The person's own herdr runs on a computer with no bundled one: herdr as Peer always found it. */
const ownHerdr = () =>
  fakeHerdrProcess(
    fakeHerdrWorld({
      binary: { available: false, reason: "This build of Peer does not include herdr." },
      own: { version: "0.9.3", agents: [] },
    }),
  );

/** Ana's Peer in acme's Payments project, with the herdr plugin started over `client`. */
const anaWithHerdr = (client: HerdrClientShape, herdrProcess: HerdrProcessShape = ownHerdr()) =>
  Effect.gen(function* () {
    const hub = yield* standInHub({
      current: (url) => (url === "/v1/workspaces/acme/work" ? [200, ACME_WORK] : [200, {}]),
    });
    const core = yield* Layer.build(
      coreLayer(yield* seedState(paymentsSeed(hub.url)), {
        session: "phs_test",
        plugins: [HerdrPlugin],
        t3: paymentsT3,
      }),
    );
    return yield* Effect.gen(function* () {
      const status = yield* PeerStatus.PeerStatus;
      yield* status.coordinationFrom(() => Effect.succeed(coordination));
      yield* PeerPlugins.startPlugins.pipe(
        Effect.provideService(HerdrClient, client),
        Effect.provideService(HerdrProcess, herdrProcess),
      );
      return {
        core,
        status,
        plugins: yield* PeerPlugins.PeerPlugins,
        work: yield* PeerWork.PeerWork,
      };
    }).pipe(Effect.provide(core));
  });

/** The first status, now or later, whose herdr agents satisfy `seen`. */
const agentsWhen = (
  status: PeerStatus.PeerStatus["Service"],
  seen: (agents: PeerHubStatus["agents"]) => boolean,
) =>
  status.changes.pipe(
    Stream.map((next) => next.agents),
    Stream.filter(seen),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
  );

const refusal = <A, E extends { readonly message: string }, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.result,
    Effect.map((result) => (Result.isFailure(result) ? result.failure.message : null)),
  );

describe("herdr's agents", () => {
  it.effect("show in the status while herdr is on, and none while it is off", () =>
    Effect.gen(function* () {
      const dir = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped({
        prefix: "peer-herdr-",
      });
      const { client } = standInHerdr({ current: [agentIn(dir)] });
      const { status, plugins } = yield* anaWithHerdr(client);
      const on = yield* agentsWhen(status, (agents) => agents.list.length === 1);
      assert.strictEqual(on.herdr, "running");
      assert.deepStrictEqual(
        on.list.map((agent) => [agent.id, agent.paneId, agent.coordinationLevel]),
        [["herdr:codex:s1", "w1:p1", "C"]],
      );

      yield* plugins.setPlugin({ id: "herdr", enabled: false });
      const off = yield* status.publish;
      assert.deepStrictEqual(off.agents, { herdr: "not-running", list: [] });
      assert.deepStrictEqual(
        off.plugins?.find((plugin) => plugin.id === "herdr"),
        { id: "herdr", title: "herdr agents", enabled: false, active: false, reason: "off" },
      );

      yield* plugins.setPlugin({ id: "herdr", enabled: true });
      yield* agentsWhen(status, (agents) => agents.list.length === 1);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

describe("starting an agent on a task", () => {
  it.effect(
    "launches it in a checkout of its own and puts it on the task; while off, says herdr agents are off",
    () =>
      Effect.gen(function* () {
        // Ana's Payments checkout: a repository with one commit on main.
        const root = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped({
          prefix: "peer-herdr-start-",
        });
        vi.stubEnv("PEER_WORKSPACE", root);
        const checkout = NodePath.join(root, "acme", "pay", "api");
        NodeFS.mkdirSync(checkout, { recursive: true });
        const git = (...args: Array<string>) =>
          NodeChildProcess.execFileSync("git", ["-C", checkout, ...args], { stdio: "ignore" });
        git("init", "--quiet", "--initial-branch=main");
        NodeFS.writeFileSync(NodePath.join(checkout, "README.md"), "Payments\n");
        git("add", "README.md");
        git(
          "-c",
          "user.name=Ana",
          "-c",
          "user.email=ana@acme.test",
          "commit",
          "--quiet",
          "-m",
          "start",
        );

        const { client, asked } = standInHerdr({ current: [] });
        const { core, plugins, work } = yield* anaWithHerdr(client);
        yield* work.readWork("acme").pipe(Effect.provide(core));
        const input: PeerHubStartAgentInput = {
          workspace: "acme",
          projectId: "pay",
          taskId: "krk-1",
          repositoryId: "api",
          harness: "codex",
        };
        const started = yield* Start.startAgent(input).pipe(Effect.provide(core));
        assert.deepStrictEqual(started, { paneId: "w2:p1", terminalId: "t2" });
        assert.deepStrictEqual(asked, [
          "start codex with PEER_TASK=KRK-1",
          "prompt w2:p1: KRK-1: Split payments. Work in your own checkout and coordinate shared changes through Peer.",
        ]);
        // Its thread is on the task, and it works in a worktree beside Ana's checkout.
        assert.deepStrictEqual(Option.getOrUndefined(yield* work.assignment("herdr:t2")), {
          workspace: "acme",
          project: "pay",
          task: "krk-1",
        });
        const trees = NodeFS.readdirSync(NodePath.join(root, ".worktrees", "acme", "pay", "api"));
        assert.match(trees[0] ?? "", /^KRK-1-[0-9a-f]{8}$/);

        yield* plugins.setPlugin({ id: "herdr", enabled: false });
        assert.strictEqual(
          yield* refusal(Start.startAgent(input).pipe(Effect.provide(core))),
          "herdr agents is turned off on this environment.",
        );
        assert.strictEqual(asked.length, 2, "nothing was started or prompted");
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

/** An open overlap of `session` with Vir's agent, on which Vir's agent just wrote `text`. */
const noteTo = (session: string, text: string): HubOverlap => {
  const now = new Date().toISOString();
  return {
    id: `overlap-${session}`,
    project: "app",
    sessions: [`claude:${session}`, "claude:vir"],
    files: ["src/pay.ts"],
    state: "open",
    notes: [
      { id: `note-${session}`, session: "claude:vir", email: "vir@acme.test", text, at: now },
    ],
    openedAt: now,
    updatedAt: now,
  };
};

describe("waking an idle agent herdr runs", () => {
  it.effect(
    "goes through herdr while it is on; while it is off, news waits for the next step",
    () =>
      Effect.gen(function* () {
        const dir = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped({
          prefix: "peer-herdr-wake-",
        });
        // Two Claude Code agents herdr runs, each idle in its pane with its own session.
        const agents = {
          current: [
            agentIn(dir, { agent: "claude", session: { id: "one", path: undefined } }),
            agentIn(dir, {
              terminalId: "t2",
              paneId: "w1:p2",
              agent: "claude",
              session: { id: "two", path: undefined },
            }),
          ],
        };
        const { client, asked, woken } = standInHerdr(agents);
        const { status, plugins } = yield* anaWithHerdr(client);
        const fixture = yield* Effect.acquireRelease(
          Effect.promise(() => brokerFixture(() => pluginsOf(plugins))),
          (made) => Effect.promise(() => made.dispose()),
        );
        yield* Effect.promise(async () => {
          await fixture.broker["sessionFor"](
            "claude",
            { session_id: "one", cwd: fixture.root },
            "w1:p1",
          );
          await fixture.broker["sessionFor"](
            "claude",
            { session_id: "two", cwd: fixture.root },
            "w1:p2",
          );
        });
        const overlaps = [
          noteTo("one", "I rename pay() first"),
          noteTo("two", "Keep the old export"),
        ];
        fixture.broker["views"].set("acme", { sessions: [], overlaps, at: overlaps[0]!.updatedAt });

        yield* plugins.setPlugin({ id: "herdr", enabled: false });
        yield* Effect.promise(() => fixture.broker["wakeIdle"]());
        assert.isFalse(
          asked.some((line) => line.startsWith("wake")),
          "herdr wakes nobody while off",
        );
        // The note reaches the agent at its next step.
        const next = yield* Effect.promise(() =>
          fixture.broker["hook"](
            {
              session_id: "one",
              cwd: fixture.root,
              hook_event_name: "UserPromptSubmit",
              prompt: "Go on.",
            },
            {},
          ),
        );
        const told = (
          next?.hookSpecificOutput as { readonly additionalContext?: string } | undefined
        )?.additionalContext;
        assert.include(told ?? "", "I rename pay() first");

        yield* plugins.setPlugin({ id: "herdr", enabled: true });
        yield* agentsWhen(status, (listed) => listed.list.length === 2);
        yield* Effect.promise(() => fixture.broker["wakeIdle"]());
        yield* Effect.promise(() => woken);
        assert.deepStrictEqual(
          asked.filter((line) => line.startsWith("wake")),
          ["wake w1:p2: [Peer coordination update]"],
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

/** Ana's Claude Code agent `one` in pane w1:p1, done after its seventh piece of work. */
const doneAgent = (dir: string, extra: Partial<HerdrAgent> = {}) =>
  agentIn(dir, {
    agent: "claude",
    status: "done",
    completionSeq: 7,
    session: { id: "one", path: undefined },
    ...extra,
  });

/**
 * Ana's agent `one` as Peer's follower last read it (`seen`), herdr as it answers when Peer asks
 * again just before it types (`now`), and Peer's hooks knowing the session in the agent's pane.
 * `typing` makes herdr fail the prompt itself. Prompts that reach herdr are in `asked`.
 */
const anaWithAgentOne = (read: (dir: string) => HerdrAgent = doneAgent) =>
  Effect.gen(function* () {
    const dir = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped({
      prefix: "peer-herdr-prompt-",
    });
    const seen = { current: [read(dir)] as ReadonlyArray<HerdrAgent> | null };
    const now = { current: seen.current };
    const typing = { fails: false };
    const { client: standIn, asked } = standInHerdr(seen);
    const client: HerdrClientShape = {
      ...standIn,
      list: async () => now.current,
      prompt: async (target, text) => {
        if (typing.fails) throw new Error("herdr closed the connection");
        return standIn.prompt(target, text);
      },
    };
    const { core, status, plugins } = yield* anaWithHerdr(client);
    yield* agentsWhen(status, (agents) => agents.list.length === 1);
    const fixture = yield* Effect.acquireRelease(
      Effect.promise(() => brokerFixture(() => pluginsOf(plugins))),
      (made) => Effect.promise(() => made.dispose()),
    );
    yield* Effect.promise(() =>
      fixture.broker["sessionFor"]("claude", { session_id: "one", cwd: fixture.root }, "w1:p1"),
    );
    const peerAgents = Context.get(core, PeerAgents.PeerAgents);
    yield* peerAgents.attach(fixture.broker);
    /** What `promptRuntime` ends as for the agent, with what the caller read of it. */
    const prompted = (text: string, expect?: { session?: string; turn?: number }) =>
      peerAgents.promptRuntime("herdr:claude:one", text, expect).pipe(
        Effect.map(() => "typed"),
        Effect.catch((failure) =>
          Effect.succeed(
            failure._tag === "PeerPromptStale" ? `stale ${failure.reason}` : failure.message,
          ),
        ),
      );
    return { dir, seen, now, typing, asked, prompted, peerAgents, plugins, status };
  });

describe("typing into an agent that was read earlier", () => {
  it.effect(
    "lists the session and the turn herdr reports for an agent, so a caller can name them later",
    () =>
      Effect.gen(function* () {
        const { status, peerAgents } = yield* anaWithAgentOne();
        const [one] = (yield* status.publish).agents.list;
        assert.deepStrictEqual(
          [one?.id, one?.session, one?.turn, one?.status],
          ["herdr:claude:one", "one", 7, "done"],
        );
        assert.deepStrictEqual(
          (yield* peerAgents.runtimeAgents).map((agent) => [agent.id, agent.session, agent.turn]),
          [["herdr:claude:one", "one", 7]],
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "lists the session Peer's hooks know when herdr reports none, and no turn without a completion",
    () =>
      Effect.gen(function* () {
        const { peerAgents } = yield* anaWithAgentOne((dir) =>
          doneAgent(dir, { session: undefined, completionSeq: undefined }),
        );
        const [hooked] = yield* peerAgents.runtimeAgents;
        assert.deepStrictEqual(
          [hooked?.id, hooked?.session, hooked?.turn],
          ["herdr:claude:one", "one", undefined],
        );
        assert.notProperty(hooked ?? {}, "turn");
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "types the answer into the same session at the same turn, by the terminal's live name",
    () =>
      Effect.gen(function* () {
        const { now, dir, asked, prompted } = yield* anaWithAgentOne();
        assert.strictEqual(
          yield* prompted("use the second option", { session: "one", turn: 7 }),
          "typed",
        );
        // What the caller does not name is compared with what Peer last read of the agent.
        assert.strictEqual(yield* prompted("and the third", {}), "typed");
        // The pane moved; the name follows the agent.
        now.current = [doneAgent(dir, { paneId: "w2:p2", name: "peer-one" })];
        assert.strictEqual(yield* prompted("then stop", { session: "one", turn: 7 }), "typed");
        assert.deepStrictEqual(asked, [
          "prompt w1:p1: use the second option",
          "prompt w1:p1: and the third",
          "prompt peer-one: then stop",
        ]);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("types nothing when its terminal runs another session, another turn, or is busy", () =>
    Effect.gen(function* () {
      const { now, dir, asked, prompted } = yield* anaWithAgentOne();
      const read = { session: "one", turn: 7 };
      const cases: ReadonlyArray<readonly [string, ReadonlyArray<HerdrAgent> | null]> = [
        ["stale session", [doneAgent(dir, { session: { id: "two", path: undefined } })]],
        ["stale session", [doneAgent(dir, { session: { id: "one", path: "/claude/one.jsonl" } })]],
        ["stale session", [doneAgent(dir, { agent: "codex" })]],
        ["stale turn", [doneAgent(dir, { completionSeq: 8 })]],
        ["stale turn", [doneAgent(dir, { completionSeq: undefined })]],
        ["stale busy", [doneAgent(dir, { status: "working" })]],
        ["stale busy", [doneAgent(dir, { status: "blocked" })]],
        ["stale gone", []],
        ["stale gone", [doneAgent(dir, { terminalId: "t9", paneId: "w1:p9" })]],
        ["stale gone", null],
      ];
      for (const [expected, listed] of cases) {
        now.current = listed;
        assert.strictEqual(yield* prompted("use the second option", read), expected);
      }
      // What the caller read decides as well as what Peer read itself.
      now.current = [doneAgent(dir)];
      assert.strictEqual(yield* prompted("x", { session: "two", turn: 7 }), "stale session");
      assert.strictEqual(yield* prompted("x", { session: "one", turn: 6 }), "stale turn");
      assert.deepStrictEqual(asked, []);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "fails a prompt herdr does not take, and without what was read types as it always did",
    () =>
      Effect.gen(function* () {
        const { now, typing, asked, prompted } = yield* anaWithAgentOne();
        typing.fails = true;
        const taken = "herdr could not confirm the prompt. Read the agent before retrying.";
        assert.strictEqual(yield* prompted("words", { session: "one", turn: 7 }), taken);
        assert.strictEqual(yield* prompted("words"), taken);
        typing.fails = false;
        // Nothing is read again without `expect`: a prompt goes to the pane Peer knows.
        now.current = [];
        assert.strictEqual(yield* prompted("words"), "typed");
        assert.deepStrictEqual(asked, ["prompt w1:p1: words"]);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("types nothing while herdr agents are off", () =>
    Effect.gen(function* () {
      const { plugins, asked, prompted } = yield* anaWithAgentOne();
      yield* plugins.setPlugin({ id: "herdr", enabled: false });
      assert.strictEqual(yield* prompted("words", { session: "one", turn: 7 }), "stale gone");
      assert.deepStrictEqual(asked, []);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

/**
 * Ana's Payments checkout in a workspace of its own: one commit on `branch`, and src/pay.ts changed
 * since, as an agent leaves it after a piece of work.
 */
const paymentsCheckout = (branch: string) =>
  Effect.gen(function* () {
    const root = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped({
      prefix: "peer-herdr-report-",
    });
    vi.stubEnv("PEER_WORKSPACE", root);
    const checkout = NodePath.join(root, "acme", "pay", "api");
    NodeFS.mkdirSync(NodePath.join(checkout, "src"), { recursive: true });
    const git = (...args: Array<string>) =>
      NodeChildProcess.execFileSync("git", ["-C", checkout, ...args], { stdio: "ignore" });
    git("init", "--quiet", `--initial-branch=${branch}`);
    NodeFS.writeFileSync(NodePath.join(checkout, "src", "pay.ts"), "export const pay = 1;\n");
    git("add", "src/pay.ts");
    git("-c", "user.name=Ana", "-c", "user.email=ana@acme.test", "commit", "--quiet", "-m", "pay");
    NodeFS.writeFileSync(NodePath.join(checkout, "src", "pay.ts"), "export const pay = 2;\n");
    return checkout;
  });

/** A coordination report of acme that carries `reported`, as herdr adds its agents to it. */
const reportWithHerdr = (
  plugins: PeerPlugins.PeerPlugins["Service"],
  reported: ReadonlyArray<ReportedSession>,
) =>
  Effect.gen(function* () {
    const { reportSessions } = yield* brokerPlugins.pipe(
      Effect.provideService(PeerPlugins.PeerPlugins, plugins),
    );
    const herdr = reportSessions.find(({ plugin }) => plugin === "herdr");
    return herdr === undefined ? reported : yield* herdr.add("acme", reported);
  });

describe("herdr's agents in a coordination report", () => {
  it.effect("are on the task they were put on, else on the one their branch names", () =>
    Effect.gen(function* () {
      const checkout = yield* paymentsCheckout("krk-1-split");
      // Codex done with a piece of work, which Peer's hooks never reported.
      const { client } = standInHerdr({
        current: [agentIn(checkout, { session: undefined, status: "done", completionSeq: 1 })],
      });
      const { core, status, plugins, work } = yield* anaWithHerdr(client);
      yield* work.readWork("acme").pipe(Effect.provide(core));
      yield* agentsWhen(status, (agents) => agents.list[0]?.branch === "krk-1-split");
      assert.deepStrictEqual(
        (yield* reportWithHerdr(plugins, [])).map((session) => [
          session.id,
          session.task,
          session.files,
        ]),
        [["t1", "krk-1", ["src/pay.ts"]]],
      );

      // Put on a task, it is on that one, whatever its branch names.
      yield* work.assign("herdr:t1", { workspace: "acme", project: "pay", task: "krk-2" });
      assert.deepStrictEqual(
        (yield* reportWithHerdr(plugins, [])).map((session) => session.task),
        ["krk-2"],
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("leave an agent to the hooks that reported it, also once its session ended", () =>
    Effect.gen(function* () {
      const checkout = yield* paymentsCheckout("krk-1-split");
      // Codex in pane w1:p1, which Peer's hooks report, and OpenCode in w1:p2, which they cannot.
      const { client } = standInHerdr({
        current: [
          agentIn(checkout, { session: undefined, status: "done", completionSeq: 1 }),
          agentIn(checkout, {
            terminalId: "t2",
            paneId: "w1:p2",
            agent: "opencode",
            session: undefined,
            status: "done",
            completionSeq: 1,
          }),
        ],
      });
      const { core, status, plugins } = yield* anaWithHerdr(client);
      yield* agentsWhen(status, (agents) => agents.list.length === 2);
      const fixture = yield* Effect.acquireRelease(
        Effect.promise(() => brokerFixture(() => pluginsOf(plugins))),
        (made) => Effect.promise(() => made.dispose()),
      );
      yield* Context.get(core, PeerAgents.PeerAgents).attach(fixture.broker);
      const codex = { session_id: "one", cwd: fixture.root };
      yield* Effect.promise(() => fixture.broker["sessionFor"]("codex", codex, "w1:p1"));
      const reported = Effect.suspend(() =>
        reportWithHerdr(plugins, fixture.broker["reportFor"]("acme")),
      ).pipe(Effect.map((sessions) => sessions.map((session) => session.id)));
      assert.deepStrictEqual(yield* reported, ["codex:one", "t2"]);

      // Codex exits: its session ends a moment before herdr stops listing it. What it changed was
      // reported, and its overlaps settled, while its session lived.
      yield* Effect.promise(() =>
        fixture.broker.hook(
          { ...codex, hook_event_name: "SessionEnd" },
          { "x-peer-agent": "codex" },
        ),
      );
      assert.deepStrictEqual(yield* reported, ["t2"]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
