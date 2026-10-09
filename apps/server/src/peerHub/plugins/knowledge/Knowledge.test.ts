// @effect-diagnostics nodeBuiltinImport:off globalDate:off - a broker in a temporary checkout with its `.ai`, a project checkout kontext keeps knowledge in.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, expect, it } from "@effect/vitest";
import {
  KnowledgeRpcGroup,
  PeerKeptAs,
  type PeerHubStatus,
  type PeerKnowledgeCandidate,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as RpcTest from "effect/unstable/rpc/RpcTest";

import type { PeerBrokerHost } from "../../core/broker/host.ts";
import { brokerFixture, pluginsOf } from "../../core/broker/testkit.ts";
import * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import type { HubCoordSession, HubCoordView } from "../../core/hub/coordApi.ts";
import * as PeerIndex from "../../core/index/PeerIndex.ts";
import type { PeerRpcWrap } from "../../core/plugin.ts";
import * as PeerPlugins from "../../core/plugins/PeerPlugins.ts";
import * as PeerStatus from "../../core/status/PeerStatus.ts";
import {
  coreLayer,
  coreRpcStandIns,
  type HubAnswer,
  seedState,
  standInHub,
} from "../../core/testkit.ts";
import * as PeerHub from "../../PeerHub.ts";
import { KontextClient, type KontextClientShape } from "./client/kontext.ts";
import { KnowledgePlugin } from "./index.ts";

const AS_ONE = { "x-peer-session": "claude:one" };
const GOVERNS = "has an entry that governs what you change";
const GUIDANCE =
  "This project's own guidance on what to mark [project], from its reviewed knowledge (.ai):\nMark how prices round; leave UI copy unmarked.";

const coordination: PeerHubStatus["coordination"] = {
  enabled: true,
  policy: "notify",
  claudeHooks: true,
  logPath: "/tmp/coordination.jsonl",
  sessions: [],
  overlaps: [],
  findings: [],
  contexts: [],
  candidates: [],
};

/** kontext as no test may run it: each call is kept, and none succeeds. */
const noKontext = () => {
  const asked: Array<ReadonlyArray<string>> = [];
  const client: KontextClientShape = {
    run: async (args) => {
      asked.push(args);
      return { code: -1, stdout: "", stderr: "kontext is not here" };
    },
  };
  return { asked, client };
};

/**
 * Next to the fixture's `prices` decision: a decision that governs `src/pricing/total.ts`, and the
 * project's guidance on what to mark.
 */
const writeKnowledge = async (root: string) => {
  await NodeFSP.writeFile(
    NodePath.join(root, ".ai", "decisions", "rounding.md"),
    "---\nid: rounding\nkind: decision\ntitle: Round each line before the total\nstatus: accepted\ndate: 2026-10-05\nsummary: Totals are sums of rounded lines.\npaths: [src/pricing/total.ts]\n---\nRound per line.\n",
  );
  await NodeFSP.mkdir(NodePath.join(root, ".ai", "conventions"), { recursive: true });
  await NodeFSP.writeFile(
    NodePath.join(root, ".ai", "conventions", "marks.md"),
    "---\nid: marks\nkind: convention\ntitle: What to mark for the project\ndate: 2026-10-04\ntags: [peer-skill]\n---\nMark how prices round; leave UI copy unmarked.\n",
  );
};

/** acme's app project, where Vir's agent works on KRK-2 on another computer. */
const virOnSpeakers = (candidates?: HubCoordView["candidates"]): Partial<PeerBrokerHost> => {
  const at = new Date().toISOString();
  const vir: HubCoordSession = {
    id: "claude:vir",
    project: "app",
    email: "vir@acme.test",
    environment: "vir-laptop",
    label: "Speakers can be named",
    agent: "claude",
    task: "task-2",
    status: "working",
    files: [],
    claims: [],
    seenAt: at,
  };
  const view: HubCoordView = {
    sessions: [vir],
    overlaps: [],
    at,
    ...(candidates === undefined ? {} : { candidates }),
  };
  return {
    tasks: () => [{ id: "task-2", key: "KRK-2", title: "Speakers", status: "open" }],
    taskName: (_workspace, _project, task) => (task === "task-2" ? "KRK-2 · Speakers" : task),
    report: async () => view,
    view: async () => view,
  };
};

/**
 * Ana's Peer with the knowledge plugin, and a broker in acme's app checkout (its `.ai` holds two
 * decisions and the project's guidance) over `host`'s hub, as coordination hands it to core.
 */
const anaWithKnowledge = (host: Partial<PeerBrokerHost> = virOnSpeakers()) =>
  Effect.gen(function* () {
    const core = yield* Layer.build(coreLayer(yield* seedState(), { plugins: [KnowledgePlugin] }));
    return yield* Effect.gen(function* () {
      const kontext = noKontext();
      const status = yield* PeerStatus.PeerStatus;
      yield* status.coordinationFrom(() => Effect.succeed(coordination));
      yield* PeerPlugins.startPlugins.pipe(Effect.provideService(KontextClient, kontext.client));
      const plugins = yield* PeerPlugins.PeerPlugins;
      const fixture = yield* Effect.acquireRelease(
        Effect.promise(() => brokerFixture(() => ({ ...host, ...pluginsOf(plugins) }))),
        (made) => Effect.promise(() => made.dispose()),
      );
      yield* Effect.promise(() => writeKnowledge(fixture.root));
      const agents = yield* PeerAgents.PeerAgents;
      const index = yield* PeerIndex.PeerIndex;
      yield* agents.attach(fixture.broker);
      yield* index.attach(fixture.broker);
      /** What a hook of Ana's agent `one` (or of `session`) tells it. */
      const told = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
        Effect.promise(async () => {
          const answer = await fixture.broker["hook"](
            { session_id: "one", cwd: fixture.root, ...body },
            headers,
          );
          const output = answer?.hookSpecificOutput as
            | { readonly additionalContext?: unknown }
            | undefined;
          return typeof output?.additionalContext === "string" ? output.additionalContext : "";
        });
      const edit = (file: string) => ({
        tool_name: "Edit",
        tool_input: {
          file_path: NodePath.join(fixture.root, file),
          old_string: "a",
          new_string: "b",
        },
      });
      const run = (command: string, args: ReadonlyArray<string> = []) =>
        Effect.promise(() => fixture.broker["runCli"](command, args, AS_ONE));
      return { fixture, plugins, status, agents, index, kontext, told, edit, run };
    }).pipe(Effect.provide(core));
  });

describe("knowledge for agents", () => {
  it.effect("starts an agent with the `.ai` in its index, then the project's guidance", () =>
    Effect.gen(function* () {
      const ana = yield* anaWithKnowledge();
      const start = yield* ana.told({ hook_event_name: "SessionStart", source: "startup" });
      assert.include(start, "`peer knowledge <id or words>` reads project decisions");
      assert.include(start, "Other work on this project now");
      assert.include(
        start,
        "Project knowledge, kept in `.ai` by its people (3 entries; `peer knowledge <words>` reads or searches them):",
      );
      assert.include(
        start,
        "- decision: Round each line before the total · governs src/pricing/total.ts",
      );
      // The guidance is the plugin's block: after Peer's own start text, its index included.
      assert.isTrue(start.endsWith(`\n\n${GUIDANCE}`));
      assert.isBelow(start.indexOf("Project knowledge"), start.indexOf(GUIDANCE));
      assert.deepStrictEqual(ana.kontext.asked, []);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("tells Codex's and Claude Code's agents, once, of an entry that governs a file", () =>
    Effect.gen(function* () {
      const ana = yield* anaWithKnowledge();
      // A Codex session hears it from its hooks, before it changes the file.
      const codex = yield* ana.told(
        { session_id: "two", hook_event_name: "PreToolUse", ...ana.edit("src/pricing/total.ts") },
        { "x-peer-agent": "codex" },
      );
      assert.include(codex, GOVERNS);
      assert.include(codex, "Read it: peer knowledge rounding");
      const before = yield* ana.told({
        hook_event_name: "PreToolUse",
        ...ana.edit("src/pricing/total.ts"),
      });
      assert.include(
        before,
        "It governs `src/pricing/total.ts`, and you change `src/pricing/total.ts`. Read it: peer knowledge rounding",
      );
      // Said once: not again when the edit is done, nor at the next step.
      assert.notInclude(
        yield* ana.told({ hook_event_name: "PostToolUse", ...ana.edit("src/pricing/total.ts") }),
        GOVERNS,
      );
      assert.notInclude(
        yield* ana.told({ hook_event_name: "UserPromptSubmit", prompt: "Go on." }),
        GOVERNS,
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("hears of what a shell command changed when it is done", () =>
    Effect.gen(function* () {
      const shell = { ran: false };
      const ana = yield* anaWithKnowledge({
        ...virOnSpeakers(),
        // git sees nothing changed when the session starts, and the total changed after the command.
        gitStatus: async () => (shell.ran ? " M src/pricing/total.ts\0" : ""),
      });
      yield* ana.told({ hook_event_name: "UserPromptSubmit", prompt: "Round the total." });
      shell.ran = true;
      const after = yield* ana.told({
        hook_event_name: "PostToolUse",
        tool_name: "Bash",
        tool_input: { command: "sed -i '' s/a/b/ src/pricing/total.ts" },
      });
      assert.include(after, GOVERNS);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("reads, lists and searches the entries with peer knowledge, and lists it in help", () =>
    Effect.gen(function* () {
      const ana = yield* anaWithKnowledge();
      yield* Effect.promise(() => ana.fixture.register("one"));
      assert.include(
        yield* ana.run("help"),
        "  peer knowledge [<id or words>]  the project's decisions, conventions, learnings and incidents: list, search or read one",
      );
      const one = yield* ana.run("knowledge", ["rounding"]);
      assert.include(one, "decision (accepted, 2026-10-05) · Round each line before the total");
      assert.include(one, "check your change against it");
      assert.include(yield* ana.run("knowledge"), "Project knowledge, kept in `.ai`");
      assert.include(yield* ana.run("knowledge", ["cents"]), "Keep prices in cents");
      // Read, it is not said again when the agent changes what it governs.
      assert.notInclude(
        yield* ana.told({ hook_event_name: "PreToolUse", ...ana.edit("src/pricing/total.ts") }),
        GOVERNS,
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("gives peer index and peer find the project's work and its `.ai`", () =>
    Effect.gen(function* () {
      const ana = yield* anaWithKnowledge();
      yield* Effect.promise(() => ana.fixture.register("one"));
      const listed = yield* ana.run("index");
      assert.include(listed, "Other work on this project now:");
      assert.include(listed, "`peer knowledge <id>` reads a decision of the project");
      assert.include(listed, "Project knowledge, kept in `.ai` by its people (3 entries;");
      assert.include(listed, "· rounding");
      const [session] = yield* ana.agents.sessions;
      assert.deepStrictEqual(
        (yield* ana.index.entries(session!)).map((entry) => entry.id),
        ["rounding", "marks", "prices"],
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

describe("knowledge turned off", () => {
  it.effect("starts an agent with its work and shared context, but no `.ai` and no guidance", () =>
    Effect.gen(function* () {
      const ana = yield* anaWithKnowledge();
      yield* ana.plugins.setPlugin({ id: "knowledge", enabled: false });
      const start = yield* ana.told({ hook_event_name: "SessionStart", source: "startup" });
      assert.include(start, "Other work on this project now");
      assert.include(start, "Peer keeps your private working context in");
      assert.notInclude(start, "Project knowledge");
      assert.notInclude(start, "own guidance on what to mark");
      assert.notInclude(start, "peer knowledge");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("says nothing of an entry that governs a file the agent changes", () =>
    Effect.gen(function* () {
      const ana = yield* anaWithKnowledge();
      yield* ana.plugins.setPlugin({ id: "knowledge", enabled: false });
      assert.notInclude(
        yield* ana.told({ hook_event_name: "PreToolUse", ...ana.edit("src/pricing/total.ts") }),
        GOVERNS,
      );
      assert.notInclude(
        yield* ana.told({ hook_event_name: "PostToolUse", ...ana.edit("src/pricing/total.ts") }),
        GOVERNS,
      );
      // On again, the entry is said at the next step.
      yield* ana.plugins.setPlugin({ id: "knowledge", enabled: true });
      assert.include(
        yield* ana.told({ hook_event_name: "UserPromptSubmit", prompt: "Go on." }),
        GOVERNS,
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("refuses peer knowledge in one line, and leaves it out of help and status", () =>
    Effect.gen(function* () {
      const ana = yield* anaWithKnowledge();
      yield* Effect.promise(() => ana.fixture.register("one"));
      yield* ana.plugins.setPlugin({ id: "knowledge", enabled: false });
      yield* Effect.promise(() =>
        expect(
          ana.fixture.broker["runCli"]("knowledge", ["rounding"], AS_ONE),
        ).rejects.toMatchObject({
          status: 409,
          message: "knowledge is turned off on this environment.",
        }),
      );
      assert.notInclude(yield* ana.run("help"), "peer knowledge");
      const status = yield* ana.run("status");
      assert.include(status, "Commands: peer index · peer context [<task>] · peer note");
      assert.notInclude(status, "peer knowledge");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("lists only the work in peer index, and gives peer find no entries", () =>
    Effect.gen(function* () {
      const ana = yield* anaWithKnowledge();
      yield* Effect.promise(() => ana.fixture.register("one"));
      yield* ana.plugins.setPlugin({ id: "knowledge", enabled: false });
      const listed = yield* ana.run("index");
      assert.include(listed, "Other work on this project now:");
      assert.include(listed, "KRK-2 · Speakers");
      assert.notInclude(listed, "Project knowledge");
      assert.notInclude(listed, "peer knowledge");
      const [session] = yield* ana.agents.sessions;
      assert.deepStrictEqual(yield* ana.index.entries(session!), []);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

describe("knowledge candidates in the status", () => {
  it.effect("counts the candidates waiting per project while on, and none while off", () =>
    Effect.gen(function* () {
      const ana = yield* anaWithKnowledge(virOnSpeakers([{ project: "app", proposed: 2 }]));
      yield* Effect.promise(() => ana.fixture.broker["syncNow"]("acme", 3000));
      const waiting = (status: PeerHubStatus) => status.coordination.candidates;
      assert.deepStrictEqual(waiting(yield* ana.status.publish), [
        { workspace: "acme", project: "app", proposed: 2 },
      ]);
      yield* ana.plugins.setPlugin({ id: "knowledge", enabled: false });
      assert.deepStrictEqual(waiting(yield* ana.status.publish), []);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

/** A candidate of acme's Payments project that came already worded, from a task's context. */
const CANDIDATE: PeerKnowledgeCandidate = {
  id: "c1",
  project: "pay",
  text: "Prices are integers of cents",
  sources: [
    {
      finding: "f1",
      email: "vir@acme.test",
      session: "claude:vir",
      task: "krk-1",
      text: "Prices are integers of cents",
      tagged: true,
      independent: true,
      at: "2026-10-08T10:00:00Z",
      origin: "context:task:krk-1@v3",
    },
  ],
  finders: 1,
  status: "proposed",
  firstAt: "2026-10-08T10:00:00Z",
  lastAt: "2026-10-08T10:00:00Z",
  kind: "decision",
  detail: "Floats lose cents; every amount is an integer.",
};

/** A Hub that has the candidate above, and takes what people decide on it. */
const candidateHub: HubAnswer = (url) =>
  url === "/v1/workspaces/acme/candidates/pay"
    ? [200, [CANDIDATE]]
    : url === "/v1/workspaces/acme/candidates/pay/c1"
      ? [200, { ...CANDIDATE, status: "promoted" }]
      : [404, { error: { code: "not_found", message: "Not here." } }];

/** kontext installed, keeping what it captures as `.ai/decisions/cents.md` of `checkout`. */
const workingKontext = (checkout: string) => {
  const asked: Array<ReadonlyArray<string>> = [];
  const client: KontextClientShape = {
    run: async (args) => {
      asked.push(args);
      const [command] = args;
      if (command === "capture") return { code: 0, stdout: "captured inbox:cents\n", stderr: "" };
      if (command === "promote") {
        await NodeFSP.mkdir(NodePath.join(checkout, ".ai", "decisions"), { recursive: true });
        await NodeFSP.writeFile(
          NodePath.join(checkout, ".ai", "decisions", "cents.md"),
          "---\nid: cents\nkind: decision\ntitle: Prices are integers of cents\n---\nFloats lose cents.\n",
        );
        return { code: 0, stdout: "cents → .ai/decisions/cents.md (staged)\n", stderr: "" };
      }
      if (command === "search") return { code: 0, stdout: '{"hits":[]}', stderr: "" };
      return { code: 0, stdout: "kontext 1.0\n", stderr: "" };
    },
  };
  return { asked, client };
};

/** Ana signed in to `hubUrl`, in acme's Payments project, whose `api` checkout is `checkout`. */
const paymentsAt = (hubUrl: string, checkout: string) =>
  JSON.stringify({
    hubUrl,
    email: "ana@acme.test",
    pendingSignIn: null,
    workspaces: [
      {
        slug: "acme",
        name: "Acme",
        role: "member",
        allowedDomains: [],
        manifest: {
          version: 2,
          workspace: { slug: "acme", name: "Acme", currency: "EUR" },
          member: { email: "ana@acme.test", name: "Ana", role: "member" },
          knowledge: {},
          projects: [
            {
              id: "pay",
              name: "Payments",
              role: "lead",
              members: [],
              repositories: [{ id: "api", url: "https://github.com/acme/api.git", branch: "main" }],
              knowledge: { kontext: true, company: false },
              tools: [],
              capacity: { personal: "any", personalHarnesses: [] },
            },
          ],
        },
        lastSyncAt: null,
      },
    ],
    joinable: [],
    lastSyncAt: null,
    sharedInstances: {},
    localCheckouts: { "acme/pay/api": checkout },
  });

describe("keeping knowledge", () => {
  it.effect(
    "writes a kept candidate with kontext, staged, tells the Hub, and is refused while off",
    () =>
      Effect.gen(function* () {
        const checkout = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped({
          prefix: "peer-kontext-",
        });
        yield* Effect.promise(async () => {
          await NodeFSP.mkdir(NodePath.join(checkout, ".git"));
          await NodeFSP.mkdir(NodePath.join(checkout, ".ai"));
          await NodeFSP.writeFile(NodePath.join(checkout, ".ai", "kontext.toml"), "");
        });
        const hub = yield* standInHub({ current: candidateHub });
        const kontext = workingKontext(checkout);
        const core = yield* Layer.build(
          coreLayer(yield* seedState(paymentsAt(hub.url, checkout)), {
            session: "phs_test",
            plugins: [KnowledgePlugin],
          }),
        );
        const plugins = yield* Effect.gen(function* () {
          yield* (yield* PeerStatus.PeerStatus).coordinationFrom(() =>
            Effect.succeed(coordination),
          );
          yield* PeerPlugins.startPlugins.pipe(
            Effect.provideService(KontextClient, kontext.client),
          );
          return yield* PeerPlugins.PeerPlugins;
        }).pipe(Effect.provide(core));
        const wrap: PeerRpcWrap = {
          effect: (_method, effect) => effect,
          stream: (_method, stream) => stream,
        };
        const client = yield* RpcTest.makeClient(KnowledgeRpcGroup).pipe(
          Effect.provide(
            PeerHub.rpcLayer(wrap).pipe(
              Layer.provide(
                Layer.mergeAll(coreRpcStandIns, Layer.succeed(PeerPlugins.PeerPlugins, plugins)),
              ),
            ),
          ),
        );
        const keep = client["peerHub.keepCandidate"]({
          workspace: "acme",
          project: "pay",
          id: "c1",
        });

        assert.deepStrictEqual(yield* keep, {
          checkout,
          keptAs: {
            path: ".ai/decisions/cents.md",
            title: "Prices are integers of cents",
            kind: "decision",
          },
          related: null,
          asWritten: null,
        });
        assert.deepStrictEqual(kontext.asked, [
          ["--version"],
          ["search", "--json", "-n", "3", "-s", "local", "Prices are integers of cents"],
          [
            "capture",
            "--kind",
            "decision",
            "--title",
            "Prices are integers of cents",
            "--body",
            "Floats lose cents; every amount is an integer.",
          ],
          ["promote", "cents"],
        ]);
        const decided = hub.calls.find((call) => call.method === "POST");
        assert.strictEqual(decided?.url, "/v1/workspaces/acme/candidates/pay/c1");
        const decision = Schema.fromJsonString(
          Schema.Struct({ status: Schema.String, keptAs: PeerKeptAs }),
        );
        assert.deepStrictEqual(yield* Schema.decodeUnknownEffect(decision)(decided?.body), {
          status: "promoted",
          keptAs: {
            path: ".ai/decisions/cents.md",
            title: "Prices are integers of cents",
            kind: "decision",
          },
        });

        // While off, keeping is refused before kontext or the Hub hear of it.
        yield* plugins.setPlugin({ id: "knowledge", enabled: false });
        const asked = kontext.asked.length;
        const calls = hub.calls.length;
        const refused = yield* keep.pipe(Effect.result);
        assert.isTrue(Result.isFailure(refused));
        if (Result.isFailure(refused)) {
          assert.strictEqual(
            refused.failure.message,
            "Knowledge is turned off on this environment.",
          );
        }
        assert.strictEqual(kontext.asked.length, asked);
        assert.strictEqual(hub.calls.length, calls);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
